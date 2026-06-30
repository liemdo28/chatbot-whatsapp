/**
 * failureEscalationService.js
 * =============================
 * Manager escalation for food safety OCR failures.
 * Routes alerts to the correct manager based on store:
 *   B1 / THE RIM  → David
 *   B2 / STONE OAK → Edga
 *   B3 / BANDERA   → Miles
 *
 * Escalation triggers:
 *   1. Unsafe temperature (value outside safe range)
 *   2. Low vision confidence (< 60%)
 *   3. Missing daily form (no submission today)
 *   4. OCR failure (service unavailable or extraction error)
 */

const logger = require("./logger");
const { sendAlert } = require("./managerAlertService");

// ─── Manager Routing ──────────────────────────────────────────────────────────

const MANAGER_MAP = {
    "B1": { name: "David", phone: "12106853184", display: "+1 (210) 685-3184" },
    "B2": { name: "Edga", phone: "12109791918", display: "+1 (210) 979-1918" },
    "B3": { name: "Miles", phone: "12107712832", display: "+1 (210) 771-2832" },
};

// Maps store group → store ID for alert routing
const STORE_GROUP_TO_ID = {
    "B1": "rim",
    "B2": "stone_oak",
    "B3": "bandera",
};

const STORE_NAME_TO_GROUP = {
    "THE RIM": "B1",
    "STONE OAK": "B2",
    "BANDERA": "B3",
};

function getStoreGroup(storeName) {
    return STORE_NAME_TO_GROUP[String(storeName || "").toUpperCase()] || "B2";
}

function getManagerName(groupId) {
    return MANAGER_MAP[groupId] ? MANAGER_MAP[groupId].name : "Unknown";
}

function normalizeConfidence(confidence) {
    const value = Number(confidence || 0);
    if (!Number.isFinite(value)) return 0;
    return value > 1 ? value / 100 : value;
}

function buildNumericMissingSubmissionMessage(storeName, storeCode, expectedSubmission) {
    return [
        "Food Safety submission is missing.",
        "",
        `Store: ${storeName} / ${storeCode}`,
        `Expected submission: ${expectedSubmission}`,
        "Status: No numeric temperature submission received.",
        "",
        "Please type /agent and enter the 19 temperature readings.",
        "Paper forms should still be completed and kept for records.",
    ].join("\n");
}

// ─── Escalation Thresholds ───────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.60;   // Escalate below this vision confidence
const UNSAFE_COUNT_THRESHOLD = 1;    // Escalate on any unsafe reading
const MISSING_FORM_HOURS = 14;       // Escalate if no submission by 2 PM

function legacyEscalationEnabled() {
    return String(process.env.FOOD_SAFETY_ENABLE_LEGACY_ESCALATION || "false").toLowerCase() === "true";
}

function legacyEscalationDisabled(reason, extra = {}) {
    logger.warn("[Escalation] Legacy direct alert path disabled; use foodSafetyAlertComposer or missingSubmissionScheduler", {
        reason,
        ...extra,
    });
    return {
        escalated: false,
        reason: "LEGACY_ESCALATION_DISABLED",
        legacy_reason: reason,
    };
}

// ─── Escalation Trigger Functions ───────────────────────────────────────────

/**
 * Escalate unsafe temperature readings to the store manager.
 * Called when a form has WARNING status items.
 *
 * @param {object} parsed - parsed OCR result with items array
 * @param {string} storeName - canonical store name
 * @param {string} submissionId - DB submission ID
 * @param {string} lang - "ES" or "EN"
 * @returns {object} escalation result
 */
