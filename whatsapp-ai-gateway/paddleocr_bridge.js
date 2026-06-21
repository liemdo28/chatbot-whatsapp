/**
 * paddleocr_bridge.js
 * ===================
 * Node.js bridge between whatsapp-ai-gateway and PaddleOCR Python service.
 * Sends images to the Python service for cell-level OCR extraction.
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const logger = require("./src/logger");

const PADDLEOCR_HOST = process.env.PADDLEOCR_HOST || "127.0.0.1";
const PADDLEOCR_PORT = process.env.PADDLEOCR_PORT || "5501";
const PADDLEOCR_BASE_URL = `http://${PADDLEOCR_HOST}:${PADDLEOCR_PORT}`;

// ─── HTTP Request Helper ───────────────────────────────────────────────────────

function httpPost(url, body, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
            path: urlObj.pathname,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            timeout: timeoutMs,
        };

        const client = urlObj.protocol === "https:" ? https : http;
        const req = client.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => { data += chunk; });
            res.on("end", () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve({ raw: data });
                }
            });
        });

        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error("PaddleOCR request timeout"));
        });

        req.write(JSON.stringify(body));
        req.end();
    });
}

function httpGet(url, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
            path: urlObj.pathname,
            method: "GET",
            headers: { "Accept": "application/json" },
            timeout: timeoutMs,
        };

        const client = urlObj.protocol === "https:" ? https : http;
        const req = client.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => { data += chunk; });
            res.on("end", () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve({ raw: data, statusCode: res.statusCode });
                }
            });
        });

        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error("PaddleOCR health timeout"));
        });
        req.end();
    });
}

function httpPostMultipart(url, fieldName, filePath, extraFields = {}, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const form = new FormData();

        form.append(fieldName, fs.createReadStream(filePath));
        for (const [key, value] of Object.entries(extraFields)) {
            form.append(key, String(value));
        }

        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || 80,
            path: urlObj.pathname,
            method: "POST",
            headers: {
                ...form.getHeaders(),
            },
            timeout: timeoutMs,
        };

        const req = http.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => { data += chunk; });
            res.on("end", () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve({ raw: data });
                }
            });
        });

        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error("PaddleOCR multipart request timeout"));
        });

        form.pipe(req);
    });
}


// ─── PaddleOCR API Calls ───────────────────────────────────────────────────────

async function checkHealth() {
    try {
        const result = await httpGet(`${PADDLEOCR_BASE_URL}/health`, 5000);
        const ok = result.status === "ok" || result.ok === true;
        logger.info("PaddleOCR health check", {
            paddleocr_status: ok ? "ok" : "unavailable",
            health_url: `${PADDLEOCR_BASE_URL}/health`,
            response_received: true,
        });
        return ok;
    } catch (err) {
        logger.warn("PaddleOCR health check failed", {
            paddleocr_status: "unavailable",
            health_url: `${PADDLEOCR_BASE_URL}/health`,
            response_received: false,
            error: err.message,
        });
        return false;
    }
}


/**
 * CRITICAL FIX: Send image as base64 to PaddleOCR service.
 * The Python service expects "image" key with base64 data, not "image_path".
 */
async function extractFromImage(imagePath, templateId, selectedColumn = null, useGpu = false) {
    const start = Date.now();
    try {
        // Read image file and encode as base64
        const imageBuffer = fs.readFileSync(imagePath);
        const imageBase64 = imageBuffer.toString("base64");
        logger.info("PaddleOCR bridge request", {
            paddleocr_status: "requesting",
            bridge_payload_key: "image",
            base64_sent: true,
            response_received: false,
            fallback_used: false,
            template_id: templateId,
        });

        const result = await httpPost(`${PADDLEOCR_BASE_URL}/extract`, {
            image: imageBase64,   // base64-encoded image for Python service
            template_id: templateId,
            selected_column: selectedColumn,
            apply_perspective: true,
            use_gpu: useGpu,
        }, 90000);

        const elapsed = Date.now() - start;
        logger.info("PaddleOCR extraction complete", {
            elapsed_ms: elapsed,
            success: result.success,
            template_id: templateId,
            paddleocr_status: result.success ? "ok" : "error",
            bridge_payload_key: "image",
            base64_sent: true,
            response_received: true,
            fallback_used: false,
        });

        return result;
    } catch (err) {
        logger.error("PaddleOCR extraction failed", { error: err.message });
        throw err;
    }
}


