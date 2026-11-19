const { randomUUID } = require("node:crypto");

class HttpError extends Error {
    constructor(statusCode, message, options = {}) {
        super(message);
        this.statusCode = statusCode;
        this.expose = options.expose === true;
        this.details = options.details;
    }
}

function setCorsHeaders(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-CBT-Data-Root, X-CBT-School-Id");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
}

function handleOptions(req, res) {
    setCorsHeaders(res);
    if (req.method !== "OPTIONS") return false;
    res.status(204).end();
    return true;
}

function sendError(req, res, error) {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    if (statusCode < 500) {
        return res.status(statusCode).json({ error: error.message });
    }

    const suppliedId = req.headers?.["x-vercel-id"] || req.headers?.["x-request-id"];
    const requestId = typeof suppliedId === "string" && suppliedId.length <= 200
        ? suppliedId
        : randomUUID();
    console.error("School CBT API request failed.", {
        requestId,
        method: req.method,
        errorName: error.name,
        errorCode: error.code,
        errorMessage: error.message,
        ...(error.details ? { details: error.details } : {}),
        stack: error.stack
    });
    res.setHeader("X-Request-Id", requestId);
    return res.status(statusCode).json({
        error: error.expose
            ? error.message
            : "The service is temporarily unavailable. Please try again.",
        requestId
    });
}

module.exports = { HttpError, handleOptions, sendError, setCorsHeaders };
