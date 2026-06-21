/**
 * openaiVision.js — OpenAI Vision Provider
 *
 * Uses OpenAI's vision model (GPT-4o) to review food safety form images.
 * Returns structured JSON with field-level value interpretation.
 */

const https = require("https");
const fs = require("fs");
const logger = require("../../logger");

function config() {
    return {
        apiKey: process.env.OPENAI_API_KEY,
        baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com",
        model: process.env.OPENAI_VISION_MODEL || "gpt-4o",
        timeoutMs: Number(process.env.VISION_TIMEOUT_MS || 15000),
    };
}

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

    const cfg = config();
    if (!cfg.apiKey) {
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
        model: cfg.model,
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

    const baseUrl = parseBaseUrl(cfg.baseUrl);
    // If base URL already includes /v1, don't duplicate it
    const pathSuffix = baseUrl.path.endsWith("/v1") ? baseUrl.path : (baseUrl.path || "") + "/v1";
    const apiPath = pathSuffix + "/chat/completions";

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            resolve({ available: false, reason: "Vision API timeout" });
        }, cfg.timeoutMs);

        const req = https.request(
            {
                hostname: baseUrl.hostname,
                port: baseUrl.port,
                path: apiPath,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${cfg.apiKey}`,
                },
                timeout: cfg.timeoutMs,
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
    return !!config().apiKey;
}

async function extractForm(opts) {
    const cfg = config();
    const {
        imagePath,
        storeInfo,
        traceId,
        imageHash,
        chatName,
        fields = [],
    } = opts || {};

    if (!cfg.apiKey) {
        return {
            available: false,
            provider: "openai",
            model: cfg.model,
            called: false,
            reason: "OPENAI_API_KEY not set",
        };
    }

    const imageBuffer = fs.readFileSync(imagePath);
    const imageBase64 = imageBuffer.toString("base64");
    const mimeType = imagePath.endsWith(".png") ? "image/png" : "image/jpeg";
    const fieldList = fields.map((f) => {
        const range = f.range ? `${f.range[0]}-${f.range[1]}F` : "unknown";
        return `${f.field_id}: ${f.label} (${range})`;
    }).join("\n");

    const prompt = [
        "You are the primary runtime vision pipeline for a restaurant Food Safety temperature log.",
        "Do not use OCR guesses. Read the full image directly.",
        `Trace ID: ${traceId || ""}`,
        `Image hash: ${imageHash || ""}`,
        `WhatsApp group: ${chatName || ""}`,
        `Expected store: ${storeInfo ? `${storeInfo.storeName} / ${storeInfo.storeCode}` : "unknown"}`,
        `Expected template: ${storeInfo ? storeInfo.templateId : "unknown"}`,
        "",
        "Return JSON only. No markdown.",
        "If the image is not an official Food Safety form, set is_food_safety_form=false and leave readings empty.",
        "If it is a form, identify the selected/filled column as 10AM or 4PM.",
        "For blank or unreadable cells, use value=null with low confidence.",
        "",
        "Fields:",
        fieldList || "(no fields supplied)",
        "",
        "JSON schema:",
        "{",
        '  "is_food_safety_form": true,',
        '  "store": "Stone Oak",',
        '  "template_id": "FoodSafety-StoneOak-v3",',
        '  "date": "YYYY-MM-DD or null",',
        '  "selected_column": "10AM or 4PM or null",',
        '  "overall_confidence": 0.0,',
        '  "readings": [',
        '    {"field_id":"SO-01","value":37,"raw_text":"37","confidence":0.92,"notes":""}',
        "  ]",
        "}",
    ].join("\n");

    const body = JSON.stringify({
        model: cfg.model,
        max_tokens: Number(process.env.OPENAI_VISION_FORM_MAX_TOKENS || 2500),
        response_format: { type: "json_object" },
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

    const baseUrl = parseBaseUrl(cfg.baseUrl);
    const pathSuffix = baseUrl.path.endsWith("/v1") ? baseUrl.path : (baseUrl.path || "") + "/v1";
    const apiPath = pathSuffix + "/chat/completions";
    const startedAt = Date.now();

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            resolve({
                available: false,
                provider: "openai",
                model: cfg.model,
                called: true,
                reason: "Vision API timeout",
                latency_ms: Date.now() - startedAt,
            });
        }, cfg.timeoutMs);

        const req = https.request(
            {
                hostname: baseUrl.hostname,
                port: baseUrl.port,
                path: apiPath,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${cfg.apiKey}`,
                },
                timeout: cfg.timeoutMs,
            },
            (res) => {
                let data = "";
                res.on("data", (chunk) => { data += chunk; });
                res.on("end", () => {
                    clearTimeout(timeout);
                    const latencyMs = Date.now() - startedAt;
                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices && parsed.choices[0] && parsed.choices[0].message
                            ? parsed.choices[0].message.content
                            : "";
                        const result = JSON.parse(content);
                        resolve({
                            available: true,
                            provider: "openai",
                            model: cfg.model,
                            called: true,
                            latency_ms: latencyMs,
                            openai_request_id: res.headers["x-request-id"] || null,
                            ...result,
                        });
                    } catch (err) {
                        logger.warn("[OpenAI Vision] Form extraction parse error", { error: err.message });
                        resolve({
                            available: false,
                            provider: "openai",
                            model: cfg.model,
                            called: true,
                            reason: `Parse error: ${err.message}`,
                            latency_ms: latencyMs,
                        });
                    }
                });
            }
        );

        req.on("error", (err) => {
            clearTimeout(timeout);
            logger.warn("[OpenAI Vision] Form extraction request error", { error: err.message });
            resolve({
                available: false,
                provider: "openai",
                model: cfg.model,
                called: true,
                reason: err.message,
                latency_ms: Date.now() - startedAt,
            });
        });

        req.on("timeout", () => {
            clearTimeout(timeout);
            req.destroy();
            resolve({
                available: false,
                provider: "openai",
                model: cfg.model,
                called: true,
                reason: "Request timeout",
                latency_ms: Date.now() - startedAt,
            });
        });

        req.write(body);
        req.end();
    });
}

module.exports = { reviewField, extractForm, isAvailable };
