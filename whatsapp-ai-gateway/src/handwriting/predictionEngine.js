/**
 * predictionEngine.js — Phase 5: Prediction Engine
 * 
 * Combines OCR, memory, ranges, and history to produce final suggestions.
 * 
 * Output per field:
 *   final_suggested_value
 *   prediction_source
 *   prediction_confidence
 *   needs_confirmation
 *   status
 */

const logger = require("../logger");
const { searchMemory, getMostCommonValue } = require("./memorySearch");
const { buildDecision, normalizeConfidence, displayColumn } = require("./conflictResolver");

// ─── Prediction Sources ────────────────────────────────────────────────
const SOURCES = {
    OCR_HIGH_CONFIDENCE: "OCR_HIGH_CONFIDENCE",
    OCR_WITH_MEMORY_SUPPORT: "OCR_WITH_MEMORY_SUPPORT",
    MEMORY_ASSISTED: "MEMORY_ASSISTED",
    RANGE_CORRECTED: "RANGE_CORRECTED",
    HUMAN_REQUIRED: "HUMAN_REQUIRED",
    MANUAL_ENTRY: "MANUAL_ENTRY",
};

// ─── Confidence Thresholds ─────────────────────────────────────────────
const OCR_HIGH_CONFIDENCE_THRESHOLD = 90;
const OCR_MEDIUM_CONFIDENCE_THRESHOLD = 70;
const MEMORY_STRONG_MATCH_THRESHOLD = 0.7;
const MEMORY_WEAK_MATCH_THRESHOLD = 0.4;

/**
 * Predict final values for all fields in a form submission
 * 
 * @param {Object} opts
 * @param {Array} opts.items - Parsed OCR items
 * @param {number} opts.ocrConfidence - Overall OCR confidence
 * @param {string} opts.storeCode - Store code
 * @param {string} opts.templateId - Template ID
 * @param {string} opts.employeeName - Employee name (optional)
 * @param {string} opts.employeePhone - Employee phone (optional)
 * @param {string} opts.selectedColumn - Selected column (e.g., "10:00")
 * @returns {Object} Enhanced items with predictions
 */
