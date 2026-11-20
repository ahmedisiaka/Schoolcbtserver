const { createCipheriv, createDecipheriv, createHash, randomBytes } = require("node:crypto");

function getEncryptionKey() {
    const secret = process.env.CBT_SECRET_ENCRYPTION_KEY;
    if (!secret || secret.length < 32) {
        const error = new Error("School API key storage is not configured.");
        error.statusCode = 503;
        throw error;
    }
    return createHash("sha256").update(secret, "utf8").digest();
}

function encryptSecret(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return {
        version: 1,
        iv: iv.toString("base64"),
        ciphertext: ciphertext.toString("base64"),
        tag: cipher.getAuthTag().toString("base64")
    };
}

function decryptSecret(record) {
    if (!record || record.version !== 1) {
        throw new Error("School API key is unavailable.");
    }
    const decipher = createDecipheriv(
        "aes-256-gcm",
        getEncryptionKey(),
        Buffer.from(record.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(record.tag, "base64"));
    return Buffer.concat([
        decipher.update(Buffer.from(record.ciphertext, "base64")),
        decipher.final()
    ]).toString("utf8");
}

module.exports = { decryptSecret, encryptSecret };