async function escalateUnsafeTemperature(parsed, storeName, submissionId, lang = "ES") {
    if (!legacyEscalationEnabled()) {
        return legacyEscalationDisabled("unsafe_temperature", { storeName, submissionId });
    }
    const storeGroup = getStoreGroup(storeName);
    const managerName = getManagerName(storeGroup);

    const unsafeItems = (parsed.items || []).filter(item =>
        item.status === "WARNING" || item.status === "UNSAFE"
    );

    if (unsafeItems.length === 0) {
        return { escalated: false, reason: "no_unsafe_items" };
    }

    const isES = lang !== "EN";
    const itemLines = unsafeItems.map(item => {
        const val = item.detectedValue !== null && item.detectedValue !== undefined
            ? String(item.detectedValue) + "°F"
            : "N/A";
        return `  - ${item.id}: ${val} (Rango: ${item.safeRange ? item.safeRange.min + "-" + item.safeRange.max : "?"}°F)`;
    }).join("\n");

    const messageEs = `ALERTA FOOD SAFETY - ${storeName}\n\nTemperatura insegura detectada:\n${itemLines}\n\nManager: ${managerName} @${MANAGER_MAP[storeGroup].phone}\nAccion: revisar inmediatamente.\nFormulario: #${submissionId}`;
    const messageEn = `FOOD SAFETY ALERT - ${storeName}\n\nUnsafe temperature detected:\n${itemLines}\n\nManager: ${managerName} @${MANAGER_MAP[storeGroup].phone}\nAction: review immediately.\nForm: #${submissionId}`;

    logger.warn("[Escalation] Unsafe temperature alert", {
        storeGroup,
        managerName,
        unsafeCount: unsafeItems.length,
        submissionId,
    });

    // Build alert payload
    const alert = {
        store_id: STORE_GROUP_TO_ID[storeGroup],
        label: "unsafe_temperature",
        issue: "unsafe_temperature",
        action_needed: "Manager review required immediately.",
        message_reference: `submission:${submissionId}`,
        deadline: new Date().toISOString(),
        detected_at: new Date().toISOString(),
        store_name: storeName,
        es: messageEs,
        en: messageEn,
    };

    let sent = false;
    try {
        const result = await sendAlert(alert, null);
        sent = result.sent;
    } catch (err) {
        logger.error("[Escalation] Failed to send unsafe temperature alert", {
            error: err.message,
            storeGroup,
        });
    }

    return {
        escalated: sent,
        reason: "unsafe_temperature",
        managerName,
        storeGroup,
        unsafeCount: unsafeItems.length,
        message: isES ? messageEs : messageEn,
    };
}


/**
 * Escalate low OCR confidence to the store manager.
 * Called when overall OCR confidence is below threshold.
 *
 * @param {number} confidence - OCR confidence 0-1
 * @param {string} storeName - canonical store name
 * @param {string} submissionId - DB submission ID
 * @param {string} lang - "ES" or "EN"
 * @returns {object} escalation result
 */
async function escalateLowConfidence(confidence, storeName, submissionId, lang = "ES") {
    if (!legacyEscalationEnabled()) {
        return legacyEscalationDisabled("low_confidence_ocr", { storeName, submissionId });
    }
    const storeGroup = getStoreGroup(storeName);
    const managerName = getManagerName(storeGroup);
    const isES = lang !== "EN";

    const normalized = normalizeConfidence(confidence);
    const pct = Math.round(normalized * 100);

    const messageEs = `ALERTA FOOD SAFETY - ${storeName}\n\nVision confidence baja: ${pct}%\n\nAlgunos valores pueden no ser exactos.\nPor favor revisa el formulario #${submissionId} y confirma los valores.`;
    const messageEn = `FOOD SAFETY ALERT - ${storeName}\n\nLow vision confidence: ${pct}%\n\nSome values may be inaccurate.\nPlease review form #${submissionId} and confirm values.`;

    logger.warn("[Escalation] Low confidence OCR alert", {
        storeGroup,
        managerName,
        confidence,
        submissionId,
    });

    const alert = {
        store_id: STORE_GROUP_TO_ID[storeGroup],
        label: "low_confidence_ocr",
        issue: "low_confidence_ocr",
        action_needed: "Review handwriting or ask employee for MANUAL/RETAKE.",
        message_reference: `submission:${submissionId}`,
        deadline: new Date().toISOString(),
        detected_at: new Date().toISOString(),
        store_name: storeName,
        es: messageEs,
        en: messageEn,
    };

    let sent = false;
    try {
        const result = await sendAlert(alert, null);
        sent = result.sent;
    } catch (err) {
        logger.error("[Escalation] Failed to send low confidence alert", {
            error: err.message,
            storeGroup,
        });
    }

    return {
        escalated: sent,
        reason: "low_confidence",
        managerName,
        storeGroup,
        confidence: normalized,
        message: isES ? messageEs : messageEn,
    };
}


/**
 * Escalate missing daily form submission.
 * Called by the missing submission scheduler when a store misses their daily form.
 *
 * @param {string} storeName - canonical store name
 * @param {string} expectedDate - ISO date string
 * @param {string} lang - "ES" or "EN"
 * @returns {object} escalation result
 */