async function predictFormValues(opts = {}) {
    const {
        items = [],
        ocrConfidence = 0,
        storeCode,
        templateId,
        employeeName,
        employeePhone,
        selectedColumn,
    } = opts;

    const predictions = [];
    let highConfidenceCount = 0;
    let memoryAssistedCount = 0;
    let humanRequiredCount = 0;

    for (const item of items) {
        const fieldId = item.field_id || item.id;
        const ocrValue = item.detectedValue !== undefined ? item.detectedValue : item.value;
        const ocrItemConfidence = normalizeConfidence(item.confidence || ocrConfidence || 0);
        const fieldRange = (item.safeRange || item.range_min !== undefined)
            ? {
                min: item.range_min ?? (item.safeRange && item.safeRange.min) ?? -20,
                max: item.range_max ?? (item.safeRange && item.safeRange.max) ?? 450,
            }
            : { min: -20, max: 450 };

        // Search memory for this field
        let memoryMatches = [];
        try {
            memoryMatches = await searchMemory({
                store_code: storeCode,
                field_id: fieldId,
                employee_name: employeeName,
                employee_phone: employeePhone,
                template_id: templateId,
                limit: 5,
            });
        } catch (err) {
            logger.warn("Memory search failed for field", { fieldId, error: err.message });
        }

        const bestMatch = memoryMatches.length > 0 ? memoryMatches[0] : null;
        const prediction = normalizePredictionDecision(predictSingleField({
            ocrValue,
            ocrItemConfidence,
            ocrOverallConfidence: ocrConfidence,
            fieldRange,
            fieldId,
            bestMatch,
            memoryMatchCount: memoryMatches.length,
            item,
            storeCode,
            selectedColumn,
        }));

        logger.info("[MEMORY_PREDICTION]", {
            field_id: fieldId,
            ocr_value: ocrValue === undefined ? null : ocrValue,
            memory_matches: memoryMatches.length,
            top_memory_value: bestMatch ? Number(bestMatch.confirmed_value) : null,
            similarity: bestMatch ? bestMatch.similarity_score : 0,
            final_value: prediction.final_suggested_value,
            source: prediction.prediction_source,
            memory_used: memoryMatches.length > 0,
            alert_allowed: prediction.alert_allowed,
            alert_block_reason: prediction.alert_block_reason || null,
        });

        predictions.push({
            ...item,
            _prediction: prediction,
            detectedValue: prediction.final_suggested_value,
            value: prediction.final_suggested_value,
            _predictionSource: prediction.prediction_source,
            _needsConfirmation: prediction.needs_confirmation,
            _rawOcrValue: ocrValue,
            _rawOcrConfidence: ocrItemConfidence,
            _memoryMatches: memoryMatches.slice(0, 3), // Keep top 3 for reference
            _alertAllowed: prediction.alert_allowed,
            _alertBlockReason: prediction.alert_block_reason || null,
        });

        if (prediction.prediction_source === SOURCES.OCR_HIGH_CONFIDENCE) highConfidenceCount++;
        else if (prediction.prediction_source === SOURCES.OCR_WITH_MEMORY_SUPPORT ||
            prediction.prediction_source === SOURCES.MEMORY_ASSISTED) memoryAssistedCount++;
        else if (prediction.prediction_source === SOURCES.HUMAN_REQUIRED) humanRequiredCount++;
    }

    // Overall form assessment
    const totalFields = items.length;
    const detectedFields = predictions.filter(p => p.detectedValue !== null && p.detectedValue !== undefined).length;
    const unclearFields = humanRequiredCount;
    const needsConfirmation = memoryAssistedCount > 0 || unclearFields > 0 ||
        (ocrConfidence < OCR_HIGH_CONFIDENCE_THRESHOLD);

    return {
        predictions,
        summary: {
            total_fields: totalFields,
            detected_fields: detectedFields,
            high_confidence: highConfidenceCount,
            memory_assisted: memoryAssistedCount,
            human_required: humanRequiredCount,
            ocr_confidence: ocrConfidence,
            needs_confirmation: needsConfirmation,
            all_clear: ocrConfidence >= OCR_HIGH_CONFIDENCE_THRESHOLD && unclearFields === 0,
        },
    };
}

function normalizePredictionDecision(prediction) {
    const normalized = { ...prediction };
    if (normalized.alert_allowed === undefined) {
        normalized.alert_allowed = normalized.needs_confirmation === false &&
            ["CONFIDENT", "CONFIRMED_BY_MEMORY"].includes(normalized.status);
    }
    if (normalized.alert_allowed === false && !normalized.alert_block_reason) {
        normalized.alert_block_reason = normalized.status === "MISSING" || normalized.status === "MISSING_VALUE"
            ? "MISSING_VALUE"
            : "LOW_CONFIDENCE_OCR";
    }
    return normalized;
}

/**
 * Predict value for a single field
 */
