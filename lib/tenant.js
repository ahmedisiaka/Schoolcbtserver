const { HttpError } = require("./http");

function isValidName(value) {
    return typeof value === "string" &&
        value.length > 0 &&
        value.length <= 120 &&
        value.trim() === value &&
        !/[\u0000-\u001f]/.test(value);
}

function getTenantRegistry() {
    const developerAdminName = process.env.CBT_DEVELOPER_ADMIN_SOFTWARE_NAME || "LIMLO Developer Admin";
    const rawRegistry = process.env.CBT_TENANTS_JSON;
    if (rawRegistry) {
        let registry;
        try {
            registry = JSON.parse(rawRegistry);
        } catch {
            throw new HttpError(503, "The school access service is not configured correctly.");
        }
        if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
            throw new HttpError(503, "The school access service is not configured correctly.");
        }
        if (!Object.prototype.hasOwnProperty.call(registry, developerAdminName)) {
            const firstTenant = Object.values(registry).find(value =>
                value && typeof value.dataRoot === "string"
            );
            const dataRoot = process.env.CBT_DEVELOPER_ADMIN_DATA_ROOT ||
                process.env.CBT_DATA_ROOT ||
                firstTenant?.dataRoot ||
                "GIBBORSHUB";
            const schoolId = process.env.CBT_DEVELOPER_ADMIN_SCHOOL_ID ||
                process.env.CBT_APP_SCHOOL_ID ||
                dataRoot;
            registry[developerAdminName] = {
                dataRoot,
                schoolId,
                schoolName: developerAdminName,
                developerAdmin: true
            };
        } else if (registry[developerAdminName] &&
            typeof registry[developerAdminName] === "object" &&
            registry[developerAdminName].developerAdmin === undefined) {
            registry[developerAdminName].developerAdmin = true;
        }
        return registry;
    }

    const dataRoot = process.env.CBT_DATA_ROOT || "GIBBORSHUB";
    const softwareName = process.env.CBT_SOFTWARE_NAME || "Gibbors Hub Schools";
    const schoolId = process.env.CBT_APP_SCHOOL_ID || dataRoot;
    const schoolName = process.env.CBT_SCHOOL_NAME || softwareName;
    return {
        [softwareName]: { dataRoot, schoolId, schoolName },
        [developerAdminName]: {
            dataRoot: process.env.CBT_DEVELOPER_ADMIN_DATA_ROOT || dataRoot,
            schoolId: process.env.CBT_DEVELOPER_ADMIN_SCHOOL_ID || schoolId,
            schoolName: developerAdminName,
            developerAdmin: true
        }
    };
}

function getTenant(req) {
    const softwareName = req.headers["x-cbt-software-name"];
    const requestedRoot = req.headers["x-cbt-data-root"];
    const requestedSchool = req.headers["x-cbt-school-id"] || "";
    if (!isValidName(softwareName) ||
        typeof requestedRoot !== "string" ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(requestedRoot) ||
        (requestedSchool && !/^[A-Za-z0-9_-]{1,120}$/.test(requestedSchool))) {
        throw new HttpError(403, "This app is not configured for school access.");
    }

    const registry = getTenantRegistry();
    const registeredTenant = registry[softwareName];
    if (!registeredTenant ||
        typeof registeredTenant.dataRoot !== "string" ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(registeredTenant.dataRoot) ||
        registeredTenant.dataRoot !== requestedRoot ||
        typeof registeredTenant.schoolId !== "string" ||
        !/^[A-Za-z0-9_-]{1,120}$/.test(registeredTenant.schoolId) ||
        !isValidName(registeredTenant.schoolName) ||
        (registeredTenant.developerAdmin !== undefined && typeof registeredTenant.developerAdmin !== "boolean")) {
        throw new HttpError(403, "This app is not configured for the requested school.");
    }
    if (requestedSchool && requestedSchool !== registeredTenant.schoolId) {
        throw new HttpError(403, "This app is not configured for this school.");
    }

    return {
        dataRoot: registeredTenant.dataRoot,
        schoolId: registeredTenant.schoolId,
        schoolName: registeredTenant.schoolName,
        developerAdmin: registeredTenant.developerAdmin === true,
        softwareName
    };
}

function assertSchoolRecord(tenant, schoolId, schoolSnapshot) {
    if (!tenant || !schoolSnapshot ||
        typeof schoolId !== "string" ||
        !/^[A-Za-z0-9_-]{1,120}$/.test(schoolId) ||
        schoolId !== tenant.schoolId) {
        throw new HttpError(403, "This school code is not valid for this school edition of the app.");
    }
    if (!schoolSnapshot.exists) {
        throw new HttpError(403, "This software is not registered to this school.");
    }
    const school = schoolSnapshot.data();
    const schoolRoot = String(school.dataRoot || "").trim();
    const registeredName = String(school.softwareName || school.name || "").trim().toLowerCase();
    if (schoolRoot !== tenant.dataRoot ||
        !registeredName ||
        registeredName !== tenant.schoolName.trim().toLowerCase()) {
        throw new HttpError(403, "This software does not match the registered school.");
    }
    return school;
}

async function assertSchool(tenant, schoolId, db) {
    if (!db) throw new HttpError(500, "The school access service is not configured correctly.");
    const schoolSnapshot = await db.doc(`schoolDirectory/${schoolId}`).get();
    assertSchoolRecord(tenant, schoolId, schoolSnapshot);
    return schoolSnapshot;
}

module.exports = { assertSchool, assertSchoolRecord, getTenant };
