class HttpError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }
}

function setCorsHeaders(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
}

function handleOptions(req, res) {
    setCorsHeaders(res);
    if (req.method !== "OPTIONS") return false;
    res.status(204).end();
    return true;
}

function sendError(res, error) {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    if (statusCode >= 500) console.error("School CBT API request failed.");
    return res.status(statusCode).json({
        error: statusCode >= 500 ? "The service is temporarily unavailable. Please try again." : error.message
    });
}

module.exports = { HttpError, handleOptions, sendError, setCorsHeaders };
