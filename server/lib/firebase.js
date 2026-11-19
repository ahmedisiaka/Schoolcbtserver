const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

function getAdminApp() {
    const existing = getApps()[0];
    if (existing) return existing;

    const credentialsJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!credentialsJson) {
        throw new Error("The server is not configured for school access.");
    }

    let credentials;
    try {
        credentials = JSON.parse(credentialsJson);
    } catch {
        throw new Error("The server is not configured for school access.");
    }

    if (typeof credentials.private_key === "string") {
        credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
    }
    return initializeApp({ credential: cert(credentials) });
}

async function authenticate(req) {
    const authorization = req.headers.authorization || "";
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    if (!match) {
        const error = new Error("Please reconnect and try again.");
        error.statusCode = 401;
        throw error;
    }

    try {
        return await getAuth(getAdminApp()).verifyIdToken(match[1]);
    } catch {
        const error = new Error("Your session has expired. Reopen the app and try again.");
        error.statusCode = 401;
        throw error;
    }
}

function getDb() {
    return getFirestore(getAdminApp());
}

module.exports = { authenticate, getDb };
