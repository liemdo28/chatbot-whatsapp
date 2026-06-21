/**
 * foodSafetyDecisionEngine.js — Phase 5: Confidence Fusion / Decision Engine
 *
 * This is the single source of truth for final value decisions.
 * RAW OCR MUST NEVER trigger alerts directly.
 *
 * Decision pipeline:
 *   1. OCR result
 *   2. Memory result (writer profile + store-level history)
 *   3. CEO-confirmed ground truth
 *   4. Range validation (CRITICAL threshold blocking)
 *   5. Confidence fusion
 *   6. Final value decision
 *
 * Alert rules:
 *   - Alerts ONLY after final decision
 *   - Alerts ONLY if final_value is reliable
 *   - Alerts BLOCKED if confidence < 85 OR memory conflict OR crop quality issue
 */

const logger = require("./logger");
const db = require("./database");
const storeKnowledge = require("./storeKnowledge");
const visionAiReviewer = require("./visionAiReviewer");

// ─── Alert-Gating Thresholds ─────────────────────────────────────────
const ALERT_MIN_CONFIDENCE = 0.85;
const ALERT_ALLOWED_SOURCES = [
    "OCR_HIGH_CONFIDENCE",
    "MANUAL_CONFIRMED",
    "MANAGER_CONFIRMED",
    "CEO_CONFIRMED",
];

// ─── Critical Field Thresholds ────────────────────────────────────────
const CRITICAL_FIELD_RANGES = {
    FRYER_MIN: 300,
    BOILER_MIN: 150,
    HOT_MIN: 50,
    HOT2_MIN: 80,
    COOL_MIN: 10,
    FREEZER_MAX: 50,
};

const SOURCE_PRIORITY = {
    MANAGER_CONFIRMED: 1,
    MANUAL_CONFIRMED: 2,
    CEO_CONFIRMED: 3,
    OCR_HIGH_CONFIDENCE: 4,
    OCR_WITH_MEMORY_SUPPORT: 5,
    WRITER_MEMORY: 6,
    MEMORY_ASSISTED: 7,
    RANGE_CORRECTED: 8,
    HUMAN_REQUIRED: 9,
    MISSING_VALUE: 10,
    NEEDS_RETAKE: 11,
};

const STATUS = {
    CONFIDENT: "CONFIDENT",
    PREDICTED_NEEDS_CONFIRMATION: "PREDICTED_NEEDS_CONFIRMATION",
    MISSING_VALUE: "MISSING_VALUE",
    MANUAL_REQUIRED: "MANUAL_REQUIRED",
    ALERT_BLOCKED: "ALERT_BLOCKED",
};

// ─── Helpers ──────────────────────────────────────────────────────────

function toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function normalizeConfidence(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return 0;
    return n > 1 ? Math.min(n, 100) / 100 : n;
}

function inRange(value, range) {
    const n = toNumber(value);
    return n !== null && n >= range.min && n <= range.max;
}

function displayColumn(column) {
    const text = String(column || "").toLowerCase();
    if (text.includes("10")) return "10AM";
    if (text.includes("4") || text.includes("16")) return "4PM";
    return column || "";
}

function classifyFieldRange(rangeMin, rangeMax) {
    if (rangeMin >= 300 && rangeMax <= 370) return "FRYER";
    if (rangeMin >= 180 && rangeMax <= 230) return "BOILER";
    if (rangeMin >= 95 && rangeMax <= 110) return "HOT_FOOD";
    if (rangeMin >= 130 && rangeMax <= 170) return "HOT_FOOD2";
    if (rangeMin >= 30 && rangeMax <= 50) return "COOLER";
    if (rangeMax <= 10) return "FREEZER";
    return "GENERAL";
}

function isCriticallyLowOcrValue(fieldRange, ocrValue) {
    const n = toNumber(ocrValue);
    if (n === null) return false;
    const cat = classifyFieldRange(fieldRange.min, fieldRange.max);
    switch (cat) {
        case "FRYER": return n < CRITICAL_FIELD_RANGES.FRYER_MIN;
        case "BOILER": return n < CRITICAL_FIELD_RANGES.BOILER_MIN;
        case "HOT_FOOD":
        case "HOT_FOOD2": return n < CRITICAL_FIELD_RANGES.HOT_MIN;
        case "COOLER": return n < CRITICAL_FIELD_RANGES.COOL_MIN;
        case "FREEZER": return n > CRITICAL_FIELD_RANGES.FREEZER_MAX;
        default: return false;
    }
}

