const { authenticate, getDb } = require("../lib/firebase");
const { handleOptions, sendError, setCorsHeaders } = require("../lib/http");

const ROOT = "GIBBORSHUB";

module.exports = async function accessHandler(req, res) {
    if (handleOptions(req, res)) return;
    setCorsHeaders(res);
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET, OPTIONS");
        return res.status(405).json({ error: "This request is not supported." });
    }

    try {
        const identity = await authenticate(req);
        const uid = identity.uid;
        const db = getDb();
        const activeRef = db.doc(`${ROOT}/computers/active/${uid}`);
        const inactiveRef = db.doc(`${ROOT}/computers/inactive/${uid}`);
        const [activeSnapshot, inactiveSnapshot] = await Promise.all([
            activeRef.get(),
            inactiveRef.get()
        ]);

        if (inactiveSnapshot.exists) {
            return res.status(200).json({ status: "inactive" });
        }
        if (!activeSnapshot.exists) {
            return res.status(200).json({ status: "unregistered" });
        }

        const device = activeSnapshot.data();
        const expiresAt = device.expiresAt?.toDate?.();
        if (device.status !== "active") {
            return res.status(200).json({ status: "inactive" });
        }
        if (!expiresAt || expiresAt.getTime() <= Date.now()) {
            return res.status(200).json({ status: "expired" });
        }

        const schoolSnapshot = await db.doc(`${ROOT}/schools/items/${device.schoolId}`).get();
        if (!schoolSnapshot.exists || schoolSnapshot.data().status !== "active") {
            return res.status(200).json({ status: "inactive" });
        }

        return res.status(200).json({
            status: "active",
            device: {
                uid,
                schoolId: device.schoolId,
                schoolName: device.schoolName || schoolSnapshot.data().name || "",
                computerName: device.computerName || ""
            },
            expiresAt: expiresAt.toISOString()
        });
    } catch (error) {
        return sendError(res, error);
    }
};
