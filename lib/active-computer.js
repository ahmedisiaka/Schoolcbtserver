const { assertSchool } = require("./tenant");

async function getActiveComputer(db, tenant, uid) {
    const [activeSnapshot, inactiveSnapshot] = await Promise.all([
        db.doc(`${tenant.dataRoot}/computers/active/${uid}`).get(),
        db.doc(`${tenant.dataRoot}/computers/inactive/${uid}`).get()
    ]);
    if (inactiveSnapshot.exists || !activeSnapshot.exists) return null;

    const device = activeSnapshot.data();
    const schoolSnapshot = await assertSchool(tenant, device.schoolId, db);
    const expiresAt = device.expiresAt?.toDate?.();
    if (device.status !== "active" || !expiresAt || expiresAt.getTime() <= Date.now() ||
        schoolSnapshot.data().status !== "active" || typeof device.accessCode !== "string") {
        return null;
    }

    const codeSnapshot = await db.doc(`${tenant.dataRoot}/accessCodes/items/${device.accessCode}`).get();
    if (!codeSnapshot.exists) return null;
    const code = codeSnapshot.data();
    if (code.enabled !== true || code.schoolId !== device.schoolId ||
        !Array.isArray(code.usedBy) || !code.usedBy.includes(uid)) return null;
    return device;
}

module.exports = { getActiveComputer };
