/**
 * visionAiReviewer.js — Phase 5: Vision AI Reviewer Layer
 *
 * Uses Vision AI ONLY as a reviewer — not as primary OCR.
 *
 * Vision is called ONLY when needed:
 *   - low OCR confidence
 *   - memory conflict
 *   - out-of-range OCR on critical field
 *   - blank/dash uncertainty
 *   - common bad OCR value detected
 *
 * Vision NEVER silently saves. It only informs the Decision Engine.
 *
 * Config:
 *   VISION_REVIEW_ENABLED=true|false
 *   VISION_PROVIDER=openai|disabled
 *   VISION_REVIEW_FIELDS=critical_only|all
 *   VISION_MAX_CALLS_PER_FORM=6
 *   VISION_TIMEOUT_MS=15000
 */

const logger = require("./logger");
const db = require("./database");
const storeKnowledge = require("./storeKnowledge");
const { getProvider } = require("./vision/providers");

const VISION_REVIEW_FIELDS = process.env.VISION_REVIEW_FIELDS || "critical_only";
const VISION_MAX_CALLS_PER_FORM = Number(process.env.VISION_MAX_CALLS_PER_FORM || 6);
const VISION_CONFIDENCE_THRESHOLD = 0.85; // Vision confidence below this cannot override OCR

// ─── Init ─────────────────────────────────────────────────────────────

