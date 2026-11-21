const { authenticate, getDb } = require("../lib/firebase");
const { getActiveComputer } = require("../lib/active-computer");
const { handleOptions, HttpError, sendError, setCorsHeaders } = require("../lib/http");
const { getTenant } = require("../lib/tenant");

module.exports = async function examContentHandler(req, res) {
    if (handleOptions(req, res)) return;
    setCorsHeaders(res);
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST, OPTIONS");
        return res.status(405).json({ error: "This request is not supported." });
    }

    try {
        const tenant = getTenant(req);
        if (tenant.developerAdmin) {
            throw new HttpError(403, "Use a school app to download assigned exams.");
        }
        const examId = req.body?.examId;
        if (typeof examId !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(examId)) {
            throw new HttpError(400, "Choose a valid exam.");
        }
        const identity = await authenticate(req);
        const db = getDb();
        const device = await getActiveComputer(db, tenant, identity.uid);
        if (!device || device.schoolId !== tenant.schoolId) {
            throw new HttpError(403, "Active school computer access is required.");
        }

        const examRef = db.doc(`${tenant.dataRoot}/exams/items/${examId}`);
        const contentRef = db.doc(`${tenant.dataRoot}/exams/items/${examId}/content/main`);
        const [examSnapshot, contentSnapshot] = await Promise.all([
            examRef.get(),
            contentRef.get()
        ]);
        if (!examSnapshot.exists || examSnapshot.data().schoolId !== device.schoolId ||
            examSnapshot.data().status !== "published") {
            throw new HttpError(404, "This exam is no longer available for this school.");
        }
        const questions = contentSnapshot.exists ? contentSnapshot.data().questions : null;
        if (!Array.isArray(questions) || !questions.length) {
            throw new HttpError(404, "The exam questions are not available.");
        }

        const metadata = examSnapshot.data();
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).json({
            metadata: {
                title: metadata.title || "",
                subject: metadata.subject || "",
                scheduledDate: metadata.scheduledDate || "",
                duration: metadata.duration,
                targetClass: metadata.targetClass || "",
                allowCalculator: metadata.allowCalculator === true,
                revision: metadata.revision,
                questionVersion: metadata.questionVersion
            },
            questions
        });
    } catch (error) {
        return sendError(req, res, error);
    }
};