async function extractFromImageBuffer(imageBuffer, templateId, selectedColumn = null) {
    const start = Date.now();
    const tempPath = path.join(__dirname, "data", `temp_ocr_${Date.now()}.jpg`);

    // Ensure directory exists
    const dir = path.dirname(tempPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    try {
        fs.writeFileSync(tempPath, imageBuffer);
        const imageBase64 = imageBuffer.toString("base64");
        const result = await httpPost(`${PADDLEOCR_BASE_URL}/extract`, {
            image: imageBase64,
            template_id: templateId,
            selected_column: selectedColumn,
            apply_perspective: true,
            use_gpu: false,
        }, 90000);

        const elapsed = Date.now() - start;
        logger.info("PaddleOCR buffer extraction complete", {
            elapsed_ms: elapsed,
            success: result.success,
        });

        return result;
    } finally {
        // Clean up temp file
        if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
        }
    }
}


async function getAvailableTemplates() {
    try {
        const result = await httpPost(`${PADDLEOCR_BASE_URL}/templates`, {}, 5000);
        return result.templates || [];
    } catch {
        return [];
    }
}


// ─── Store/Template Resolution ─────────────────────────────────────────────────
// LD Agent-Logtest routing:
//   STORE: THE RIM   → B1 → FoodSafety-Rim-v3      → RIM-01 to RIM-19
//   STORE: STONE OAK → B2 → FoodSafety-StoneOak-v3 → SO-01 to SO-19
//   STORE: BANDERA   → B3 → FoodSafety-Bandera-v3  → BAN-01 to BAN-19
//
// Production group routing:
//   B1 Kitchen Log → The Rim     → RIM-*
//   B2 Kitchen Log → Stone Oak    → SO-*
//   B3 Kitchen Log → Bandera     → BAN-*

const STORE_TEMPLATE_MAP = {
    "stone oak": "FoodSafety-StoneOak-v3",
    "stone-oak": "FoodSafety-StoneOak-v3",
    "stoneoak": "FoodSafety-StoneOak-v3",
    "b2": "FoodSafety-StoneOak-v3",
    "so": "FoodSafety-StoneOak-v3",
    "rim": "FoodSafety-Rim-v3",
    "the rim": "FoodSafety-Rim-v3",
    "b1": "FoodSafety-Rim-v3",
    "im": "FoodSafety-Rim-v3",
    "rim-": "FoodSafety-Rim-v3",
    "rim0": "FoodSafety-Rim-v3",
    "rim1": "FoodSafety-Rim-v3",
    "rim2": "FoodSafety-Rim-v3",
    "rim3": "FoodSafety-Rim-v3",
    "rim4": "FoodSafety-Rim-v3",
    "rim5": "FoodSafety-Rim-v3",
    "rim6": "FoodSafety-Rim-v3",
    "rim7": "FoodSafety-Rim-v3",
    "rim8": "FoodSafety-Rim-v3",
    "rim9": "FoodSafety-Rim-v3",
    "rim10": "FoodSafety-Rim-v3",
    "rim11": "FoodSafety-Rim-v3",
    "rim12": "FoodSafety-Rim-v3",
    "rim13": "FoodSafety-Rim-v3",
    "rim14": "FoodSafety-Rim-v3",
    "rim15": "FoodSafety-Rim-v3",
    "rim16": "FoodSafety-Rim-v3",
    "rim17": "FoodSafety-Rim-v3",
    "rim18": "FoodSafety-Rim-v3",
    "rim19": "FoodSafety-Rim-v3",
    "the rim": "FoodSafety-Rim-v3",
    "rim": "FoodSafety-Rim-v3",
    "b1": "FoodSafety-Rim-v3",
    "rim-01": "FoodSafety-Rim-v3",
    "rim-02": "FoodSafety-Rim-v3",
    "rim-07": "FoodSafety-Rim-v3",
    "rim-19": "FoodSafety-Rim-v3",
    "walk-in freezer rim": "FoodSafety-Rim-v3",
    "line freezer rim": "FoodSafety-Rim-v3",
    "walk-in freezer": "FoodSafety-Rim-v3",
    "line freezer": "FoodSafety-Rim-v3",
    "freezer": "FoodSafety-Rim-v3",
    "bandera": "FoodSafety-Bandera-v3",
    "b3": "FoodSafety-Bandera-v3",
    "ban": "FoodSafety-Bandera-v3",
    "ban-": "FoodSafety-Bandera-v3",
    "ban01": "FoodSafety-Bandera-v3",
    "ban-01": "FoodSafety-Bandera-v3",
    "ban-02": "FoodSafety-Bandera-v3",
    "ban-07": "FoodSafety-Bandera-v3",
    "ban-19": "FoodSafety-Bandera-v3",
    // LD Agent-Logtest headers
    "logtest rim": "FoodSafety-Rim-v3",
    "logtest stone oak": "FoodSafety-StoneOak-v3",
    "logtest bandera": "FoodSafety-Bandera-v3",
};

