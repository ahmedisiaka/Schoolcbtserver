const { HttpError } = require("./http");

function getTenant(req) {
    const dataRoot = process.env.CBT_DATA_ROOT || "GIBBORSHUB";
    const schoolId = process.env.CBT_APP_SCHOOL_ID || "";
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(dataRoot) ||
        (schoolId && !/^[A-Za-z0-9_-]{1,120}$/.test(schoolId))) {
        throw new HttpError(503, "The school access service is not configured correctly.");
    }

    const requestedRoot = req.headers["x-cbt-data-root"];
    const requestedSchool = req.headers["x-cbt-school-id"];
    if (requestedRoot && requestedRoot !== dataRoot) {
        throw new HttpError(403, "This app is not configured for the requested school data.");
    }
    if (schoolId && requestedSchool !== schoolId) {
        throw new HttpError(403, "This app is not configured for this school.");
    }
    return { dataRoot, schoolId };
}

function assertSchool(tenant, schoolId) {
    if (tenant.schoolId && tenant.schoolId !== schoolId) {
        throw new HttpError(403, "This school code is not valid for this school edition of the app.");
    }
}

module.exports = { assertSchool, getTenant };