function predictSingleField(opts) {
    const {
        ocrValue,
        ocrItemConfidence,
        ocrOverallConfidence,
        fieldRange,
        fieldId,
        bestMatch,
        memoryMatchCount,
        item,
        storeCode,
        selectedColumn,
    } = opts;

    const hasOcrValue = ocrValue !== null && ocrValue !== undefined;
    const numOcrValue = hasOcrValue ? parseFloat(ocrValue) : null;
    const inRange = numOcrValue !== null && numOcrValue >= fieldRange.min && numOcrValue <= fieldRange.max;
    const memoryValue = bestMatch ? parseFloat(bestMatch.confirmed_value) : null;
    const memoryInRange = memoryValue !== null && memoryValue >= fieldRange.min && memoryValue <= fieldRange.max;
    const memoryStrong = bestMatch && bestMatch.similarity_score >= MEMORY_STRONG_MATCH_THRESHOLD;
    const memoryWeak = bestMatch && bestMatch.similarity_score >= MEMORY_WEAK_MATCH_THRESHOLD;

    const mandatoryDecision = buildDecision({
        ocrValue,
        ocrItemConfidence,
        fieldRange,
        fieldId,
        bestMatch,
        selectedColumn,
        storeCode,
    });
    if (mandatoryDecision) return mandatoryDecision;

    // ─── Rule 1: High confidence OCR + in range → trust OCR ───
    if (hasOcrValue && ocrItemConfidence >= OCR_HIGH_CONFIDENCE_THRESHOLD && inRange) {
        return {
            final_suggested_value: numOcrValue,
            prediction_source: memoryStrong
                ? SOURCES.OCR_WITH_MEMORY_SUPPORT
                : SOURCES.OCR_HIGH_CONFIDENCE,
            prediction_confidence: Math.min(ocrItemConfidence / 100, 0.98),
            needs_confirmation: false,
            status: "CONFIDENT",
        };
    }

    // ─── Rule 2: OCR in range + memory confirms same value ───
    if (hasOcrValue && inRange && memoryStrong && memoryInRange) {
        const memoryConfirmed = Math.abs(numOcrValue - memoryValue) <= 2; // Within 2 degrees
        if (memoryConfirmed) {
            return {
                final_suggested_value: numOcrValue,
                prediction_source: SOURCES.OCR_WITH_MEMORY_SUPPORT,
                prediction_confidence: 0.85,
                needs_confirmation: false,
                status: "CONFIRMED_BY_MEMORY",
            };
        }
    }

    // ─── Rule 3: OCR out of range but memory suggests in-range value ───
    // CEO Directive: When OCR reads an impossible value, ALWAYS check memory and override
    if (hasOcrValue && !inRange) {
        // First try strong memory match
        if (memoryStrong && memoryInRange) {
            return {
                final_suggested_value: memoryValue,
                prediction_source: SOURCES.MEMORY_ASSISTED,
                prediction_confidence: bestMatch.similarity_score * 0.9,
                needs_confirmation: true,
                status: "PREDICTED_NEEDS_CONFIRMATION",
            };
        }
        // CEO Directive: Even without strong match, use store-level history to override impossible OCR
        // e.g. OCR reads "4" for SO-10 (Dishwasher Sanitizer, range 150-180) — memory has 100,101,102
        if (memoryValue !== null && memoryInRange) {
            return {
                final_suggested_value: memoryValue,
                prediction_source: SOURCES.MEMORY_ASSISTED,
                prediction_confidence: 0.65,
                needs_confirmation: true,
                status: "PREDICTED_NEEDS_CONFIRMATION",
            };
        }
    }

    // ─── Rule 4: No OCR value but memory has good match ───
    if (!hasOcrValue && memoryStrong && memoryInRange) {
        return {
            final_suggested_value: memoryValue,
            prediction_source: SOURCES.MEMORY_ASSISTED,
            prediction_confidence: bestMatch.similarity_score * 0.8,
            needs_confirmation: true,
            status: "PREDICTED_NEEDS_CONFIRMATION",
        };
    }

    // ─── Rule 5: OCR value in range but medium confidence ───
    if (hasOcrValue && inRange && ocrItemConfidence >= OCR_MEDIUM_CONFIDENCE_THRESHOLD) {
        return {
            final_suggested_value: numOcrValue,
            prediction_source: SOURCES.OCR_HIGH_CONFIDENCE,
            prediction_confidence: ocrItemConfidence / 100,
            needs_confirmation: true, // Medium confidence → needs confirmation
            status: "LOW_CONFIDENCE_NEEDS_CONFIRMATION",
        };
    }

    // ─── Rule 6: OCR value in range but low confidence, weak memory support ───
    if (hasOcrValue && inRange && memoryWeak) {
        return {
            final_suggested_value: numOcrValue,
            prediction_source: SOURCES.OCR_WITH_MEMORY_SUPPORT,
            prediction_confidence: 0.6,
            needs_confirmation: true,
            status: "WEAK_MEMORY_NEEDS_CONFIRMATION",
        };
    }

    // ─── Rule 7: OCR value out of range, no memory ───
    if (hasOcrValue && !inRange) {
        // Check if the value is plausibly a handwriting misread
        // E.g., OCR might read "7" when it's "30" (missing the leading 3)
        const rangeMid = (fieldRange.min + fieldRange.max) / 2;
        const commonMisread = findCommonMisread(numOcrValue, fieldRange);

        if (commonMisread !== null) {
            return {
                final_suggested_value: commonMisread,
                prediction_source: SOURCES.RANGE_CORRECTED,
                prediction_confidence: 0.5,
                needs_confirmation: true,
                status: "RANGE_CORRECTED_NEEDS_CONFIRMATION",
            };
        }

        // Most common value fallback
        if (memoryValue !== null && memoryInRange) {
            return {
                final_suggested_value: memoryValue,
                prediction_source: SOURCES.MEMORY_ASSISTED,
                prediction_confidence: 0.55,
                needs_confirmation: true,
                status: "PREDICTED_NEEDS_CONFIRMATION",
            };
        }

        return {
            final_suggested_value: numOcrValue,
            prediction_source: SOURCES.HUMAN_REQUIRED,
            prediction_confidence: 0.3,
            needs_confirmation: true,
            status: "UNCLEAR_OUT_OF_RANGE",
        };
    }

    // ─── Rule 8: Has OCR value in range but very low confidence ───
    if (hasOcrValue && inRange && ocrItemConfidence < OCR_MEDIUM_CONFIDENCE_THRESHOLD) {
        if (memoryValue !== null && memoryInRange && Math.abs(numOcrValue - memoryValue) <= 5) {
            return {
                final_suggested_value: memoryValue,
                prediction_source: SOURCES.MEMORY_ASSISTED,
                prediction_confidence: 0.6,
                needs_confirmation: true,
                status: "LOW_CONFIDENCE_MEMORY_ASSISTED",
            };
        }
        return {
            final_suggested_value: numOcrValue,
            prediction_source: SOURCES.HUMAN_REQUIRED,
            prediction_confidence: 0.4,
            needs_confirmation: true,
            status: "LOW_CONFIDENCE_NEEDS_CONFIRMATION",
        };
    }

    // ─── Rule 9: Has OCR value in range, low confidence, memory suggests different ───
    if (hasOcrValue && inRange && memoryStrong && memoryInRange && Math.abs(numOcrValue - memoryValue) > 5) {
        // OCR and memory disagree significantly — ask human
        return {
            final_suggested_value: numOcrValue,
            prediction_source: SOURCES.HUMAN_REQUIRED,
            prediction_confidence: 0.4,
            needs_confirmation: true,
            status: "OCR_MEMORY_DISAGREE",
        };
    }

    // ─── Fallback: Human required ───
    return {
        final_suggested_value: hasOcrValue ? numOcrValue : null,
        prediction_source: SOURCES.HUMAN_REQUIRED,
        prediction_confidence: hasOcrValue ? 0.3 : 0,
        needs_confirmation: true,
        status: hasOcrValue ? "UNCLEAR" : "MISSING",
    };
}

