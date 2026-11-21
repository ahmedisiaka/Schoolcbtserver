const { promisify } = require("node:util");
const { createHash, randomBytes, scrypt: scryptCallback, timingSafeEqual } = require("node:crypto");
const { FieldValue } = require("firebase-admin/firestore");
const { HttpError } = require("./http");

const scrypt = promisify(scryptCallback);
const PASSWORD_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function assertPassword(password) {
    if (typeof password !== "string" || password.length < 12 || password.length > 256) {
        throw new HttpError(400, "Use a password between 12 and 256 characters.");
    }
}

async function hashPassword(password) {
    assertPassword(password);
    const salt = randomBytes(16);
    const derivedKey = await scrypt(password, salt, PASSWORD_LENGTH, SCRYPT_OPTIONS);
    return {
        version: 1,
        algorithm: "scrypt",
        salt: salt.toString("base64"),
        hash: derivedKey.toString("base64"),
        updatedAt: FieldValue.serverTimestamp()
    };
}

async function verifyPassword(password, record) {
    if (typeof password !== "string" || password.length > 256 ||
        record?.algorithm !== "scrypt" || record.version !== 1) return false;
    let salt;
    let storedHash;
    try {
        salt = Buffer.from(record.salt, "base64");
        storedHash = Buffer.from(record.hash, "base64");
    } catch {
        return false;
    }
    if (salt.length !== 16 || storedHash.length !== PASSWORD_LENGTH) return false;
    const candidate = await scrypt(password, salt, PASSWORD_LENGTH, SCRYPT_OPTIONS);
    return timingSafeEqual(candidate, storedHash);
}

function loginAttemptRef(db, root, req) {
    const forwardedFor = req.headers["x-forwarded-for"];
    const clientIp = typeof forwardedFor === "string"
        ? forwardedFor.split(",")[0].trim().slice(0, 100)
        : "unknown";
    const key = createHash("sha256")
        .update(`${root}:${clientIp}`, "utf8")
        .digest("hex");
    return db.doc(`computerAdminRateLimits/items/${key}`);
}

async function consumeLoginAttempt(db, root, req) {
    const ref = loginAttemptRef(db, root, req);
    const now = Date.now();
    await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        const current = snapshot.exists ? snapshot.data() : {};
        const windowStartedAt = Number(current.windowStartedAt) || 0;
        const previousCount = now - windowStartedAt >= WINDOW_MS
            ? 0
            : Number(current.attemptCount) || 0;
        if (previousCount >= MAX_ATTEMPTS) {
            throw new HttpError(429, "Too many sign-in attempts. Wait 15 minutes and try again.");
        }
        transaction.set(ref, {
            windowStartedAt: previousCount ? windowStartedAt : now,
            attemptCount: previousCount + 1,
            updatedAt: FieldValue.serverTimestamp()
        });
    });
    return ref;
}

async function clearLoginAttempts(db, ref) {
    await ref.delete();
}

module.exports = {
    assertPassword,
    clearLoginAttempts,
    consumeLoginAttempt,
    hashPassword,
    verifyPassword
};
