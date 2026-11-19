const { HttpError, handleOptions, sendError, setCorsHeaders } = require("../lib/http");

const REPOSITORY = "ahmedisiaka/Schoolcbtserver";
const REF = "main";

module.exports = async function questionDataHandler(req, res) {
    if (handleOptions(req, res)) return;
    setCorsHeaders(res);
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET, OPTIONS");
        return res.status(405).json({ error: "This request is not supported." });
    }

    try {
        const relativePath = req.query?.path;
        if (typeof relativePath !== "string" ||
            !/^data\/(?:\d{4}|jsce)\/[a-z0-9_-]+\.json$/i.test(relativePath)) {
            throw new HttpError(400, "The requested question data is not available.");
        }
        const token = process.env.GITHUB_DATA_READ_TOKEN;
        if (!token) throw new HttpError(503, "Question data is temporarily unavailable.");
        const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
        const response = await fetch(
            `https://api.github.com/repos/${REPOSITORY}/contents/${encodedPath}?ref=${REF}`,
            {
                headers: {
                    Accept: "application/vnd.github+json",
                    Authorization: `Bearer ${token}`,
                    "X-GitHub-Api-Version": "2022-11-28",
                    "User-Agent": "LIMLO-School-CBT"
                },
                signal: AbortSignal.timeout(8000)
            }
        );
        if (response.status === 404) {
            throw new HttpError(404, "Questions for this subject are not available yet.");
        }
        if (!response.ok) throw new HttpError(502, "Question data is temporarily unavailable.");

        let questions;
        try {
            const file = await response.json();
            if (file.type !== "file" || file.encoding !== "base64" || typeof file.content !== "string") {
                throw new Error("Unsupported GitHub content response.");
            }
            questions = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
        } catch {
            throw new HttpError(502, "Question data could not be loaded.");
        }
        if (!Array.isArray(questions) || questions.length === 0) {
            throw new HttpError(502, "Question data could not be loaded.");
        }
        res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
        return res.status(200).json(questions);
    } catch (error) {
        return sendError(res, error);
    }
};
