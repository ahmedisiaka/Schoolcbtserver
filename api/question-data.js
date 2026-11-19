const { HttpError, handleOptions, sendError, setCorsHeaders } = require("../lib/http");
const { authenticate, getDb } = require("../lib/firebase");
const { normalizeAllowedSubjects, parseQuestionPath } = require("../lib/subjects");
const { assertSchool, getTenant } = require("../lib/tenant");

const REPOSITORY = "ahmedisiaka/Schoolcbtserver";
const REF = "main";
module.exports = async function questionDataHandler(req, res) {
    if (handleOptions(req, res)) return;
    setCorsHeaders(res);
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET, OPTIONS");
        return res.status(405).json({ error: "This request is not supported." });
    }

    try {
        const tenant = getTenant(req);
        const ROOT = tenant.dataRoot;
        const relativePath = req.query?.path;
        const question = parseQuestionPath(relativePath);
        if (!question) {
            throw new HttpError(400, "The requested question data is not available.");
        }

        const identity = await authenticate(req);
        const db = getDb();
        const uid = identity.uid;
        const [activeSnapshot, inactiveSnapshot] = await Promise.all([
            db.doc(`${ROOT}/computers/active/${uid}`).get(),
            db.doc(`${ROOT}/computers/inactive/${uid}`).get()
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
        const schoolSnapshot = await db.doc(`${ROOT}/schools/items/${device.schoolId}`).get();
        if (!schoolSnapshot.exists || schoolSnapshot.data().status !== "active") {
            throw new HttpError(403, "This school's access has been disabled.");
        }
        const accessCodeSnapshot = typeof device.accessCode === "string"
            ? await db.doc(`${ROOT}/accessCodes/items/${device.accessCode}`).get()
            : null;
        const allowedSubjects = normalizeAllowedSubjects(accessCodeSnapshot?.exists
            ? accessCodeSnapshot.data().allowedSubjects
            : device.allowedSubjects);
        if (!allowedSubjects[question.exam].includes(question.subject)) {
            throw new HttpError(403, "This subject is not enabled for this computer.");
        }

        const token = process.env.GITHUB_DATA_READ_TOKEN;
        if (!token) {
            throw new HttpError(
                503,
                "Question downloads are not configured on the server. Contact the administrator.",
                { expose: true }
            );
        }
        const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
        const response = await fetch(
            `https://api.github.com/repos/${REPOSITORY}/contents/${encodedPath}?ref=${REF}`,
            {
                headers: {
                    Accept: "application/vnd.github+json",
                    Authorization: `Bearer ${token}`,
                    "X-GitHub-Api-Version": "2022-11-28",
                    "User-Agent": "LIMLO-School-CBT"
                },
                signal: AbortSignal.timeout(8000)
            }
        );
        if (response.status === 404) {
            throw new HttpError(404, "Questions for this subject are not available yet.");
        }
        if (!response.ok) {
            const upstreamBody = await response.json().catch(() => null);
            const upstreamMessage = typeof upstreamBody?.message === "string"
                ? upstreamBody.message.slice(0, 300)
                : "";
            if (response.status === 401 || response.status === 403) {
                throw new HttpError(
                    503,
                    "The question repository is not available. Contact the administrator.",
                    {
                        expose: true,
                        details: {
                            upstream: "GitHub Contents API",
                            status: response.status,
                            message: upstreamMessage,
                            requestId: response.headers.get("x-github-request-id")
                        }
                    }
                );
            }
            throw new HttpError(502, "Question data is temporarily unavailable.", {
                details: {
                    upstream: "GitHub Contents API",
                    status: response.status,
                    message: upstreamMessage,
                    requestId: response.headers.get("x-github-request-id")
                }
            });
        }

        let questions;
        try {
            const file = await response.json();
            if (file.type !== "file" || file.encoding !== "base64" || typeof file.content !== "string") {
                throw new Error("Unsupported GitHub content response.");
            }
            questions = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
        } catch {
            throw new HttpError(502, "Question data could not be loaded.");
        }
        if (!Array.isArray(questions) || questions.length === 0) {
            throw new HttpError(502, "Question data could not be loaded.");
        }
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).json(questions);
    } catch (error) {
        return sendError(req, res, error);
    }
};
