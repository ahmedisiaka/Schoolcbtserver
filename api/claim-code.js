const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { authenticate, getDb } = require("../lib/firebase");
const { handleOptions, HttpError, sendError, setCorsHeaders } = require("../lib/http");
const { normalizeAllowedSubjects, normalizeAllowedYears } = require("../lib/subjects");
const { assertSchool, getTenant } = require("../lib/tenant");

const ACCESS_DAYS = 30;

module.exports = async function claimCodeHandler(req, res) {
    if (handleOptions(req, res)) return;
    setCorsHeaders(res);
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST, OPTIONS");
        return res.status(405).json({ error: "This request is not supported." });
    }

    try {
        const tenant = getTenant(req);
        const ROOT = tenant.dataRoot;
        const identity = await authenticate(req);
        const code = typeof req.body?.code === "string" ? req.body.code.trim().toUpperCase() : "";
        if (!code || code.length > 80) throw new HttpError(400, "Enter a valid school access code.");

        const db = getDb();
        const uid = identity.uid;
        const codeRef = db.doc(`${ROOT}/accessCodes/items/${code}`);
        const activeRef = db.doc(`${ROOT}/computers/active/${uid}`);
        const inactiveRef = db.doc(`${ROOT}/computers/inactive/${uid}`);
        const outcome = await db.runTransaction(async transaction => {
            const [codeSnapshot, activeSnapshot, inactiveSnapshot] = await Promise.all([
                transaction.get(codeRef),
                transaction.get(activeRef),
                transaction.get(inactiveRef)
            ]);
            if (!codeSnapshot.exists) throw new HttpError(400, "That access code is not valid.");
            const accessCode = codeSnapshot.data();
            assertSchool(tenant, accessCode.schoolId);
            const allowedSubjects = normalizeAllowedSubjects(accessCode.allowedSubjects);
            const allowedYears = normalizeAllowedYears(accessCode.allowedYears);
            const usedCount = Number(accessCode.usedCount || 0);
            const maxComputers = Number(accessCode.maxComputers);
            const codeExpiry = accessCode.expiresAt?.toDate?.();
            const usedBy = Array.isArray(accessCode.usedBy) ? accessCode.usedBy : [];

            if (accessCode.enabled !== true) throw new HttpError(403, "That access code has been disabled.");
            if (!codeExpiry || codeExpiry.getTime() <= Date.now()) {
                throw new HttpError(403, "That access code has expired.");
            }
            if (!Number.isInteger(usedCount) || !Number.isInteger(maxComputers) ||
                usedCount < 0 || maxComputers < 1 || usedCount >= maxComputers) {
                throw new HttpError(403, "All computer activations for that code have been used.");
            }
            if (usedBy.includes(uid)) {
                throw new HttpError(409, "This computer has already used that code.");
            }
            if (inactiveSnapshot.exists) {
                throw new HttpError(403, "This computer is suspended. Contact Limlo Technologies.");
            }
            if (activeSnapshot.exists) {
                const currentExpiry = activeSnapshot.data().expiresAt?.toDate?.();
                if (currentExpiry && currentExpiry.getTime() > Date.now()) {
                    throw new HttpError(409, "This computer already has active access.");
                }
            }

            const schoolRef = db.doc(`${ROOT}/schools/items/${accessCode.schoolId}`);
            const schoolSnapshot = await transaction.get(schoolRef);
            if (!schoolSnapshot.exists || schoolSnapshot.data().status !== "active") {
                throw new HttpError(403, "The school attached to this code is not active.");
            }

            const school = schoolSnapshot.data();
            const computerName = Array.isArray(accessCode.computerNames)
                ? accessCode.computerNames[usedCount]
                : `${accessCode.schoolId}-LEGACY-${uid}`;
            if (typeof computerName !== "string" || !computerName) {
                throw new HttpError(400, "This access code needs attention. Contact Limlo Technologies.");
            }

            const registeredAt = activeSnapshot.exists
                ? activeSnapshot.data().registeredAt || Timestamp.now()
                : Timestamp.now();
            const now = Timestamp.now();
            const expiresAt = Timestamp.fromMillis(now.toMillis() + ACCESS_DAYS * 24 * 60 * 60 * 1000);
            transaction.update(codeRef, {
                usedCount: usedCount + 1,
                usedBy: FieldValue.arrayUnion(uid),
                updatedAt: FieldValue.serverTimestamp()
            });
            transaction.set(activeRef, {
                uid,
                computerName,
                schoolId: accessCode.schoolId,
                schoolName: school.name || "",
                status: "active",
                accessCode: code,
                allowedSubjects,
                allowedYears,
                registeredAt,
                updatedAt: FieldValue.serverTimestamp(),
                expiresAt
            });
            return {
                device: {
                    uid,
                    computerName,
                    schoolId: accessCode.schoolId,
                    schoolName: school.name || "",
                    allowedSubjects,
                    allowedYears
                },
                expiresAt: expiresAt.toDate().toISOString()
            };
        });
        return res.status(200).json({ status: "active", ...outcome });
    } catch (error) {
        return sendError(req, res, error);
    }
};
