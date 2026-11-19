const { HttpError, handleOptions, sendError, setCorsHeaders } = require("../lib/http");
const { authenticate, getDb } = require("../lib/firebase");
const { normalizeAllowedSubjects, parseQuestionPath } = require("../lib/subjects");
const { assertSchool, getTenant } = require("../lib/tenant");

const DEFAULT_DATA_BASE_URL = "https://cbtsoftwareserver.vercel.app";

module.exports = async function questionDataHandler(req, res) {
    if (handleOptions(req, res)) return;
    setCorsHeaders(res);
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET, OPTIONS");
        return res.status(405).json({ error: "This request is not supported." });
    }

    try {
        const tenant = getTenant(req);
        const root = tenant.dataRoot;
        const relativePath = req.query?.path;
        const question = parseQuestionPath(relativePath);
        if (!question) {
            throw new HttpError(400, "The requested question data is not available.");
        }

        const identity = await authenticate(req);
        const db = getDb();
        const uid = identity.uid;
        const [activeSnapshot, inactiveSnapshot] = await Promise.all([
            db.doc(`${root}/computers/active/${uid}`).get(),
            db.doc(`${root}/computers/inactive/${uid}`).get()
        ]);
        if (inactiveSnapshot.exists || !activeSnapshot.exists) {
            throw new HttpError(403, "This computer does not have active school access.");
        }

        const device = activeSnapshot.data();
        assertSchool(tenant, device.schoolId);
        const expiresAt = device.expiresAt?.toDate?.();
        if (device.status !== "active" || !expiresAt || expiresAt.getTime() <= Date.now()) {
            throw new HttpError(403, "This computer's school access has expired or been disabled.");
        }

        const schoolSnapshot = await db.doc(`${root}/schools/items/${device.schoolId}`).get();
        if (!schoolSnapshot.exists || schoolSnapshot.data().status !== "active") {
            throw new HttpError(403, "This school's access has been disabled.");
        }

        const accessCodeSnapshot = typeof device.accessCode === "string"
            ? await db.doc(`${root}/accessCodes/items/${device.accessCode}`).get()
            : null;
        const allowedSubjects = normalizeAllowedSubjects(accessCodeSnapshot?.exists
            ? accessCodeSnapshot.data().allowedSubjects
            : device.allowedSubjects);
        if (!allowedSubjects[question.exam].includes(question.subject)) {
            throw new HttpError(403, "This subject is not enabled for this computer.");
        }

        const dataBaseUrl = process.env.CBT_QUESTION_DATA_BASE_URL || DEFAULT_DATA_BASE_URL;
        let dataUrl;
        try {
            const baseUrl = new URL(dataBaseUrl);
            if ((baseUrl.protocol !== "https:" && baseUrl.hostname !== "localhost") ||
                baseUrl.search || baseUrl.hash) {
                throw new Error("The question data base URL must use HTTPS and cannot include a query or fragment.");
            }
            const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
            dataUrl = new URL(encodedPath, `${baseUrl.href.replace(/\/+$/, "")}/`);
        } catch (error) {
            throw new HttpError(503, "Question downloads are not configured on the server.", {
                expose: true,
                details: { configurationError: error.message }
            });
        }

        const upstreamResponse = await fetch(dataUrl, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(8000)
        });
        if (upstreamResponse.status === 404) {
            throw new HttpError(404, "Questions for this subject are not available yet.");
        }
        if (!upstreamResponse.ok) {
            throw new HttpError(502, "Question data is temporarily unavailable.", {
                details: {
                    upstream: "Vercel question-data files",
                    status: upstreamResponse.status,
                    url: dataUrl.pathname
                }
            });
        }

        let questions;
        try {
            questions = await upstreamResponse.json();
        } catch {
            throw new HttpError(502, "Question data could not be loaded.", {
                details: { upstream: "Vercel question-data files", url: dataUrl.pathname }
            });
        }
        if (!Array.isArray(questions) || questions.length === 0) {
            throw new HttpError(502, "Question data could not be loaded.", {
                details: { upstream: "Vercel question-data files", url: dataUrl.pathname }
            });
        }

        res.setHeader("Cache-Control", "no-store");
        return res.status(200).json(questions);
    } catch (error) {
        return sendError(req, res, error);
    }
};
