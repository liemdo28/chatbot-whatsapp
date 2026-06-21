const db = require("../database");

function normalizeConfidence(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return 0;
    return n > 1 ? Math.min(n, 100) : Math.min(n * 100, 100);
}

function toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
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

function latestCeoGroundTruth(storeCode, fieldId, columnLabel) {
    if (!storeCode || !fieldId || !columnLabel) return null;
    try {
        return db.getOne(
            `SELECT * FROM ceo_handwriting_ground_truth
             WHERE store_code = ? AND field_id = ? AND column_label = ?
             ORDER BY created_at DESC, id DESC LIMIT 1`,
            [storeCode, fieldId, displayColumn(columnLabel)]
        );
    } catch (_) {
        return null;
    }
}

function isCriticalLowRead(fieldRange, ocrValue) {
    const n = toNumber(ocrValue);
    if (n === null) return false;
    if (fieldRange.min >= 350 && fieldRange.max <= 360 && n < 300) return true;
    if (fieldRange.min >= 95 && fieldRange.max <= 105 && n < 50) return true;
    return false;
}

function buildDecision({
    ocrValue,
    ocrItemConfidence,
    fieldRange,
    fieldId,
    bestMatch,
    selectedColumn,
    storeCode,
}) {
    const ocrConfidence = normalizeConfidence(ocrItemConfidence);
    const numOcrValue = toNumber(ocrValue);
    const hasOcrValue = numOcrValue !== null;
    const ocrInRange = hasOcrValue && inRange(numOcrValue, fieldRange);
    const memoryValue = bestMatch ? toNumber(bestMatch.confirmed_value) : null;
    const memorySimilarity = bestMatch ? Number(bestMatch.similarity_score || 0) : 0;
    const memoryInRange = memoryValue !== null && inRange(memoryValue, fieldRange);
    const ceoTruth = latestCeoGroundTruth(storeCode, fieldId, selectedColumn);
    const ceoMissing = ceoTruth && ceoTruth.value_state === "MISSING";
    const ceoValue = ceoTruth && ceoTruth.value_state === "VALUE" ? toNumber(ceoTruth.confirmed_value) : null;
    const ceoValueInRange = ceoValue !== null && inRange(ceoValue, fieldRange);

    if (ceoMissing && ocrConfidence < 80) {
        return {
            final_suggested_value: null,
            prediction_source: "HUMAN_REQUIRED",
            prediction_confidence: 0,
            needs_confirmation: true,
            status: "MISSING_VALUE",
            alert_allowed: false,
            alert_block_reason: "MISSING_VALUE",
        };
    }

    if (!hasOcrValue) {
        return {
            final_suggested_value: null,
            prediction_source: "HUMAN_REQUIRED",
            prediction_confidence: 0,
            needs_confirmation: true,
            status: "MISSING_VALUE",
            alert_allowed: false,
            alert_block_reason: "MISSING_VALUE",
        };
    }

    if ((ocrConfidence < 80 || !ocrInRange) && ceoValueInRange) {
        return {
            final_suggested_value: ceoValue,
            prediction_source: "MEMORY_ASSISTED",
            prediction_confidence: 0.9,
            needs_confirmation: true,
            status: "PREDICTED_NEEDS_CONFIRMATION",
            alert_allowed: false,
            alert_block_reason: "low_confidence_or_memory_conflict",
        };
    }

    if (ocrConfidence < 80 && memoryInRange) {
        return {
            final_suggested_value: memoryValue,
            prediction_source: "MEMORY_ASSISTED",
            prediction_confidence: Math.max(0.65, Math.min(memorySimilarity || 0.7, 0.95)),
            needs_confirmation: true,
            status: "NEEDS_CONFIRMATION",
            alert_allowed: false,
            alert_block_reason: "low_confidence_or_memory_conflict",
        };
    }

    if (!ocrInRange && memoryInRange && memorySimilarity >= 0.7) {
        return {
            final_suggested_value: memoryValue,
            prediction_source: "MEMORY_ASSISTED",
            prediction_confidence: Math.min(memorySimilarity, 0.95),
            needs_confirmation: true,
            status: "PREDICTED_NEEDS_CONFIRMATION",
            alert_allowed: false,
            alert_block_reason: "low_confidence_or_memory_conflict",
        };
    }

    if (!ocrInRange && memoryInRange) {
        return {
            final_suggested_value: memoryValue,
            prediction_source: "MEMORY_ASSISTED",
            prediction_confidence: 0.65,
            needs_confirmation: true,
            status: "PREDICTED_NEEDS_CONFIRMATION",
            alert_allowed: false,
            alert_block_reason: "low_confidence_or_memory_conflict",
        };
    }

    if (!ocrInRange && !memoryInRange && ocrConfidence < 80) {
        return {
            final_suggested_value: null,
            prediction_source: "HUMAN_REQUIRED",
            prediction_confidence: 0.3,
            needs_confirmation: true,
            status: "MANUAL_REQUIRED",
            alert_allowed: false,
            alert_block_reason: "LOW_CONFIDENCE_OCR",
        };
    }

    if (isCriticalLowRead(fieldRange, numOcrValue)) {
        return {
            final_suggested_value: null,
            prediction_source: "HUMAN_REQUIRED",
            prediction_confidence: 0.3,
            needs_confirmation: true,
            status: "MANUAL_REQUIRED",
            alert_allowed: false,
            alert_block_reason: fieldRange.min >= 350 ? "FRYER_LOW_OCR_BLOCKED" : "HOT_FIELD_LOW_OCR_BLOCKED",
        };
    }

    if (!ocrInRange && !memoryInRange) {
        return {
            final_suggested_value: numOcrValue,
            prediction_source: "HUMAN_REQUIRED",
            prediction_confidence: ocrConfidence / 100,
            needs_confirmation: true,
            status: "MANAGER_REVIEW",
            alert_allowed: ocrConfidence >= 85,
            alert_block_reason: ocrConfidence >= 85 ? null : "LOW_CONFIDENCE_OCR",
        };
    }

    if (ocrInRange && ocrConfidence < 80 && memoryInRange && Math.abs(numOcrValue - memoryValue) > 5) {
        return {
            final_suggested_value: memoryValue,
            prediction_source: "MEMORY_ASSISTED",
            prediction_confidence: 0.65,
            needs_confirmation: true,
            status: "NEEDS_CONFIRMATION",
            alert_allowed: false,
            alert_block_reason: "low_confidence_or_memory_conflict",
        };
    }

    return null;
}

function recordRuntimePredictionAudit(rows) {
    for (const row of rows || []) {
        db.run(
            `INSERT INTO ceo_runtime_prediction_audit
               (submission_id, message_id, chat_id, chat_name, store_code, field_id, column_label,
                raw_ocr_value, raw_ocr_confidence, memory_top_value, memory_similarity,
                range_min, range_max, final_value, final_source, final_status,
                alert_allowed, alert_block_reason)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                row.submission_id || null,
                row.message_id || null,
                row.chat_id || null,
                row.chat_name || null,
                row.store_code || null,
                row.field_id || null,
                row.column_label || null,
                row.raw_ocr_value === undefined ? null : String(row.raw_ocr_value),
                row.raw_ocr_confidence ?? null,
                row.memory_top_value ?? null,
                row.memory_similarity ?? null,
                row.range_min ?? null,
                row.range_max ?? null,
                row.final_value ?? null,
                row.final_source || null,
                row.final_status || null,
                row.alert_allowed ? 1 : 0,
                row.alert_block_reason || null,
            ]
        );
    }
    db.saveDb();
}

module.exports = {
    buildDecision,
    normalizeConfidence,
    displayColumn,
    recordRuntimePredictionAudit,
};