function initVisionReviewTable() {
    db.run(`
        CREATE TABLE IF NOT EXISTS vision_review_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            submission_id TEXT,
            store_code TEXT,
            field_id TEXT NOT NULL,
            column_label TEXT,
            ocr_value TEXT,
            ocr_confidence REAL,
            memory_value TEXT,
            vision_value TEXT,
            vision_confidence REAL,
            vision_reason TEXT,
            should_override_ocr INTEGER DEFAULT 0,
            final_value TEXT,
            final_source TEXT,
            vision_provider TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

// ─── Determine if Vision is Needed ────────────────────────────────────

/**
 * Determine if a field needs vision review.
 *
 * @param {object} opts
 * @param {string} opts.storeCode - "B1", "B2", "B3"
 * @param {string} opts.fieldId - e.g. "SO-16"
 * @param {number|null} opts.ocrValue - raw OCR value
 * @param {number|null} opts.ocrConfidence - 0-1
 * @param {string} opts.predictionSource - current decision source
 * @param {number|null} opts.memoryValue - memory-predicted value
 * @param {string} opts.decisionStatus - e.g. "MANUAL_REQUIRED", "CONFIDENT"
 * @param {string} opts.visionReason - why vision was triggered
 * @returns {boolean}
 */
function needsVisionReview(opts) {
    const {
        storeCode,
        fieldId,
        ocrValue,
        ocrConfidence,
        predictionSource,
        memoryValue,
        decisionStatus,
    } = opts;

    if (VISION_REVIEW_FIELDS === "none") return false;

    // Only review fields with uncertain decision status
    const uncertainStatuses = ["MANUAL_REQUIRED", "NEEDS_CONFIRMATION", "ALERT_BLOCKED"];
    if (!uncertainStatuses.includes(decisionStatus)) return false;

    // Vision review if: low confidence on critical field
    if (ocrConfidence !== null && ocrConfidence < 0.80) {
        if (VISION_REVIEW_FIELDS === "critical_only") {
            if (storeKnowledge.isCriticalField(storeCode, fieldId)) return true;
        }
        return true;
    }

    // Vision review if: memory conflict (OCR != memory and both exist)
    if (ocrValue !== null && memoryValue !== null) {
        if (Math.abs(Number(ocrValue) - Number(memoryValue)) > 5) {
            if (VISION_REVIEW_FIELDS === "critical_only") {
                if (storeKnowledge.isCriticalField(storeCode, fieldId)) return true;
            }
            return true;
        }
    }

    // Vision review if: OCR is a known bad value
    if (storeKnowledge.isCommonBadOcrValue(storeCode, fieldId, ocrValue)) {
        return true;
    }

    // Vision review if: OCR is out of range on critical field
    if (ocrValue !== null) {
        const field = storeKnowledge.getFieldKnowledge(storeCode, fieldId);
        if (field) {
            const [min, max] = field.range;
            if (ocrValue < min || ocrValue > max) {
                if (field.criticality === "critical") return true;
            }
        }
    }

    return false;
}

/**
 * Get the list of fields that need vision review for a form.
 * Limits to VISION_MAX_CALLS_PER_FORM per submission.
 *
 * @param {Array} items - form items with decision info
 * @param {string} storeCode
 * @returns {Array} items needing vision review (capped)
 */
function getFieldsNeedingVisionReview(items, storeCode) {
    const needs = [];
    for (const item of items) {
        const should = needsVisionReview({
            storeCode,
            fieldId: item.field_id || item.id,
            ocrValue: item._rawOcrValue !== undefined ? item._rawOcrValue : item.detectedValue,
            ocrConfidence: item._rawOcrConfidence || item.confidence,
            predictionSource: item._predictionSource,
            memoryValue: item._memoryValue || null,
            decisionStatus: item._decision ? item._decision.status : null,
        });
        if (should) needs.push(item);
    }
    // Cap at max calls per form
    return needs.slice(0, VISION_MAX_CALLS_PER_FORM);
}

// ─── Review a Single Field ────────────────────────────────────────────

/**
 * Review a single field using Vision AI.
 *
 * @param {object} opts
 * @param {string} opts.imagePath - path to the full form image
 * @param {string} opts.storeCode - B1/B2/B3
 * @param {string} opts.templateId - template ID
 * @param {string} opts.fieldId - field ID
 * @param {string} opts.fieldLabel - field label
 * @param {Array} opts.expectedRange - [min, max]
 * @param {number|null} opts.ocrValue
 * @param {number|null} opts.ocrConfidence
 * @param {number|null} opts.memoryValue
 * @param {string} opts.submissionId
 * @param {string} opts.columnLabel
 * @returns {object} vision review result
 */
async function reviewField(opts) {
    const provider = getProvider();

    const result = await provider.reviewField({
        imagePath: opts.imagePath,
        fieldId: opts.fieldId,
        fieldLabel: opts.fieldLabel,
        expectedRange: opts.expectedRange,
        ocrValue: opts.ocrValue,
        memoryValue: opts.memoryValue,
        storeCode: opts.storeCode,
        templateId: opts.templateId,
    });

    // Never allow vision to auto-save — only inform the decision engine
    // Cap vision_confidence if below threshold
    if (result.vision_confidence !== undefined && result.vision_confidence < VISION_CONFIDENCE_THRESHOLD) {
        result.should_override_ocr = false;
        result.override_blocked_reason = `vision_confidence_${result.vision_confidence}_below_${VISION_CONFIDENCE_THRESHOLD}`;
    }

    // Log to DB
    try {
        db.run(
            `INSERT INTO vision_review_log
               (submission_id, store_code, field_id, column_label, ocr_value, ocr_confidence,
                memory_value, vision_value, vision_confidence, vision_reason,
                should_override_ocr, vision_provider)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                opts.submissionId || null,
                opts.storeCode || null,
                opts.fieldId,
                opts.columnLabel || null,
                opts.ocrValue !== null ? String(opts.ocrValue) : null,
                opts.ocrConfidence,
                opts.memoryValue !== null ? String(opts.memoryValue) : null,
                result.vision_value !== null ? String(result.vision_value) : null,
                result.vision_confidence || 0,
                result.reason || null,
                result.should_override_ocr ? 1 : 0,
                process.env.VISION_PROVIDER || "unknown",
            ]
        );
    } catch (err) {
        logger.warn("[VisionReviewer] Failed to log review", { error: err.message });
    }

    logger.info("[VisionReviewer] Field reviewed", {
        fieldId: opts.fieldId,
        ocrValue: opts.ocrValue,
        memoryValue: opts.memoryValue,
        visionValue: result.vision_value,
        visionConfidence: result.vision_confidence,
        shouldOverrideOcr: result.should_override_ocr,
        available: result.available,
    });

    return result;
}

