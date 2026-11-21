const { randomUUID } = require("node:crypto");
const { FieldValue } = require("firebase-admin/firestore");
const { authenticate, getDb } = require("../lib/firebase");
const { assertPassword, hashPassword } = require("../lib/computer-admin-password");
const { handleOptions, HttpError, sendError, setCorsHeaders } = require("../lib/http");
const { getTenant } = require("../lib/tenant");

module.exports = async function schoolAdminPasswordHandler(req, res) {
    if (handleOptions(req, res)) return;
    setCorsHeaders(res);
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST, OPTIONS");
        return res.status(405).json({ error: "This request is not supported." });
    }

    try {
        const tenant = getTenant(req);
        if (!tenant.developerAdmin) {
            throw new HttpError(403, "Developer administrator access is required.");
        }
        const identity = await authenticate(req);
        const db = getDb();
        const adminSnapshot = await db.doc(`admins/${identity.uid}`).get();
        const admin = adminSnapshot.exists ? adminSnapshot.data() : null;
        if (admin?.admin !== true || admin.status !== "active") {
            throw new HttpError(403, "Developer administrator access is required.");
        }

        const schoolId = req.body?.schoolId;
        if (typeof schoolId !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(schoolId)) {
            throw new HttpError(400, "Choose a valid school.");
        }
        const schoolRef = db.doc(`schoolDirectory/${schoolId}`);
        const schoolSnapshot = await schoolRef.get();
        if (!schoolSnapshot.exists || schoolSnapshot.data().status !== "active") {
            throw new HttpError(404, "The selected school is not available.");
        }
        const school = schoolSnapshot.data();
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(school.dataRoot || "")) {
            throw new HttpError(403, "The selected school does not have a Firestore root configured.");
        }
        const credential = await hashPassword(req.body?.password);
        await db.doc(`${school.dataRoot}/computerAdmin/items/credentials`).set({
            ...credential,
            changedBy: identity.uid,
            changedAt: FieldValue.serverTimestamp()
        });
        await db.doc(`${school.dataRoot}/computerAdminAudit/items/${randomUUID()}`).set({
            action: "password-reset",
            changedBy: identity.uid,
            changedAt: FieldValue.serverTimestamp()
        });
        return res.status(200).json({ success: true });
    } catch (error) {
        return sendError(req, res, error);
    }
};