function isCatastrophicOcrFailure(ocrValue, fieldRange) {
    const n = toNumber(ocrValue);
    if (n === null) return false;
    const rangeSpan = fieldRange.max - fieldRange.min;
    const midpoint = (fieldRange.max + fieldRange.min) / 2;
    const distance = Math.abs(n - midpoint);
    return distance > rangeSpan * 3;
}

// ─── CEO Ground Truth Lookup ──────────────────────────────────────────

function getCeoGroundTruth(storeCode, fieldId, columnLabel) {
    if (!storeCode || !fieldId) return null;
    try {
        const colLabel = displayColumn(columnLabel);
        return db.getOne(
            `SELECT * FROM ceo_handwriting_ground_truth
             WHERE store_code = ? AND field_id = ? AND column_label = ?
             ORDER BY created_at DESC, id DESC LIMIT 1`,
            [storeCode, fieldId, colLabel]
        );
    } catch (_) { return null; }
}

// ─── Alert Gate ──────────────────────────────────────────────────────

/**
 * Determines whether an alert can be sent for a single item.
 * Returns { allowed, reason }
 */
function canSendAlert(item) {
    const pred = item._prediction || {};
    if (pred.final_suggested_value === null || pred.final_suggested_value === undefined) {
        return { allowed: false, reason: "MISSING_VALUE" };
    }
    if (pred.needs_confirmation === true) {
        return { allowed: false, reason: "NEEDS_CONFIRMATION" };
    }
    if (!ALERT_ALLOWED_SOURCES.includes(pred.prediction_source)) {
        return { allowed: false, reason: `UNRELIABLE_SOURCE:${pred.prediction_source}` };
    }
    if ((pred.prediction_confidence || 0) < ALERT_MIN_CONFIDENCE) {
        return { allowed: false, reason: `LOW_CONFIDENCE:${(pred.prediction_confidence || 0).toFixed(2)}` };
    }
    const memoryMatches = item._memoryMatches || [];
    if (memoryMatches.length > 0) {
        const topMemory = memoryMatches[0];
        const memoryValue = toNumber(topMemory.confirmed_value);
        const range = item.safeRange || { min: item.range_min ?? -20, max: item.range_max ?? 450 };
        if (memoryValue !== null && !inRange(memoryValue, range)) {
            return { allowed: false, reason: "MEMORY_CONFLICT" };
        }
        if (memoryValue !== null && Math.abs(memoryValue - pred.final_suggested_value) > 10) {
            return { allowed: false, reason: "MEMORY_VALUE_MISMATCH" };
        }
    }
    if (item._cropQualityScore !== undefined && item._cropQualityScore < 0.5) {
        return { allowed: false, reason: "CROP_QUALITY_ISSUE" };
    }
    return { allowed: true, reason: null };
}

/**
 * Evaluate ALL items in a submission for alertability.
 * Returns { canAlert, alertItems, blockedItems }
 */
function evaluateSubmissionAlerts(parsed, storeCode) {
    const alertItems = [];
    const blockedItems = [];
    for (const item of parsed.items || []) {
        const alertGate = canSendAlert(item);
        const value = item._prediction ? item._prediction.final_suggested_value : item.detectedValue;
        const range = item.safeRange || { min: item.range_min ?? -20, max: item.range_max ?? 450 };
        const isUnsafe = value !== null && (value < range.min || value > range.max);

        if (isUnsafe) {
            if (alertGate.allowed) {
                alertItems.push({ ...item, _alertGate: alertGate });
            } else {
                blockedItems.push({ ...item, _alertGate: alertGate, _blockedReason: alertGate.reason });
            }
        }
    }
    return { canAlert: alertItems.length > 0, alertItems, blockedItems };
}

// ─── Main Decision Engine ─────────────────────────────────────────────

/**
 * Make final value decision for a single field.
 *
 * @param {object} opts
 * @param {object} opts.item - Original parsed OCR item
 * @param {string} opts.storeCode - e.g. "B2"
 * @param {string} opts.writerName - Employee name (optional)
 * @param {string} opts.columnLabel - "4PM" or "10AM"
 * @param {number} opts.ocrConfidence - Overall OCR confidence (0-1)
 * @returns {object} Decision result with final_suggested_value, prediction_source,
 *                   prediction_confidence, needs_confirmation, status, alert_allowed, alert_block_reason
 */
