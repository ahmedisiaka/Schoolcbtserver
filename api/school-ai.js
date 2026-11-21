const { authenticate, getDb } = require("../lib/firebase");
const { handleOptions, HttpError, sendError, setCorsHeaders } = require("../lib/http");
const { decryptSecret } = require("../lib/school-secrets");
const { getTenant, assertSchool } = require("../lib/tenant");

module.exports = async function schoolAiHandler(req, res) {
    if (handleOptions(req, res)) return;
    setCorsHeaders(res);
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST, OPTIONS");
        return res.status(405).json({ error: "This request is not supported." });
    }

    try {
        const tenant = getTenant(req);
        const identity = await authenticate(req);
        const db = getDb();
        const deviceSnapshot = await db.doc(`${tenant.dataRoot}/computers/active/${identity.uid}`).get();
        const inactiveSnapshot = await db.doc(`${tenant.dataRoot}/computers/inactive/${identity.uid}`).get();
        if (!deviceSnapshot.exists || inactiveSnapshot.exists) {
            throw new HttpError(403, "Active school computer access is required.");
        }
        const device = deviceSnapshot.data();
        if (typeof device.schoolId !== "string" || !device.schoolId ||
            typeof device.accessCode !== "string" || !device.accessCode) {
            throw new HttpError(403, "Active school computer access is required.");
        }
        const schoolSnapshot = await assertSchool(tenant, device.schoolId, db);
        const codeRef = db.doc(`${tenant.dataRoot}/accessCodes/items/${device.accessCode}`);
        const codeSnapshot = await codeRef.get();
        const expiresAt = device.expiresAt?.toDate?.();
        if (device.status !== "active" || !expiresAt || expiresAt.getTime() <= Date.now() ||
            schoolSnapshot.data().status !== "active" ||
            !codeSnapshot.exists || codeSnapshot.data().enabled !== true ||
            codeSnapshot.data().schoolId !== device.schoolId ||
            !Array.isArray(codeSnapshot.data().usedBy) || !codeSnapshot.data().usedBy.includes(identity.uid)) {
            throw new HttpError(403, "Active school computer access is required.");
        }
        const promptText = req.body?.text;
        if (typeof promptText !== "string" || !promptText.trim() || promptText.length > 40000) {
            throw new HttpError(400, "Question text must be between 1 and 40,000 characters.");
        }
        const runtimeSnapshot = await db.doc(`${tenant.dataRoot}/schoolRuntime/items/${device.schoolId}`).get();
        const apiKeyRecord = runtimeSnapshot.exists ? runtimeSnapshot.data().geminiApiKey : null;
        if (!apiKeyRecord) throw new HttpError(503, "Question generation is not configured. Contact your school administrator.");

        const apiKey = decryptSecret(apiKeyRecord);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7000);
        let response;
        try {
            response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
                body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] }),
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeout);
        }
        if (!response.ok) throw new HttpError(502, "Question generation is temporarily unavailable. Contact your school administrator.");
        const payload = await response.json();
        return res.status(200).json({ candidates: payload.candidates || [] });
    } catch (error) {
        return sendError(req, res, error);
    }
};