// Regex-based group name detection (LD Agent-Logtest)
function detectStoreFromGroupName(groupName) {
    if (!groupName) return null;
    const s = String(groupName).toUpperCase();

    // Explicit store name patterns
    if (/\bSTONE\s+OAK\b/.test(s)) return "stone oak";
    if (/\bBANDERA\b/.test(s)) return "bandera";
    // Be careful: "PRIMARY" contains "RIM" but should not match
    if (/\b(THE\s+RIM|RIM)\b/.test(s) && !/PRIM/.test(s)) return "rim";

    // B1/B2/B3 Kitchen Log pattern
    if (/\bB1\b/.test(s) && /KITCHEN/.test(s)) return "rim";
    if (/\bB2\b/.test(s) && /KITCHEN/.test(s)) return "stone oak";
    if (/\bB3\b/.test(s) && /KITCHEN/.test(s)) return "bandera";

    return null;
}

function resolveTemplateId(storeNameOrId) {
    if (!storeNameOrId) return "FoodSafety-StoneOak-v3";
    const key = String(storeNameOrId).toLowerCase().trim();

    // Try exact match first
    if (STORE_TEMPLATE_MAP[key]) return STORE_TEMPLATE_MAP[key];

    // Try group name detection
    const detected = detectStoreFromGroupName(key);
    if (detected && STORE_TEMPLATE_MAP[detected]) return STORE_TEMPLATE_MAP[detected];

    // Try partial match for RIM store names
    if (key.includes("rim") && !key.includes("primary")) return "FoodSafety-Rim-v3";
    if (key.includes("stone") && key.includes("oak")) return "FoodSafety-StoneOak-v3";
    if (key.includes("bander")) return "FoodSafety-Bandera-v3";

    // Default: Stone Oak
    return "FoodSafety-StoneOak-v3";
}


// ─── Format Results for WhatsApp Reply ────────────────────────────────────────

function formatPaddleOCRResult(result, lang = "ES") {
    if (!result || !result.success) {
        return lang === "EN"
            ? "OCR extraction failed. Please try again."
            : "Error en la extraccion OCR. Por favor intenta de nuevo.";
    }

    const data = result.result || {};
    const meta = result.meta || {};
    const items = data.items || [];

    const isES = lang === "ES";
    const header = isES ? "Valores detectados (PaddleOCR):" : "Detected values (PaddleOCR):";
    const lines = [header, ""];

    for (const item of items) {
        const statusEmoji = item.status === "SAFE" ? "OK"
            : item.status === "WARNING" ? "WARN"
                : "MISS";
        const value = item.value !== null && item.value !== undefined
            ? String(item.value)
            : (isES ? "No detectado" : "Not detected");
        const range = item.range || "";
        lines.push(`${statusEmoji} ${item.id}: ${value} (Rango: ${range})`);
    }

    lines.push("");
    lines.push(`Columna: ${data.selected_column || "?"}`);
    lines.push(`Exactitud: ${Math.round((meta.accuracy || 0) * 100)}%`);
    lines.push(`Completado: ${meta.filled || 0}/${meta.total_fields || 0}`);

    const unsafe = items.filter(i => i.status === "WARNING");
    if (unsafe.length > 0) {
        lines.push("");
        lines.push(isES
            ? `⚠️ Alerta: ${unsafe.length} lectura(s) fuera de rango!`
            : `⚠️ Warning: ${unsafe.length} reading(s) out of range!`);
    }

    lines.push("");
    lines.push(isES
        ? "Responde CONFIRMAR para guardar o EDIT # VALOR para corregir."
        : "Reply CONFIRM to save or EDIT # VALUE to correct.");

    return lines.join("\n");
}


// ─── Check if Service is Available ─────────────────────────────────────────────

let _serviceAvailable = null;
let _lastCheck = 0;

async function isServiceAvailable() {
    const now = Date.now();
    if (_serviceAvailable !== null && now - _lastCheck < 30000) {
        return _serviceAvailable;
    }
    _serviceAvailable = await checkHealth();
    _lastCheck = now;
    return _serviceAvailable;
}


module.exports = {
    extractFromImage,
    extractFromImageBuffer,
    checkHealth,
    isServiceAvailable,
    getAvailableTemplates,
    resolveTemplateId,
    formatPaddleOCRResult,
    PADDLEOCR_BASE_URL,
};