async function escalateMissingForm(storeName, expectedDate, lang = "ES") {
    if (!legacyEscalationEnabled()) {
        return legacyEscalationDisabled("missing_daily_form", { storeName, expectedDate });
    }
    const storeGroup = getStoreGroup(storeName);
    const managerName = getManagerName(storeGroup);
    const isES = lang !== "EN";

    const messageEs = buildNumericMissingSubmissionMessage(storeName, storeGroup, expectedDate);
    const messageEn = buildNumericMissingSubmissionMessage(storeName, storeGroup, expectedDate);

    logger.warn("[Escalation] Missing form alert", {
        storeGroup,
        managerName,
        expectedDate,
    });

    const alert = {
        store_id: STORE_GROUP_TO_ID[storeGroup],
        label: "missing_daily_form",
        issue: "missing_submission",
        action_needed: "Food Safety submission is missing. No numeric temperature submission received. Ask store group to type /agent and enter the 19 temperature readings.",
        deadline: new Date().toISOString(),
        detected_at: new Date().toISOString(),
        store_name: storeName,
        es: messageEs,
        en: messageEn,
    };

    let sent = false;
    try {
        const result = await sendAlert(alert, null);
        sent = result.sent;
    } catch (err) {
        logger.error("[Escalation] Failed to send missing form alert", {
            error: err.message,
            storeGroup,
        });
    }

    return {
        escalated: sent,
        reason: "missing_submission",
        managerName,
        storeGroup,
        expectedDate,
        message: isES ? messageEs : messageEn,
    };
}


/**
 * Escalate OCR service failure.
 * Called when the PaddleOCR service is unavailable or extraction completely fails.
 *
 * @param {string} storeName - canonical store name
 * @param {string} errorMessage - what went wrong
 * @param {string} lang - "ES" or "EN"
 * @returns {object} escalation result
 */
async function escalateOCRFailure(storeName, errorMessage, lang = "ES") {
    if (!legacyEscalationEnabled()) {
        return legacyEscalationDisabled("ocr_failure", { storeName, errorMessage });
    }
    const storeGroup = getStoreGroup(storeName);
    const managerName = getManagerName(storeGroup);
    const isES = lang !== "EN";

    const messageEs = `ALERTA FOOD SAFETY - ${storeName}\n\nError en el servicio OCR:\n"${errorMessage}"\n\nEl bot no pudo leer el formulario automaticamente.\nPor favor intenta de nuevo o contacta a soporte.`;
    const messageEn = `FOOD SAFETY ALERT - ${storeName}\n\nOCR service failure:\n"${errorMessage}"\n\nThe bot could not process the form automatically.\nPlease try again or contact support.`;

    logger.error("[Escalation] OCR failure alert", {
        storeGroup,
        managerName,
        errorMessage,
    });

    const alert = {
        store_id: STORE_GROUP_TO_ID[storeGroup],
        label: "ocr_failure",
        issue: "ocr_service_failure",
        action_needed: "Use MANUAL/RETAKE or manager review; check PaddleOCR service.",
        deadline: new Date().toISOString(),
        detected_at: new Date().toISOString(),
        store_name: storeName,
        es: messageEs,
        en: messageEn,
    };

    let sent = false;
    try {
        const result = await sendAlert(alert, null);
        sent = result.sent;
    } catch (err) {
        logger.error("[Escalation] Failed to send OCR failure alert", {
            error: err.message,
            storeGroup,
        });
    }

    return {
        escalated: sent,
        reason: "ocr_failure",
        managerName,
        storeGroup,
        errorMessage,
        message: isES ? messageEs : messageEn,
    };
}


// ─── Auto-escalation Decision ─────────────────────────────────────────────────

/**
 * Called after OCR completes. Determines if escalation is needed.
 * Returns list of escalations that were triggered.
 *
 * @param {object} params
 * @param {object} params.parsed - parsed OCR result
 * @param {number} params.confidence - OCR confidence 0-1
 * @param {string} params.storeName - canonical store name
 * @param {string} params.submissionId - DB submission ID
 * @param {string} [params.lang] - "ES" or "EN"
 * @returns {Promise<object[]>} list of escalation results triggered
 */
