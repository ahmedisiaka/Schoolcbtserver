const SUBJECTS = {
    JAMB: [
        "accounting",
        "agriculturalscience",
        "biology",
        "chemistry",
        "commerce",
        "economics",
        "geography",
        "government",
        "history",
        "literatureinenglish",
        "mathematics",
        "physics",
        "useofenglish"
    ],
    JSCE: [
        "basicscience",
        "basictechnology",
        "businessstudies",
        "christianreligiousstudies",
        "civiceducation",
        "computerstudies",
        "creativearts",
        "englishlangu",
        "frenchlanguage",
        "hausalanguage",
        "history",
        "islamicreligiousstudies",
        "mathematics",
        "physicalandhealtheducation",
        "prevocationalstudies",
        "socialstudies",
        "yorubalanguage"
    ]
};

function normalizeAllowedSubjects(value) {
    const result = {};
    for (const exam of Object.keys(SUBJECTS)) {
        const selected = Array.isArray(value?.[exam]) ? value[exam] : [];
        result[exam] = [...new Set(selected.filter(subject =>
            typeof subject === "string" && SUBJECTS[exam].includes(subject)
        ))];
    }
    return result;
}

function parseQuestionPath(relativePath) {
    if (typeof relativePath !== "string") return null;
    const match = /^data\/(\d{4}|jsce)\/([a-z0-9_-]+)\.json$/i.exec(relativePath);
    if (!match) return null;
    const exam = match[1].toLowerCase() === "jsce" ? "JSCE" : "JAMB";
    const subject = match[2].toLowerCase();
    return SUBJECTS[exam].includes(subject) ? { exam, subject } : null;
}

module.exports = { SUBJECTS, normalizeAllowedSubjects, parseQuestionPath };
