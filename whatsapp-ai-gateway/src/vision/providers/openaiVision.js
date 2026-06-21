/**
 * openaiVision.js — OpenAI Vision Provider
 *
 * Uses OpenAI's vision model (GPT-4o) to review food safety form images.
 * Returns structured JSON with field-level value interpretation.
 */

const https = require("https");
const fs = require("fs");
const logger = require("../../logger");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com";
const OPENAI_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o";
const VISION_TIMEOUT_MS = Number(process.env.VISION_TIMEOUT_MS || 15000);

// Parse base URL into hostname + path prefix
function parseBaseUrl(url) {
    try {
        const u = new URL(url);
        return { hostname: u.hostname, port: u.port || (u.protocol === "https:" ? "443" : "80"), path: u.pathname.replace(/\/+$/, "") };
    } catch (_) {
        return { hostname: "api.openai.com", port: "443", path: "" };
    }
}


async function reviewField(opts) {
    const {
        imagePath,
        fieldId,
        fieldLabel,
        expectedRange,
        ocrValue,
        memoryValue,
        storeCode,
        templateId,
    } = opts;

    if (!OPENAI_API_KEY) {
        return { available: false, reason: "OPENAI_API_KEY not set" };
    }

    const imageBuffer = fs.readFileSync(imagePath);
    const imageBase64 = imageBuffer.toString("base64");
    const mimeType = imagePath.endsWith(".png") ? "image/png" : "image/jpeg";

    const rangeStr = expectedRange ? `${expectedRange[0]}-${expectedRange[1]}F` : "unknown";
    const prompt = [
        `You are reviewing a Food Safety temperature log form for a restaurant.`,
        `Store: ${storeCode} / Template: ${templateId}`,
        `Field: ${fieldId} (${fieldLabel})`,
        `Expected range: ${rangeStr}`,
        `OCR read this cell as: ${ocrValue !== null && ocrValue !== undefined ? ocrValue + "F" : "blank/unclear"}`,
        memoryValue !== null && memoryValue !== undefined ? `Memory predicts: ${memoryValue}F` : "",
        "",
        `Look at the cell for ${fieldId} in the form image.`,
        `What temperature value do you see written in that cell?`,
        `If the cell is blank, respond with null.`,
        `If you can read a number, respond with that number.`,
        "",
        `Respond ONLY with valid JSON:`,
        `{`,
        `  "vision_value": <number or null>,`,
        `  "vision_confidence": <0.0 to 1.0>,`,
        `  "reason": "<brief explanation>",`,
        `  "should_override_ocr": <true or false>`,
        `}`,
    ].filter(Boolean).join("\n");

    const body = JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: 300,
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: prompt },
                    {
                        type: "image_url",
                        image_url: {
                            url: `data:${mimeType};base64,${imageBase64}`,
                            detail: "high",
                        },
                    },
                ],
            },
        ],
    });

    const baseUrl = parseBaseUrl(OPENAI_BASE_URL);
    // If base URL already includes /v1, don't duplicate it
    const pathSuffix = baseUrl.path.endsWith("/v1") ? baseUrl.path : (baseUrl.path || "") + "/v1";
    const apiPath = pathSuffix + "/chat/completions";

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            resolve({ available: false, reason: "Vision API timeout" });
        }, VISION_TIMEOUT_MS);

        const req = https.request(
            {
                hostname: baseUrl.hostname,
                port: baseUrl.port,
                path: apiPath,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${OPENAI_API_KEY}`,
                },
                timeout: VISION_TIMEOUT_MS,
            },
            (res) => {
                let data = "";
                res.on("data", (chunk) => { data += chunk; });
                res.on("end", () => {
                    clearTimeout(timeout);
                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices && parsed.choices[0] && parsed.choices[0].message
                            ? parsed.choices[0].message.content
                            : "";
                        // Extract JSON from response
                        const jsonMatch = content.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            const result = JSON.parse(jsonMatch[0]);
                            resolve({ available: true, ...result });
                        } else {
                            resolve({ available: true, vision_value: null, vision_confidence: 0, reason: "Could not parse vision response", should_override_ocr: false });
                        }
                    } catch (err) {
                        logger.warn("[OpenAI Vision] Parse error", { error: err.message });
                        resolve({ available: false, reason: `Parse error: ${err.message}` });
                    }
                });
            }
        );

        req.on("error", (err) => {
            clearTimeout(timeout);
            logger.warn("[OpenAI Vision] Request error", { error: err.message });
            resolve({ available: false, reason: err.message });
        });

        req.on("timeout", () => {
            clearTimeout(timeout);
            req.destroy();
            resolve({ available: false, reason: "Request timeout" });
        });

        req.write(body);
        req.end();
    });
}

async function isAvailable() {
    return !!OPENAI_API_KEY;
}

module.exports = { reviewField, isAvailable };
