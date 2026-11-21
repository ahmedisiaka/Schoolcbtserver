const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { HttpError, handleOptions, sendError, setCorsHeaders } = require("../lib/http");
const { FieldValue } = require("firebase-admin/firestore");
const { authenticate, getDb } = require("../lib/firebase");
const { isYearAllowed, normalizeAllowedSubjects, normalizeAllowedYears, parseQuestionPath } = require("../lib/subjects");
const { assertSchool, getTenant } = require("../lib/tenant");

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

        if (typeof req.headers.authorization !== "string") {
            throw new HttpError(401, "Question bank access denied. Open the school CBT app or contact your school administrator.");
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
        const schoolSnapshot = await assertSchool(tenant, device.schoolId, db);
        const expiresAt = device.expiresAt?.toDate?.();
        if (device.status !== "active" || !expiresAt || expiresAt.getTime() <= Date.now()) {
            throw new HttpError(403, "This computer's school access has expired or been disabled.");
        }

        if (schoolSnapshot.data().status !== "active") {
            throw new HttpError(403, "This school's access has been disabled.");
        }

        if (typeof device.accessCode !== "string" || !device.accessCode) {
            throw new HttpError(403, "This computer has no valid school access code. Contact your school administrator.");
        }
        const accessCodeSnapshot = await db.doc(`${root}/accessCodes/items/${device.accessCode}`).get();
        if (!accessCodeSnapshot.exists) {
            throw new HttpError(403, "This computer's school access code could not be verified. Contact your school administrator.");
        }
        const accessCode = accessCodeSnapshot.data();
        if (accessCode.enabled !== true || accessCode.schoolId !== device.schoolId ||
            !Array.isArray(accessCode.usedBy) || !accessCode.usedBy.includes(uid)) {
            throw new HttpError(403, "This computer's school access code is not active. Contact your school administrator.");
        }
        const allowedSubjects = normalizeAllowedSubjects(accessCode.allowedSubjects);
        if (!allowedSubjects[question.exam].includes(question.subject)) {
            throw new HttpError(403, "This subject is not enabled for this computer.");
        }
        const allowedYears = normalizeAllowedYears(accessCode.allowedYears);
        if (!isYearAllowed(allowedYears, question.exam, question.year)) {
            throw new HttpError(403, "This exam year is not enabled for this computer.");
        }

        if (req.query?.check === "1") {
            res.setHeader("Cache-Control", "no-store");
            return res.status(200).json({ success: true, allowed: true });
        }

        const privateDataRoot = path.resolve(__dirname, "_question-data");
        const questionRelativePath = relativePath.replace(/^data[\\/]/i, "");
        const questionFile = path.resolve(privateDataRoot, questionRelativePath);
        if (!questionFile.startsWith(`${privateDataRoot}${path.sep}`)) {
            throw new HttpError(400, "The requested question data is not available.");
        }
        let questions;
        try {
            questions = JSON.parse(await fs.readFile(questionFile, "utf8"));
        } catch (error) {
            if (error.code === "ENOENT") {
                throw new HttpError(404, "Questions for this subject are not available yet.");
            }
            throw error;
        }
        if (!Array.isArray(questions) || questions.length === 0) {
            throw new HttpError(502, "Question data could not be loaded.");
        }

        const downloadSummaryId = createHash("sha256")
            .update(`${uid}:${question.exam}`, "utf8")
            .digest("hex");
        await db.doc(`${root}/questionDownloads/records/${downloadSummaryId}`).set({
            schoolId: device.schoolId,
            computerId: uid,
            computerName: device.computerName || "",
            exam: question.exam,
            downloadedAt: FieldValue.serverTimestamp(),
            downloadCount: FieldValue.increment(1)
        }, { merge: true });

        res.setHeader("Cache-Control", "no-store");
        return res.status(200).json(questions);
    } catch (error) {
        return sendError(req, res, error);
    }
};
