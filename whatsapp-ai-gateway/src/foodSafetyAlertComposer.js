/**
 * foodSafetyAlertComposer.js — Phase 9: Consolidated Alert Composer
 *
 * Consolidates ALL alert types into ONE alert per submission.
 * Never sends separate unsafe / low-confidence / manager alerts
 * for the same form.
 *
 * Alert rules:
 *   - ONE alert per submission maximum (tracked by submissionId in alert dedup)
 *   - Alert ONLY after final decision
 *   - Alert ONLY for reliable values (manual confirmed, vision+memory agreement, high confidence OCR in range)
 *   - Raw OCR cannot trigger alert
 *   - Low confidence cannot create unsafe alert
 *   - Out-of-range + low confidence = review, not alert
 *   - Vision cannot auto-save alone
 */

const logger = require("./logger");
const { sendAlert } = require("./managerAlertService");
const { getStoreGroup } = require("./failureEscalationService");

// Alert allowed sources — these are the only sources that can trigger an alert
const ALERT_ELIGIBLE_SOURCES = new Set([
    "MANUAL_CONFIRMED",
    "MANAGER_CONFIRMED",
    "CEO_CONFIRMED",
    "OCR_HIGH_CONFIDENCE",
    "VISION_OVERRIDE",
    "VISION_MEMORY_AGREEMENT",
]);

// Alert NOT allowed — cannot create unsafe alerts
const ALERT_BLOCKED_STATUSES = new Set([
    "ALERT_BLOCKED",
    "MANUAL_REQUIRED",
    "NEEDS_CONFIRMATION",
    "MISSING_VALUE",
    "NEEDS_RETAKE",
]);

const MANAGER_MAP = {
    B1: { name: "David", phone: "12106853184" },
    B2: { name: "Edga", phone: "12109791918" },
    B3: { name: "Miles", phone: "12107712832" },
};

const STORE_ID_MAP = {
    B1: "rim",
    B2: "stone_oak",
    B3: "bandera",
};

/**
 * Compose the ONE alert payload for a submission.
 *
 * @param {object} submissionContext
 * @param {string} submissionContext.submissionId
 * @param {string} submissionContext.storeCode
 * @param {string} submissionContext.storeName
 * @param {Array} submissionContext.items - items with _decision info
 * @param {string} submissionContext.selectedColumn
 * @param {string} submissionContext.lang
 * @returns {object|null} alert payload or null if no alert eligible
 */
function composeAlertPayload(submissionContext) {
    const {
        submissionId,
        storeCode,
        storeName,
        items = [],
        selectedColumn,
        lang = "ES",
    } = submissionContext;

    const storeGroup = storeCode || "B2";
    const managerInfo = MANAGER_MAP[storeGroup] || { name: "Manager", phone: "" };

    // Collect items by alert eligibility
    const unsafeItems = [];
    const uncertainItems = [];
    const lowConfidenceItems = [];

    for (const item of items) {
        const decision = item._decision || {};
        const fieldId = item.field_id || item.id;
        const value = item.detectedValue;
        const range = item.safeRange || { min: "?", max: "?" };

        // Item is unsafe: value outside range
        const isUnsafe = value !== null && (value < range.min || value > range.max);

        if (isUnsafe) {
            // Only include if the source is alert-eligible
            if (decision.alert_allowed === true && ALERT_ELIGIBLE_SOURCES.has(decision.prediction_source)) {
                unsafeItems.push({ fieldId, value, range, decision });
            } else {
                // Unsafe but NOT alert-eligible — needs review, not alert
                uncertainItems.push({ fieldId, value, range, reason: decision.alert_block_reason || "low_confidence_or_unreliable" });
            }
        } else if (decision.status === "MANUAL_REQUIRED") {
            lowConfidenceItems.push({ fieldId, value, range, reason: decision.alert_block_reason || "low_confidence" });
        }
    }

    // Build the consolidated alert message
    const isES = lang !== "EN";
    const lines = [];

    if (unsafeItems.length > 0) {
        // UNSAFE ALERT
        lines.push(isES ? "ALERTA FOOD SAFETY - Temperatura insegura" : "FOOD SAFETY ALERT - Unsafe temperature");
        lines.push("");
        lines.push(`Store: ${storeName} (${storeGroup})`);
        lines.push(`Submission: #${submissionId}`);
        lines.push(`Column: ${selectedColumn || "N/A"}`);
        lines.push("");
        lines.push(isES ? "Temperatura insegura detectada:" : "Unsafe temperature detected:");

        for (const item of unsafeItems) {
            const val = item.value !== null ? `${item.value}F` : "N/A";
            lines.push(`  - ${item.fieldId}: ${val} (Range: ${item.range.min}-${item.range.max}F)`);
        }

        lines.push("");
        lines.push(`Manager: ${managerInfo.name} @${managerInfo.phone}`);
        lines.push(isES ? "Accion: revisar inmediatamente." : "Action: review immediately.");
    } else if (uncertainItems.length > 0 || lowConfidenceItems.length > 0) {
        // REVIEW NEEDED ALERT (not unsafe, but needs attention)
        lines.push(isES ? "FOOD SAFETY - Necesita revision" : "FOOD SAFETY - Needs review");
        lines.push("");
        lines.push(`Store: ${storeName} (${storeGroup})`);
        lines.push(`Submission: #${submissionId}`);
        lines.push(`Column: ${selectedColumn || "N/A"}`);
        lines.push("");

        if (uncertainItems.length > 0) {
            lines.push(isES ? "Valores fuera de rango (no verificados):" : "Values out of range (unverified):");
            for (const item of uncertainItems) {
                const val = item.value !== null ? `${item.value}F` : "N/A";
                lines.push(`  - ${item.fieldId}: ${val} (Range: ${item.range.min}-${item.range.max}F) [${item.reason}]`);
            }
            lines.push("");
        }

        if (lowConfidenceItems.length > 0) {
            lines.push(isES ? "Valores con baja confianza OCR:" : "Values with low OCR confidence:");
            for (const item of lowConfidenceItems) {
                const val = item.value !== null ? `${item.value}F` : "N/A";
                lines.push(`  - ${item.fieldId}: ${val} [${item.reason}]`);
            }
            lines.push("");
        }

        lines.push(`Manager: ${managerInfo.name} @${managerInfo.phone}`);
        lines.push(isES ? "Accion: confirmar valores en el grupo o MANAGER." : "Action: confirm values in group or MANAGER.");
    } else {
        // All good — no alert needed
        return null;
    }

    const message = lines.join("\n");

    const alert = {
        store_id: STORE_ID_MAP[storeGroup] || storeGroup.toLowerCase(),
        label: `consolidated_alert_${submissionId}`,
        issue: unsafeItems.length > 0 ? "unsafe_temperature" : "needs_review",
        action_needed: unsafeItems.length > 0
            ? (isES ? "Revisar inmediatamente." : "Review immediately.")
            : (isES ? "Confirmar valores en el grupo." : "Confirm values in group."),
        message_reference: `submission:${submissionId}`,
        deadline: new Date().toISOString(),
        detected_at: new Date().toISOString(),
        store_name: storeName,
        es: message,
        en: message,
        // Key: use submissionId as dedup key so only one alert fires per submission
        dedup_key: `submission:${submissionId}`,
    };

    return alert;
}

