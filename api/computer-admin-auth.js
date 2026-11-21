const { getDb } = require("../lib/firebase");
const { assertPassword, clearLoginAttempts, consumeLoginAttempt, hashPassword, verifyPassword } = require("../lib/computer-admin-password");
const { handleOptions, HttpError, sendError, setCorsHeaders } = require("../lib/http");
const { assertSchool, getTenant } = require("../lib/tenant");

module.exports = async function computerAdminAuthHandler(req, res) {
    if (handleOptions(req, res)) return;
    setCorsHeaders(res);
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST, OPTIONS");
        return res.status(405).json({ error: "This request is not supported." });
    }

    try {
        const tenant = getTenant(req);
        if (tenant.developerAdmin) {
            throw new HttpError(403, "Use a school app to verify its Computer Admin password.");
        }
        const action = req.body?.action;
        if (action !== "login" && action !== "change-password") {
            throw new HttpError(400, "Choose a valid password action.");
        }
        const db = getDb();
        const schoolSnapshot = await assertSchool(tenant, tenant.schoolId, db);
        if (schoolSnapshot.data().status !== "active") {
            throw new HttpError(403, "This school's access is currently unavailable.");
        }
        const rateLimitRef = await consumeLoginAttempt(db, tenant.dataRoot, req);
        const credentialRef = db.doc(`${tenant.dataRoot}/computerAdmin/items/credentials`);
        const credentialSnapshot = await credentialRef.get();
        const credential = credentialSnapshot.exists ? credentialSnapshot.data() : null;

        if (!credential) {
            throw new HttpError(403, "Computer Admin access has not been set up. Contact your school administrator.");
        }

        if (action === "login") {
            const password = req.body?.password;
            const valid = await verifyPassword(password, credential);
            if (!valid) throw new HttpError(401, "The password is incorrect. Try again or contact your school administrator.");
            await clearLoginAttempts(db, rateLimitRef);
            return res.status(200).json({ status: "authenticated", serverTime: Date.now() });
        }

        const currentPassword = req.body?.currentPassword;
        const newPassword = req.body?.newPassword;
        assertPassword(newPassword);
        if (!await verifyPassword(currentPassword, credential)) {
            throw new HttpError(401, "The current password is incorrect.");
        }
        const updatedCredential = await hashPassword(newPassword);
        await db.runTransaction(async transaction => {
            const latest = await transaction.get(credentialRef);
            if (!latest.exists() ||
                latest.data().hash !== credential.hash ||
                latest.data().salt !== credential.salt) {
                throw new HttpError(409, "The password changed during this request. Sign in again and retry.");
            }
            transaction.set(credentialRef, updatedCredential);
        });
        await clearLoginAttempts(db, rateLimitRef);
        return res.status(200).json({ status: "updated", serverTime: Date.now() });
    } catch (error) {
        return sendError(req, res, error);
    }
};
