/**
 * vision_llm_bridge.js
 * ====================
 * Node.js bridge between whatsapp-ai-gateway and the Python Vision LLM pipeline.
 * Sends form images to handwriting-pivot/server.py for Vision LLM extraction.
 *
 * Drop-in replacement for PaddleOCR extraction path.
 * Activated when USE_VISION_LLM_PIPELINE=true
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const logger = require("./src/logger");

const VISION_LLM_HOST = process.env.VISION_LLM_HOST || "127.0.0.1";
const VISION_LLM_PORT = process.env.VISION_LLM_PORT || "5502";
const VISION_LLM_BASE_URL = `http://${VISION_LLM_HOST}:${VISION_LLM_PORT}`;
const VISION_LLM_TIMEOUT_MS = Number(process.env.VISION_LLM_TIMEOUT_MS || 60000);

// Feature flag
function isVisionLLMPipelineEnabled() {
    return String(process.env.USE_VISION_LLM_PIPELINE || "false").toLowerCase() === "true";
}

/**
 * Check if the Vision LLM Python server is reachable.
 */
async function isServerAvailable() {
    return new Promise((resolve) => {
        const req = http.get(`${VISION_LLM_BASE_URL}/health`, { timeout: 3000 }, (res) => {
            let data = "";
            res.on("data", (chunk) => { data += chunk; });
            res.on("end", () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json.status === "ok");
                } catch {
                    resolve(false);
                }
            });
        });
        req.on("error", () => resolve(false));
        req.on("timeout", () => { req.destroy(); resolve(false); });
    });
}

/**
 * Send image to Vision LLM server and get extraction results.
 * @param {string} imagePath - Path to the form image
 * @param {string} chatName - WhatsApp group name (for store resolution)
 * @returns {Object} Vision LLM extraction result
 */
async function extractWithVisionLLM(imagePath, chatName) {
    const t0 = Date.now();
    return new Promise((resolve, reject) => {
        try {
            const imageBuffer = fs.readFileSync(imagePath);
            const imageB64 = imageBuffer.toString("base64");

            const body = JSON.stringify({
                image_b64: imageB64,
                group_name: chatName || "",
            });

            const url = new URL(`${VISION_LLM_BASE_URL}/extract`);
            const options = {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body),
                },
                timeout: VISION_LLM_TIMEOUT_MS,
            };

            const req = http.request(options, (res) => {
                let data = "";
                res.on("data", (chunk) => { data += chunk; });
                res.on("end", () => {
                    const elapsed = Date.now() - t0;
                    try {
                        const json = JSON.parse(data);
                        json._bridge_latency_ms = elapsed;
                        resolve(json);
                    } catch {
                        resolve({
                            success: false,
                            error: `Failed to parse Vision LLM response: ${data.substring(0, 200)}`,
                            _bridge_latency_ms: elapsed,
                        });
                    }
                });
            });

            req.on("error", (err) => {
                const elapsed = Date.now() - t0;
                resolve({
                    success: false,
                    error: `Vision LLM request failed: ${err.message}`,
                    _bridge_latency_ms: elapsed,
                });
            });

            req.on("timeout", () => {
                req.destroy();
                const elapsed = Date.now() - t0;
                resolve({
                    success: false,
                    error: `Vision LLM request timeout after ${elapsed}ms`,
                    _bridge_latency_ms: elapsed,
                });
            });

            req.write(body);
            req.end();
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Convert Vision LLM result to the parsed format expected by FoodSafetyHandler.
 * Maps vision readings to the existing parsed.items structure.
 */
function toParsedFormat(visionResult, storeInfo) {
    const items = (visionResult.readings || []).map((reading, index) => {
        const fieldId = reading.field_id;
        return {
            index: index + 1,
            id: fieldId,
            field_id: fieldId,
            label: reading.notes || fieldId,
            item: fieldId,
            detectedValue: reading.value,
            value: reading.value,
            raw_text: reading.raw_text,
            unit: "F",
            confidence: reading.confidence || 0,
            status: reading.value !== null ? "DETECTED" : "MISSING",
            isSafe: reading.value !== null,
            _predictionSource: "VISION_LLM",
            _needsConfirmation: reading.confidence < 0.85,
            _visionNotes: reading.notes || "",
        };
    });

    // Map shift to column format: "10AM" → "10:00", "4PM" → "16:00"
    const shiftToColumn = (shift) => {
        if (!shift) return null;
        const s = String(shift).toUpperCase();
        if (s === "10AM" || s === "10:00" || s === "OPEN") return "10:00";
        if (s === "4PM" || s === "16:00" || s === "MID" || s === "LATE") return "16:00";
        return null;
    };

    const selectedCol = visionResult.selected_column
        || shiftToColumn(visionResult.shift);

    return {
        store_id: visionResult.store || (storeInfo && storeInfo.storeCode) || "",
        storeName: visionResult.store || (storeInfo && storeInfo.storeName) || "",
        store_name: visionResult.store || (storeInfo && storeInfo.storeName) || "",
        template_id: (storeInfo && storeInfo.templateId) || "",
        template: visionResult.store || "",
        isForm: true,
        classification: "FOOD_SAFETY_FORM",
        selected_column: selectedCol,
        items,
        issues: [],
        confidence: (visionResult.overall_confidence || 0) * 100,
        needsReview: false,
        tooManyMissingFields: false,
        _visionLlmResult: visionResult,
        // ─── Runtime proof metadata (D5 Pilot) ───
        _runtimeVisionSystem: visionResult.vision_system || "python_vision_llm_pipeline",
        _runtimePrimaryProvider: visionResult.primary_provider || "gemini-flash",
        _runtimeFallbackProvider: visionResult.fallback_provider || "claude-vision",
        _runtimeProviderUsed: visionResult.provider_used || visionResult.provider || "unknown",
        _runtimeFallbackUsed: visionResult.fallback_used || false,
        _runtimeDecisionEngineFinal: visionResult.decision_engine_final || false,
    };
}

module.exports = {
    isVisionLLMPipelineEnabled,
    isServerAvailable,
    extractWithVisionLLM,
    toParsedFormat,
};