// ─── Batch Review ─────────────────────────────────────────────────────

/**
 * Review multiple fields on a form.
 * Returns a map of fieldId -> vision result.
 *
 * @param {Array} items - items needing vision review
 * @param {object} context - { imagePath, storeCode, templateId, submissionId, columnLabel }
 * @returns {object} map of fieldId -> vision result
 */
async function reviewFields(items, context) {
    const results = {};
    const providerName = process.env.VISION_PROVIDER || "disabled";

    // Check availability first
    const provider = getProvider();
    const available = await provider.isAvailable();
    if (!available) {
        logger.info("[VisionReviewer] Provider not available, skipping all reviews");
        for (const item of items) {
            const fieldId = item.field_id || item.id;
            results[fieldId] = {
                available: false,
                reason: "Provider unavailable",
                vision_value: null,
                vision_confidence: 0,
                should_override_ocr: false,
            };
        }
        return results;
    }

    // Review each field
    for (const item of items) {
        const fieldId = item.field_id || item.id;
        const field = storeKnowledge.getFieldKnowledge(context.storeCode, fieldId);
        const expectedRange = field ? field.range : null;

        const visionResult = await reviewField({
            imagePath: context.imagePath,
            storeCode: context.storeCode,
            templateId: context.templateId,
            fieldId,
            fieldLabel: item.label || item.item || fieldId,
            expectedRange,
            ocrValue: item._rawOcrValue !== undefined ? item._rawOcrValue : item.detectedValue,
            ocrConfidence: item._rawOcrConfidence || item.confidence || 0,
            memoryValue: item._memoryValue || null,
            submissionId: context.submissionId,
            columnLabel: context.columnLabel,
        });

        results[fieldId] = visionResult;
    }

    return results;
}

// ─── Fused Value Decision ─────────────────────────────────────────────

/**
 * Fuse vision result into the final value decision.
 *
 * Rules:
 *   - Vision can only override OCR if: should_override_ocr === true AND vision_confidence >= threshold
 *   - Vision never silently saves
 *   - Vision agreement with memory strengthens confidence
 *
 * @param {object} visionResult
 * @param {object} item - form item
 * @param {number|null} memoryValue
 * @returns {object} enhanced decision
 */
function fuseVisionResult(visionResult, item, memoryValue) {
    if (!visionResult || !visionResult.available) {
        return {
            ...item,
            _visionResult: null,
            _visionUsed: false,
        };
    }

    const canOverride =
        visionResult.should_override_ocr === true &&
        (visionResult.vision_confidence || 0) >= VISION_CONFIDENCE_THRESHOLD;

    // Vision + memory agreement = strong confidence
    const memoryAgrees = memoryValue !== null && visionResult.vision_value !== null
        && Math.abs(Number(memoryValue) - Number(visionResult.vision_value)) <= 2;

    let finalSource = item._predictionSource || "OCR";
    let finalConfidence = item._predictionConfidence || 0.5;

    if (canOverride) {
        finalSource = "VISION_OVERRIDE";
        finalConfidence = Math.max(finalConfidence, visionResult.vision_confidence || 0.5);
    } else if (memoryAgrees && visionResult.vision_value !== null) {
        finalSource = "VISION_MEMORY_AGREEMENT";
        finalConfidence = Math.min(1, finalConfidence + 0.15);
    }

    return {
        ...item,
        _visionResult: visionResult,
        _visionUsed: true,
        _visionCanOverride: canOverride,
        _visionValue: visionResult.vision_value,
        _visionConfidence: visionResult.vision_confidence,
        _visionReason: visionResult.reason,
        _memoryAgrees: memoryAgrees,
        _predictionSource: finalSource,
        _predictionConfidence: finalConfidence,
    };
}

module.exports = {
    initVisionReviewTable,
    needsVisionReview,
    getFieldsNeedingVisionReview,
    reviewField,
    reviewFields,
    fuseVisionResult,
    VISION_MAX_CALLS_PER_FORM,
    VISION_CONFIDENCE_THRESHOLD,
};