async function autoEscalate({ parsed, confidence, storeName, submissionId, lang = "ES" }) {
    const escalations = [];

    // 1. Unsafe temperatures → escalate always
    if (parsed && parsed.items) {
        const unsafeCount = parsed.items.filter(i =>
            i.status === "WARNING" || i.status === "UNSAFE"
        ).length;
        if (unsafeCount >= UNSAFE_COUNT_THRESHOLD) {
            const result = await escalateUnsafeTemperature(parsed, storeName, submissionId, lang);
            if (result.escalated) escalations.push(result);
        }
    }

    // 2. Low confidence → escalate
    const normalizedConfidence = normalizeConfidence(confidence);
    if (confidence !== undefined && normalizedConfidence < CONFIDENCE_THRESHOLD) {
        const result = await escalateLowConfidence(normalizedConfidence, storeName, submissionId, lang);
        if (result.escalated) escalations.push(result);
    }

    return escalations;
}

async function autoEscalateV2({ parsed, confidence, storeName, submissionId, lang = "ES" }) {
    if (!legacyEscalationEnabled()) {
        return [legacyEscalationDisabled("auto_escalate_v2", { storeName, submissionId })];
    }
    const escalations = [];
    const normalizedConfidence = normalizeConfidence(confidence);
    const items = (parsed && parsed.items) || [];
    const blockedItems = items.filter((item) => {
        const pred = item._prediction || {};
        return pred.alert_allowed === false || item._alertAllowed === false;
    });
    const unreliableUnsafe = items.filter((item) => {
        const unsafe = item.status === "WARNING" || item.status === "UNSAFE";
        const pred = item._prediction || {};
        return unsafe && (pred.alert_allowed === false || item._alertAllowed === false || normalizedConfidence < CONFIDENCE_THRESHOLD);
    });

    if (normalizedConfidence < CONFIDENCE_THRESHOLD || blockedItems.length > 0 || unreliableUnsafe.length > 0) {
        const storeGroup = getStoreGroup(storeName);
        const managerName = getManagerName(storeGroup);
        const pct = Math.round(normalizedConfidence * 100);
        const blockReasons = Array.from(new Set(blockedItems.map((item) => {
            const pred = item._prediction || {};
            return pred.alert_block_reason || item._alertBlockReason || "low_confidence_or_memory_conflict";
        })));
        const reasonLines = [
            `Vision confidence ${pct}%`,
            blockedItems.length > 0 ? "Some values conflict with memory/range" : null,
            unreliableUnsafe.length > 0 ? "Unsafe alert blocked until manager/manual confirmation" : null,
            ...blockReasons,
        ].filter(Boolean);

        const message = [
            "Needs review due to low vision confidence.",
            "",
            `Store: ${storeName} / ${storeGroup}`,
            `Manager: ${managerName} @${MANAGER_MAP[storeGroup].phone}`,
            `Reference: submission #${submissionId}`,
        ].join("\n");

        const alert = {
            store_id: STORE_GROUP_TO_ID[storeGroup],
            label: `needs_review_${submissionId}`,
            issue: "Low confidence / Needs review",
            action_needed: "Reply MANAGER or confirm values in original group.",
            message_reference: `submission #${submissionId}`,
            deadline: new Date().toISOString(),
            detected_at: new Date().toISOString(),
            store_name: storeName,
            reason_lines: reasonLines,
            send_to_source_group: false,
            es: message,
            en: message,
        };

        try {
            const result = await sendAlert(alert, null);
            if (result.sent) {
                escalations.push({
                    escalated: true,
                    reason: "low_confidence_or_memory_conflict",
                    managerName,
                    storeGroup,
                    confidence: normalizedConfidence,
                    blocked_items: blockedItems.length,
                    message,
                });
            }
        } catch (err) {
            logger.error("[Escalation] Failed to send consolidated review alert", {
                error: err.message,
                storeGroup,
                submissionId,
            });
        }

        return escalations;
    }

    if (items.length > 0) {
        const unsafeCount = items.filter((item) => {
            const unsafe = item.status === "WARNING" || item.status === "UNSAFE";
            const pred = item._prediction || {};
            return unsafe && pred.alert_allowed !== false && item._alertAllowed !== false;
        }).length;
        if (unsafeCount >= UNSAFE_COUNT_THRESHOLD) {
            const result = await escalateUnsafeTemperature(parsed, storeName, submissionId, lang);
            if (result.escalated) escalations.push(result);
        }
    }

    return escalations;
}


// ─── Module exports ──────────────────────────────────────────────────────────

module.exports = {
    escalateUnsafeTemperature,
    escalateLowConfidence,
    escalateMissingForm,
    escalateOCRFailure,
    autoEscalate: autoEscalateV2,
    getStoreGroup,
    getManagerName,
    CONFIDENCE_THRESHOLD,
};
