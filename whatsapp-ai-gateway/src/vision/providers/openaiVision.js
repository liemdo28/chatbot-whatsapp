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
        timeoutMs: Number(process.env.VISION_TIMEOUT_MS || 30000),
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

    const storeName = (storeInfo && storeInfo.storeName) || "unknown store";
    const storeCode = (storeInfo && storeInfo.storeCode) || "??";
    const templateId = storeInfo ? storeInfo.templateId : "unknown";

    const prompt = [
        "You are a food-safety auditor reading handwritten kitchen temperature log forms.",
        "Your job is to extract temperature readings written by line cooks at the start",
        "of shift. The handwriting is often rushed and may include cross-outs, smudges,",
        "or values that look implausible.",
        "",
        "CRITICAL ROW ALIGNMENT RULES:",
        "- Forms are TABLES with labeled rows and time columns (10AM and 4PM).",
        "- READ EACH ROW CAREFULLY: follow the horizontal line from the row label",
        "  to the correct cell. Do NOT mix up values between adjacent rows.",
        "- Walk-in freezers are ALWAYS near 0°F (-10 to 10°F range). If you see",
        "  a value > 20°F in a freezer row, you are reading the WRONG ROW.",
        "- Fryers typically read 300-380°F. Cold holding units (coolers, fridges)",
        "  read 33-45°F. Never confuse a cooler reading with a fryer or vice versa.",
        "- Hot holding (broth, eggs, warmers) reads 100-250°F.",
        "",
        "HANDWRITING RECOGNITION RULES:",
        "1. Read each numeric cell carefully. Distinguish 0/6, 1/7, 3/8, 5/6.",
        "   - A '0' written for freezer is valid. Do not confuse with '10' or '100'.",
        "   - Two-digit vs three-digit: '38' in a cold unit is correct; '380' in a",
        "     cold unit means you read from the wrong row.",
        "   - Common misreads: '4' can be '1', '7' can be '1', '6' can be '0'.",
        "   - If a value seems wildly wrong for its row, re-examine the cell.",
        "2. Each row has a 10:00 AM column and a 4:00 PM column. Read ONLY the column",
        "   that has visible handwritten values.",
        "3. If only the 10AM column has values, report them as the main 'value' and set selected_column='10AM'.",
        "4. If only the 4PM column has values, report them as the main 'value' and set selected_column='4PM'.",
        "5. If a cell is empty, illegible, or crossed out, report value=null with confidence=0.0.",
        "6. For each reading, give a confidence score 0.0-1.0:",
        "   - 1.0 = unambiguous, clearly written, single digit set",
        "   - 0.8 = clear but minor smudge or one ambiguous digit",
        "   - 0.5 = strong guess, multiple possible readings",
        "   - 0.2 = barely legible",
        "   - 0.0 = couldn't read at all (then value=null too)",
        "7. Apply common sense: if a written value is far outside the target range,",
        "   re-examine the cell and the row label. You may be reading the wrong row.",
        "   KEEP the literal reading but lower confidence and add a note if unsure.",
        "   Do NOT silently correct values.",
        "8. The 'raw_text' field is what you literally see written, exactly as scribbled.",
        "9. DOUBLE-CHECK each value: for every field, verify the row label matches",
        "   the expected category. Cold items ≤ 45°F, hot items ≥ 100°F, fryers ≥ 300°F.",
        "",
        `Store: ${storeName} (${storeCode})`,
        `Template: ${templateId}`,
        `Trace ID: ${traceId || ""}`,
        `Image hash: ${imageHash || ""}`,
        `WhatsApp group: ${chatName || ""}`,
        "",
        "Return JSON only. No markdown.",
        "If the image is not an official Food Safety form, set is_food_safety_form=false and leave readings empty.",
        "If it is a form, identify which column (10AM or 4PM) has visible handwritten values.",
        "",
        "Fields with expected ranges:",
        fieldList || "(no fields supplied)",
        "",
        "JSON schema:",
        "{",
        '  "is_food_safety_form": true,',
        '  "store": "Store Name from header",',
        '  "template_id": "template id",',
        '  "date": "YYYY-MM-DD or null",',
        '  "selected_column": "10AM or 4PM or null",',
        '  "overall_confidence": 0.0,',
        '  "readings": [',
        '    {"field_id":"RIM-01","value":40,"raw_text":"40","confidence":0.95,"notes":""}',
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