/**
 * Find common OCR misreads for temperature values
 * E.g., handwriting "30" can be misread as "3" or "0"
 */
function findCommonMisread(ocrValue, fieldRange) {
    if (ocrValue === null || ocrValue === undefined) return null;

    const strVal = String(Math.abs(ocrValue));

    // Common misread patterns
    const misreadMap = {
        // Single digit that might be missing a leading digit
        "0": [100, 10, 40, 30, 20, 200, 300],
        "1": [101, 11, 41, 31, 21, 201, 351, 100],
        "2": [102, 12, 42, 32, 22, 202, 352, 200],
        "3": [103, 13, 43, 33, 23, 300, 353, 30],
        "4": [104, 14, 44, 34, 24, 400, 354, 40],
        "5": [105, 15, 45, 35, 25, 355, 50],
        "6": [106, 16, 356, 60],
        "7": [107, 17, 30, 37, 357, 70],
        "8": [108, 18, 38, 358, 80],
        "9": [109, 19, 39, 359, 90],
    };

    const candidates = misreadMap[strVal] || [];

    // Find a candidate that falls in the expected range
    for (const candidate of candidates) {
        if (candidate >= fieldRange.min && candidate <= fieldRange.max) {
            return candidate;
        }
    }

    return null;
}

module.exports = {
    predictFormValues,
    predictSingleField,
    findCommonMisread,
    SOURCES,
    OCR_HIGH_CONFIDENCE_THRESHOLD,
};
