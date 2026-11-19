const { authenticate, getDb } = require("../lib/firebase");
const { handleOptions, sendError, setCorsHeaders } = require("../lib/http");
const { normalizeAllowedSubjects, normalizeAllowedYears } = require("../lib/subjects");
const { assertSchool, getTenant } = require("../lib/tenant");

module.exports = async function accessHandler(req, res) {
    if (handleOptions(req, res)) return;
    setCorsHeaders(res);
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET, OPTIONS");
        return res.status(405).json({ error: "This request is not supported." });
    }

    try {
        const tenant = getTenant(req);
        const ROOT = tenant.dataRoot;
        const identity = await authenticate(req);
        const db = getDb();
        const uid = identity.uid;
        const [activeSnapshot, inactiveSnapshot] = await Promise.all([
            db.doc(`${ROOT}/computers/active/${uid}`).get(),
            db.doc(`${ROOT}/computers/inactive/${uid}`).get()
        ]);
        if (inactiveSnapshot.exists) return res.status(200).json({ status: "inactive" });
        if (!activeSnapshot.exists) return res.status(200).json({ status: "unregistered" });

        const device = activeSnapshot.data();
        assertSchool(tenant, device.schoolId);
        const expiresAt = device.expiresAt?.toDate?.();
        if (device.status !== "active") return res.status(200).json({ status: "inactive" });
        if (!expiresAt || expiresAt.getTime() <= Date.now()) {
            return res.status(200).json({ status: "expired" });
        }

        const schoolSnapshot = await db.doc(`${ROOT}/schools/items/${device.schoolId}`).get();
        if (!schoolSnapshot.exists || schoolSnapshot.data().status !== "active") {
            return res.status(200).json({ status: "inactive" });
        }

        const accessCodeSnapshot = typeof device.accessCode === "string"
            ? await db.doc(`${ROOT}/accessCodes/items/${device.accessCode}`).get()
            : null;
        const allowedSubjects = accessCodeSnapshot?.exists
            ? accessCodeSnapshot.data().allowedSubjects
            : device.allowedSubjects;
        const allowedYears = accessCodeSnapshot?.exists
            ? accessCodeSnapshot.data().allowedYears
            : device.allowedYears;

        return res.status(200).json({
            status: "active",
            device: {
                uid,
                schoolId: device.schoolId,
                schoolName: device.schoolName || schoolSnapshot.data().name || "",
                computerName: device.computerName || "",
                allowedSubjects: normalizeAllowedSubjects(allowedSubjects),
                allowedYears: normalizeAllowedYears(allowedYears)
            },
            expiresAt: expiresAt.toISOString()
        });
    } catch (error) {
        return sendError(req, res, error);
    }
};
