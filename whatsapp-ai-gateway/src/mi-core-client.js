/**
 * mi-core-client.js — Mi-Core Integration Client (Phase 10.5)
 *
 * Sends confirmed food-safety submissions to the Mi-Core API.
 * Runs non-blocking (fire-and-forget with retry) so it never slows the WhatsApp reply.
 *
 * Usage:
 *   const miCore = require("./mi-core-client");
 *   miCore.syncSubmission(submission, items, traceId);
 *
 * Env vars (loaded from .env via dotenv in index.js):
 *   MI_CORE_URL       — base URL of Mi-Core service (e.g. http://100.118.102.113:4001)
 *   MI_CORE_API_KEY   — bearer token for authentication
 */

const axios = require("axios");
const logger = require("./logger");

// ─── Config ─────────────────────────────────────────────────────────────

const BASE_URL = (process.env.MI_CORE_URL || "").replace(/\/+$/, "");
const API_KEY = process.env.MI_CORE_API_KEY || "";

const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3_000;

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Whether Mi-Core is configured (URL + key present).
 */
function isConfigured() {
    return !!(BASE_URL && API_KEY);
}

/**
 * Sync a confirmed submission to Mi-Core.
 *
 * @param {Object} submission  — local DB row or session.pendingSubmission
 * @param {Array}  items       — parsed form items (with detectedValue, field id, etc.)
 * @param {string} traceId     — pipeline trace ID for correlation
 * @returns {Promise<Object>}  — Mi-Core response or { status: "SKIPPED" }
 */
async function syncSubmission(submission, items, traceId) {
    if (!isConfigured()) {
        logger.debug("[MI_CORE] Skipped — not configured (MI_CORE_URL or MI_CORE_API_KEY missing)");
        return { status: "SKIPPED", reason: "not_configured" };
    }

    const payload = buildPayload(submission, items, traceId);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const resp = await axios.post(`${BASE_URL}/api/v1/submissions`, payload, {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${API_KEY}`,
                },
                timeout: TIMEOUT_MS,
            });

            logger.info("[MI_CORE] Submission synced", {
                submission_id: submission.id,
                trace_id: traceId,
                status: resp.status,
                mi_core_id: resp.data && resp.data.id,
            });

            return { status: "OK", data: resp.data };
        } catch (err) {
            const isLast = attempt === MAX_RETRIES;
            const level = isLast ? "warn" : "debug";

            logger[level](`[MI_CORE] Sync attempt ${attempt + 1} failed`, {
                submission_id: submission.id,
                trace_id: traceId,
                error: err.message,
                status: err.response && err.response.status,
                retrying: !isLast,
            });

            if (!isLast) {
                await sleep(RETRY_DELAY_MS * (attempt + 1));
            } else {
                return { status: "ERROR", error: err.message };
            }
        }
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function buildPayload(submission, items, traceId) {
    return {
        source: "whatsapp-gateway",
        trace_id: traceId || submission.trace_id || null,
        submission_id: submission.id,
        store_name: submission.storeName || submission.store_name || "Unknown",
        store_code: (submission.parsed && submission.parsed.store_id) || null,
        phone_number: submission.phone_number || null,
        status: "CONFIRMED",
        submitted_at: new Date().toISOString(),
        items: (items || (submission.parsed && submission.parsed.items) || []).map((it) => ({
            field_id: it.id || it.field_id,
            label: it.label,
            value: it.detectedValue != null ? it.detectedValue : it.value,
            unit: it.unit || "",
            is_safe: it.isSafe != null ? it.isSafe : (it.status === "SAFE"),
            safe_range: it.safeRange || null,
            prediction_source: it._predictionSource || it.source || null,
            prediction_confidence: it._predictionConfidence || it.confidence || null,
        })),
        metadata: {
            gateway_version: require("../package.json").version,
            pipeline: (submission.parsed && submission.parsed.runtime_pipeline) || "unknown",
            image_hash: submission.imageHash || null,
        },
    };
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

// ─── Exports ────────────────────────────────────────────────────────────

module.exports = {
    isConfigured,
    syncSubmission,
    // Expose for testing
    _buildPayload: buildPayload,
};