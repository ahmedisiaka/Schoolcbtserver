const fs = require("node:fs/promises");
const path = require("node:path");
const { authenticate, getDb } = require("../lib/firebase");
const { handleOptions, HttpError, sendError, setCorsHeaders } = require("../lib/http");
const { isYearAllowed, normalizeAllowedSubjects, normalizeAllowedYears, SUBJECTS } = require("../lib/subjects");
const { assertSchool, getTenant } = require("../lib/tenant");

async function getActiveComputer(db, root, uid, tenant) {
    const [activeSnapshot, inactiveSnapshot] = await Promise.all([
        db.doc(`${root}/computers/active/${uid}`).get(),
        db.doc(`${root}/computers/inactive/${uid}`).get()
    ]);
    if (inactiveSnapshot.exists || !activeSnapshot.exists) return null;

    const device = activeSnapshot.data();
    const schoolSnapshot = await assertSchool(tenant, device.schoolId, db);
    const expiry = device.expiresAt?.toDate?.();
    if (device.status !== "active" || !expiry || expiry.getTime() <= Date.now()) return null;
    if (schoolSnapshot.data().status !== "active") return null;
    if (typeof device.accessCode !== "string") return null;

    const codeSnapshot = await db.doc(`${root}/accessCodes/items/${device.accessCode}`).get();
    if (!codeSnapshot.exists) return null;
    const code = codeSnapshot.data();
    if (code.enabled !== true || code.schoolId !== device.schoolId ||
        !Array.isArray(code.usedBy) || !code.usedBy.includes(uid)) return null;
    return {
        allowedSubjects: normalizeAllowedSubjects(code.allowedSubjects),
        allowedYears: normalizeAllowedYears(code.allowedYears)
    };
}

async function isActiveAdmin(db, uid) {
    const snapshot = await db.doc(`admins/${uid}`).get();
    const admin = snapshot.exists ? snapshot.data() : null;
    return admin?.admin === true && admin.status === "active";
}

async function listAvailableFiles(dataRoot) {
    const entries = await fs.readdir(dataRoot, { withFileTypes: true });
    const years = entries.filter(entry => entry.isDirectory() && /^\d{4}$/.test(entry.name))
        .map(entry => entry.name).sort((a, b) => Number(b) - Number(a));
    const jamb = [];
    for (const year of years) {
        const files = await fs.readdir(path.join(dataRoot, year), { withFileTypes: true });
        jamb.push({
            year,
            subjects: files.filter(file => file.isFile() && file.name.endsWith(".json"))
                .map(file => file.name.slice(0, -5).toLowerCase())
                .filter(subject => SUBJECTS.JAMB.includes(subject))
                .sort()
        });
    }

    let jsceSubjects = [];
    try {
        const files = await fs.readdir(path.join(dataRoot, "jsce"), { withFileTypes: true });
        jsceSubjects = files.filter(file => file.isFile() && file.name.endsWith(".json"))
            .map(file => file.name.slice(0, -5).toLowerCase())
            .filter(subject => SUBJECTS.JSCE.includes(subject))
            .sort();
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    return { jamb, jsceSubjects };
}

module.exports = async function questionCatalogHandler(req, res) {
    if (handleOptions(req, res)) return;
    setCorsHeaders(res);
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET, OPTIONS");
        return res.status(405).json({ error: "This request is not supported." });
    }

    try {
        const tenant = getTenant(req);
        const db = getDb();
        const identity = await authenticate(req);
        const computer = await getActiveComputer(db, tenant.dataRoot, identity.uid, tenant);
        const isAdmin = tenant.developerAdmin && !computer && await isActiveAdmin(db, identity.uid);
        if (!computer && !isAdmin) {
            throw new HttpError(403, "Question bank access denied. Contact your school administrator.");
        }

        const catalog = await listAvailableFiles(path.resolve(__dirname, "_question-data"));
        if (isAdmin) {
            return res.status(200).json({ jamb: catalog.jamb, jsceSubjects: catalog.jsceSubjects });
        }

        const jamb = catalog.jamb.map(entry => ({
            year: entry.year,
            subjects: entry.subjects.filter(subject =>
                computer.allowedSubjects.JAMB.includes(subject) &&
                isYearAllowed(computer.allowedYears, "JAMB", entry.year))
        })).filter(entry => entry.subjects.length);
        const jsceSubjects = catalog.jsceSubjects.filter(subject =>
            computer.allowedSubjects.JSCE.includes(subject) &&
            isYearAllowed(computer.allowedYears, "JSCE", "jsce"));
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).json({ jamb, jsceSubjects });
    } catch (error) {
        return sendError(req, res, error);
    }
};
