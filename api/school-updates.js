const { authenticate, getDb } = require("../lib/firebase");
const { handleOptions, HttpError, sendError, setCorsHeaders } = require("../lib/http");
const { assertSchool, getTenant } = require("../lib/tenant");

module.exports = async function schoolUpdatesHandler(req, res) {
    if (handleOptions(req, res)) return;
    setCorsHeaders(res);
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET, OPTIONS");
        return res.status(405).json({ error: "This request is not supported." });
    }

    try {
        const tenant = getTenant(req);
        const identity = await authenticate(req);
        const db = getDb();
        const [activeSnapshot, inactiveSnapshot] = await Promise.all([
            db.doc(`${tenant.dataRoot}/computers/active/${identity.uid}`).get(),
            db.doc(`${tenant.dataRoot}/computers/inactive/${identity.uid}`).get()
        ]);
        if (!activeSnapshot.exists || inactiveSnapshot.exists) {
            throw new HttpError(403, "Active school computer access is required.");
        }

        const device = activeSnapshot.data();
        const schoolSnapshot = await assertSchool(tenant, device.schoolId, db);
        const expiresAt = device.expiresAt?.toDate?.();
        if (device.status !== "active" || !expiresAt || expiresAt.getTime() <= Date.now() ||
            typeof device.accessCode !== "string" || !device.accessCode) {
            throw new HttpError(403, "Active school computer access is required.");
        }
        const [codeSnapshot, runtimeSnapshot] = await Promise.all([
            db.doc(`${tenant.dataRoot}/accessCodes/items/${device.accessCode}`).get(),
            db.doc(`${tenant.dataRoot}/schoolRuntime/items/${device.schoolId}`).get()
        ]);
        const code = codeSnapshot.exists ? codeSnapshot.data() : null;
        if (schoolSnapshot.data().status !== "active" ||
            !code || code.enabled !== true || code.schoolId !== device.schoolId ||
            !Array.isArray(code.usedBy) || !code.usedBy.includes(identity.uid)) {
            throw new HttpError(403, "Active school computer access is required.");
        }

        const runtime = runtimeSnapshot.exists ? runtimeSnapshot.data() : {};
        const revisions = {};
        for (const type of ["questions", "exams", "apiKey"]) {
            const revision = Number(runtime.revisions?.[type]) || 0;
            revisions[type] = Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
        }
        return res.status(200).json({ schoolId: device.schoolId, revisions });
    } catch (error) {
        return sendError(req, res, error);
    }
};