/**
 * Send the consolidated alert for a submission.
 * Returns the result of sendAlert, or null if no alert was needed.
 *
 * @param {object} submissionContext
 * @returns {object|null} alert result
 */
async function sendConsolidatedAlert(submissionContext) {
    const payload = composeAlertPayload(submissionContext);
    if (!payload) {
        logger.info("[AlertComposer] No alert needed for submission", { submissionId: submissionContext.submissionId });
        return null;
    }

    logger.info("[AlertComposer] Sending consolidated alert", {
        submissionId: submissionContext.submissionId,
        storeCode: submissionContext.storeCode,
        issue: payload.issue,
    });

    try {
        const result = await sendAlert(payload, null);
        return result;
    } catch (err) {
        logger.error("[AlertComposer] Failed to send alert", {
            error: err.message,
            submissionId: submissionContext.submissionId,
        });
        return { sent: false, error: err.message };
    }
}

/**
 * Evaluate if an item's decision qualifies for an alert.
 *
 * @param {object} item - form item with _decision
 * @returns {boolean}
 */
function canItemTriggerAlert(item) {
    const decision = item._decision || {};

    if (ALERT_BLOCKED_STATUSES.has(decision.status)) return false;
    if (decision.alert_allowed !== true) return false;
    if (!ALERT_ELIGIBLE_SOURCES.has(decision.prediction_source)) return false;

    // Item must be unsafe (out of range) to trigger alert
    const value = item.detectedValue;
    const range = item.safeRange || {};
    if (value === null || value === undefined) return false;

    return value < range.min || value > range.max;
}

/**
 * Build an alert summary for a form.
 *
 * @param {Array} items
 * @returns {object} summary counts
 */
function summarizeAlertEligibility(items) {
    const summary = {
        total: items.length,
        alertEligible: 0,
        alertBlocked: 0,
        needsReview: 0,
        confident: 0,
    };

    for (const item of items) {
        if (canItemTriggerAlert(item)) {
            summary.alertEligible++;
        } else if (item._decision && ALERT_BLOCKED_STATUSES.has(item._decision.status)) {
            summary.alertBlocked++;
            summary.needsReview++;
        } else if (item._decision && item._decision.status === "CONFIDENT") {
            summary.confident++;
        }
    }

    return summary;
}

module.exports = {
    composeAlertPayload,
    sendConsolidatedAlert,
    canItemTriggerAlert,
    summarizeAlertEligibility,
    ALERT_ELIGIBLE_SOURCES,
    ALERT_BLOCKED_STATUSES,
};
