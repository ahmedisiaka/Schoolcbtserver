const { authenticate, getDb } = require("../lib/firebase");
const { handleOptions, HttpError, sendError, setCorsHeaders } = require("../lib/http");
const { encryptSecret } = require("../lib/school-secrets");
const { getTenant } = require("../lib/tenant");
const { FieldValue } = require("firebase-admin/firestore");

async function assertDeveloperAdmin(db, uid) {
    const snapshot = await db.doc(`admins/${uid}`).get();
    const admin = snapshot.exists ? snapshot.data() : null;
    if (admin?.admin !== true || admin.status !== "active") {
        throw new HttpError(403, "Developer administrator access is required.");
    }
}

module.exports = async function schoolSettingsHandler(req, res) {
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
        await assertDeveloperAdmin(db, identity.uid);

        const { schoolIds, updates, apiKey, clearApiKey = false } = req.body || {};
        if (!Array.isArray(schoolIds) || schoolIds.length < 1 || schoolIds.length > 200 ||
            schoolIds.some(id => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(id))) {
            throw new HttpError(400, "Select at least one valid school.");
        }
        const updateTypes = ["questions", "exams", "apiKey"];
        if (!updates || typeof updates !== "object" || Array.isArray(updates) ||
            Object.keys(updates).some(type => !updateTypes.includes(type)) ||
            !updateTypes.some(type => updates[type] === true) ||
            updateTypes.some(type => updates[type] !== undefined && typeof updates[type] !== "boolean")) {
            throw new HttpError(400, "Choose at least one update type.");
        }
        if (typeof clearApiKey !== "boolean" || (clearApiKey && !updates.apiKey)) {
            throw new HttpError(400, "Choose whether to update or clear the school API key.");
        }
        if (updates.apiKey && !clearApiKey &&
            (typeof apiKey !== "string" || apiKey.trim().length < 20 || apiKey.trim().length > 500)) {
            throw new HttpError(400, "Enter a valid school AI API key or choose to clear the current key.");
        }
        if (!tenant.dataRoot) throw new HttpError(403, "This app is not configured for school administration.");

        const uniqueSchoolIds = [...new Set(schoolIds)];
        if (!tenant.developerAdmin && uniqueSchoolIds.some(schoolId => schoolId !== tenant.schoolId)) {
            throw new HttpError(403, "This app is not configured to update the selected school.");
        }
        const schoolRefs = uniqueSchoolIds.map(schoolId =>
            db.doc(`schoolDirectory/${schoolId}`)
        );
        await db.runTransaction(async transaction => {
            const schoolSnapshots = await Promise.all(schoolRefs.map(schoolRef => transaction.get(schoolRef)));
            if (schoolSnapshots.some(snapshot => !snapshot.exists)) {
                throw new HttpError(404, "One or more selected schools could not be found.");
            }
            const configRefs = schoolSnapshots.map((snapshot, index) => {
                const school = snapshot.data();
                if (school.status !== "active" ||
                    !/^[A-Za-z0-9_-]{1,100}$/.test(school.dataRoot || "")) {
                    throw new HttpError(403, "One or more selected schools are not configured.");
                }
                if (!tenant.developerAdmin &&
                    (school.dataRoot !== tenant.dataRoot || uniqueSchoolIds[index] !== tenant.schoolId)) {
                    throw new HttpError(403, "This app is not configured to update the selected school.");
                }
                return db.doc(`${school.dataRoot}/schoolRuntime/items/${uniqueSchoolIds[index]}`);
            });
            const configSnapshots = await Promise.all(configRefs.map(configRef => transaction.get(configRef)));
            for (const [index, schoolId] of uniqueSchoolIds.entries()) {
                const previous = configSnapshots[index].exists ? configSnapshots[index].data() : {};
                const nextUpdates = {};
                const nextRevisions = {};
                for (const type of updateTypes) {
                    nextUpdates[type] = previous.updates?.[type] === true || updates[type] === true;
                    nextRevisions[type] = Math.max(0, Number(previous.revisions?.[type]) || 0) +
                        (updates[type] === true ? 1 : 0);
                }
                const next = {
                    updates: nextUpdates,
                    revisions: nextRevisions,
                    updatedAt: FieldValue.serverTimestamp(),
                    updatedBy: identity.uid
                };
                if (updates.apiKey) {
                    next.geminiApiKey = clearApiKey ? FieldValue.delete() : encryptSecret(apiKey.trim());
                }
                transaction.set(configRefs[index], next, { merge: true });
            }
        });

        return res.status(200).json({ success: true, updatedSchools: uniqueSchoolIds.length });
    } catch (error) {
        return sendError(req, res, error);
    }
};