function decideFieldValue(opts) {
    const {
        item,
        storeCode,
        writerName,
        columnLabel,
        ocrConfidence = 0,
    } = opts;

    const fieldId = item.field_id || item.id;
    const ocrValue = item.detectedValue !== undefined ? item.detectedValue : item.value;
    const fieldRange = item.safeRange || { min: item.range_min ?? -20, max: item.range_max ?? 450 };
    const numOcrValue = toNumber(ocrValue);
    const hasOcrValue = numOcrValue !== null;
    const ocrInRange = hasOcrValue && inRange(numOcrValue, fieldRange);
    const ocrNorm = normalizeConfidence(item.confidence || ocrConfidence);

    // ─── Step 1: CEO Ground Truth ──────────────────────────────────
    const ceoTruth = getCeoGroundTruth(storeCode, fieldId, columnLabel);
    if (ceoTruth) {
        const ceoValue = ceoTruth.value_state === "VALUE" ? toNumber(ceoTruth.confirmed_value) : null;
        const ceoInRange = ceoValue !== null && inRange(ceoValue, fieldRange);
        const ceoMissing = ceoTruth.value_state === "MISSING";

        if (ceoMissing && hasOcrValue) {
            return makeDecision({
                finalValue: null,
                source: "CEO_CONFIRMED",
                confidence: 0.0,
                needsConfirmation: true,
                status: "MISSING_VALUE",
                alertAllowed: false,
                alertReason: "CEO_CONFIRMED_MISSING",
                fieldId,
                ocrValue,
            });
        }
        if (ceoValue !== null) {
            // If OCR matches CEO value, trust it
            if (hasOcrValue && Math.abs(numOcrValue - ceoValue) <= 1) {
                return makeDecision({
                    finalValue: numOcrValue,
                    source: "OCR_HIGH_CONFIDENCE",
                    confidence: Math.max(ocrNorm, 0.85),
                    needsConfirmation: false,
                    status: "CONFIDENT",
                    alertAllowed: true,
                    alertReason: null,
                    fieldId,
                    ocrValue,
                });
            }
            // If OCR disagrees with CEO but OCR is wrong, use CEO value
            if (hasOcrValue && !ocrInRange) {
                return makeDecision({
                    finalValue: ceoValue,
                    source: "MEMORY_ASSISTED",
                    confidence: 0.9,
                    needsConfirmation: true,
                    status: "PREDICTED_NEEDS_CONFIRMATION",
                    alertAllowed: false,
                    alertReason: "ceo_overrides_ocr",
                    fieldId,
                    ocrValue,
                });
            }
        }
    }

    // ─── Step 2: Critical Field Blocking ──────────────────────────
    if (item._visionUsed && item._visionCanOverride && item._visionValue !== null && item._visionValue !== undefined) {
        const visionValue = toNumber(item._visionValue);
        if (visionValue !== null) {
            const visionInRange = inRange(visionValue, fieldRange);
            const memoryAgrees = item._memoryAgrees === true;
            const source = memoryAgrees ? "VISION_MEMORY_AGREEMENT" : "VISION_OVERRIDE";
            const needsConfirmation = !memoryAgrees;
            const alertAllowed = memoryAgrees && !visionInRange;
            return makeDecision({
                finalValue: visionValue,
                source,
                confidence: Math.max(item._visionConfidence || 0, ocrNorm),
                needsConfirmation,
                status: memoryAgrees ? "CONFIDENT" : "PREDICTED_NEEDS_CONFIRMATION",
                alertAllowed,
                alertReason: alertAllowed || !needsConfirmation ? null : "VISION_NEEDS_CONFIRMATION",
                fieldId,
                ocrValue,
            });
        }
    }

    if (hasOcrValue && isCriticallyLowOcrValue(fieldRange, numOcrValue)) {
        // This is a physically impossible reading. Block it hard.
        return makeDecision({
            finalValue: null,
            source: "HUMAN_REQUIRED",
            confidence: 0.2,
            needsConfirmation: true,
            status: "MANUAL_REQUIRED",
            alertAllowed: false,
            alertReason: `CRITICAL_LOW_BLOCKED:${classifyFieldRange(fieldRange.min, fieldRange.max)}`,
            fieldId,
            ocrValue,
        });
    }

    // ─── Step 3: Catastrophic OCR Failure ─────────────────────────
    if (hasOcrValue && isCatastrophicOcrFailure(numOcrValue, fieldRange)) {
        return makeDecision({
            finalValue: null,
            source: "HUMAN_REQUIRED",
            confidence: 0.1,
            needsConfirmation: true,
            status: "MANUAL_REQUIRED",
            alertAllowed: false,
            alertReason: "CATASTROPHIC_OCR_FAILURE",
            fieldId,
            ocrValue,
        });
    }

    // ─── Step 4: No OCR value → MISSING_VALUE ─────────────────────
    if (!hasOcrValue) {
        return makeDecision({
            finalValue: null,
            source: "MISSING_VALUE",
            confidence: 0,
            needsConfirmation: true,
            status: "MISSING_VALUE",
            alertAllowed: false,
            alertReason: "MISSING_VALUE",
            fieldId,
            ocrValue,
        });
    }

    // ─── Step 5: OCR value in range + high confidence → TRUST OCR ──
    if (ocrInRange && ocrNorm >= 0.90) {
        return makeDecision({
            finalValue: numOcrValue,
            source: "OCR_HIGH_CONFIDENCE",
            confidence: ocrNorm,
            needsConfirmation: false,
            status: "CONFIDENT",
            alertAllowed: true,
            alertReason: null,
            fieldId,
            ocrValue,
        });
    }

    // ─── Step 6: OCR in range + medium confidence ──────────────────
    if (ocrInRange && ocrNorm >= 0.70) {
        return makeDecision({
            finalValue: numOcrValue,
            source: "OCR_WITH_MEMORY_SUPPORT",
            confidence: ocrNorm,
            needsConfirmation: true,
            status: "PREDICTED_NEEDS_CONFIRMATION",
            alertAllowed: false,
            alertReason: "MEDIUM_CONFIDENCE_NEEDS_CONFIRMATION",
            fieldId,
            ocrValue,
        });
    }

    // ─── Step 7: OCR in range + low confidence ────────────────────
    if (ocrInRange && ocrNorm < 0.70) {
        return makeDecision({
            finalValue: numOcrValue,
            source: "HUMAN_REQUIRED",
            confidence: ocrNorm,
            needsConfirmation: true,
            status: "MANUAL_REQUIRED",
            alertAllowed: false,
            alertReason: "LOW_CONFIDENCE_OCR",
            fieldId,
            ocrValue,
        });
    }

    // ─── Step 8: OCR out of range (but not critically low) ────────
    // CTO DIRECTIVE: NEVER pass impossible OCR values to user.
    // If value is outside the expected range, it's an OCR error.
    // Return null — force human confirmation. Do NOT show the value.
    return makeDecision({
        finalValue: null,
        source: "HUMAN_REQUIRED",
        confidence: Math.min(ocrNorm, 0.3),
        needsConfirmation: true,
        status: "MANUAL_REQUIRED",
        alertAllowed: false,
        alertReason: "OCR_OUT_OF_RANGE_BLOCKED",
        fieldId,
        ocrValue,
    });
}

/**
 * Helper to build a decision result object
 */
function makeDecision({ finalValue, source, confidence, needsConfirmation, status, alertAllowed, alertReason, fieldId, ocrValue }) {
    return {
        final_suggested_value: finalValue,
        prediction_source: source,
        prediction_confidence: confidence,
        needs_confirmation: needsConfirmation,
        status: status,
        alert_allowed: alertAllowed,
        alert_block_reason: alertReason,
        field_id: fieldId,
        raw_ocr_value: ocrValue,
    };
}

// ─── Batch Decision for Full Form ─────────────────────────────────────

/**
 * Run decision engine on all items in a form.
 * Returns enhanced items with _decision attached.
 */
function decideFormValues(items, storeCode, writerName, columnLabel, ocrConfidence) {
    const results = [];
    let alertBlockedCount = 0;
    let highConfidenceCount = 0;
    let manualRequiredCount = 0;

    for (const item of items) {
        const decision = decideFieldValue({
            item,
            storeCode,
            writerName,
            columnLabel,
            ocrConfidence,
        });

        results.push({
            ...item,
            _decision: decision,
            detectedValue: decision.final_suggested_value,
            value: decision.final_suggested_value,
            _predictionSource: decision.prediction_source,
            _predictionConfidence: decision.prediction_confidence,
            _needsConfirmation: decision.needs_confirmation,
            _alertAllowed: decision.alert_allowed,
            _alertBlockReason: decision.alert_block_reason,
            confidence: decision.prediction_confidence,
        });

        if (!decision.alert_allowed) alertBlockedCount++;
        if (decision.status === "CONFIDENT") highConfidenceCount++;
        if (decision.status === "MANUAL_REQUIRED") manualRequiredCount++;
    }

    return {
        items: results,
        summary: {
            total: results.length,
            high_confidence: highConfidenceCount,
            alert_blocked: alertBlockedCount,
            manual_required: manualRequiredCount,
        },
    };
}

// ─── Module Exports ───────────────────────────────────────────────────

module.exports = {
    decideFieldValue,
    decideFormValues,
    canSendAlert,
    evaluateSubmissionAlerts,
    isCriticallyLowOcrValue,
    isCatastrophicOcrFailure,
    classifyFieldRange,
    ALERT_MIN_CONFIDENCE,
    ALERT_ALLOWED_SOURCES,
    CRITICAL_FIELD_RANGES,
    STATUS,
};
