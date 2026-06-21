/**
 * confirmedSamples.js — Phase 2: Confirmed Handwriting Samples
 * 
 * When employee confirms or edits a value, create a confirmed sample.
 * If OCR guessed wrong and employee edits it, the corrected value is the truth.
 */

const fs = require("fs");
const path = require("path");
const logger = require("../logger");
const db = require("../database");
const { normalizeImage } = require("./featureExtraction");

const SAMPLES_BASE = path.join(__dirname, "..", "..", "data", "handwriting", "samples");

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

/**
 * Get the normalized image path for a confirmed sample
 */
function getNormalizedPath(storeCode, sampleId, fieldId) {
    const safeFieldId = String(fieldId).replace(/[^a-zA-Z0-9-]/g, "_");
    const sampleDir = path.join(SAMPLES_BASE, storeCode);
    ensureDir(sampleDir);
    return path.join(sampleDir, `${sampleId}_${safeFieldId}.png`);
}

/**
 * Save a confirmed handwriting sample
 */
async function saveConfirmedSample(data) {
    const {
        submission_id,
        employee_name,
        employee_phone,
        group_id,
        store_code,
        template_id,
        field_id,
        item_name,
        column,
        confirmed_value,
        raw_ocr_value,
        raw_ocr_confidence,
        cell_image_path,
        source_action, // CONFIRM, EDIT, MANUAL, AUTO_CONFIRM, MANAGER_APPROVED
    } = data;

    // Generate fingerprint from the cell image (async)
    let fingerprint = null;
    let normalized_path = null;

    if (cell_image_path && fs.existsSync(cell_image_path)) {
        try {
            const normalized = await normalizeImage(cell_image_path);
            fingerprint = normalized.fingerprint;
            normalized_path = normalized.outputPath;
        } catch (err) {
            logger.warn("Failed to generate fingerprint for sample", {
                cell_image_path,
                error: err.message,
            });
        }
    }

    const sampleId = `SPL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    db.run(
        `INSERT INTO handwriting_confirmed_samples
           (sample_id, submission_id, employee_name, employee_phone,
            group_id, store_code, template_id, field_id, item_name,
            column, confirmed_value, raw_ocr_value, raw_ocr_confidence,
            cell_image_path, normalized_cell_image_path, fingerprint,
            source_action, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
            sampleId,
            submission_id || null,
            employee_name || null,
            employee_phone || null,
            group_id || null,
            store_code || "unknown",
            template_id || null,
            field_id,
            item_name || null,
            column || null,
            String(confirmed_value),
            raw_ocr_value !== undefined ? String(raw_ocr_value) : null,
            raw_ocr_confidence || null,
            cell_image_path || null,
            normalized_path || null,
            fingerprint || null,
            source_action || "CONFIRM",
        ]
    );
    db.saveDb();

    logger.info("Confirmed sample saved", {
        sample_id: sampleId,
        field_id,
        store_code,
        confirmed_value,
        raw_ocr_value,
        source_action,
    });

    return sampleId;
}

/**
 * Save confirmed samples for an entire submission after CONFIRM action
 */
async function saveConfirmedSubmission(submissionId, parsed, session, sourceAction) {
    const items = parsed.items || [];
    const results = [];

    for (const item of items) {
        // Skip items with no value (missing fields)
        if (item.detectedValue === null || item.detectedValue === undefined) continue;

        const sampleId = await saveConfirmedSample({
            submission_id: submissionId,
            employee_name: session.employeeName || null,
            employee_phone: session.employeePhone || null,
            group_id: session.groupId || null,
            store_code: session.storeCode || parsed.store_id || "unknown",
            template_id: parsed.template_id || null,
            field_id: item.field_id || item.id,
            item_name: item.label || item.item,
            column: parsed.selected_column || "default",
            confirmed_value: item.detectedValue,
            raw_ocr_value: item._rawOcrValue !== undefined ? item._rawOcrValue : item.detectedValue,
            raw_ocr_confidence: item.confidence || null,
            cell_image_path: item._cellImagePath || null,
            source_action: sourceAction || "CONFIRM",
        });
        if (sampleId) results.push(sampleId);
    }

    logger.info("Confirmed submission samples saved", {
        submission_id: submissionId,
        count: results.length,
        source_action: sourceAction,
    });

    return results;
}

/**
 * Get all confirmed samples with optional filters
 */
function getSamples(opts = {}) {
    let sql = "SELECT * FROM handwriting_confirmed_samples WHERE 1=1";
    const params = [];

    if (opts.store_code) { sql += " AND store_code = ?"; params.push(opts.store_code); }
    if (opts.field_id) { sql += " AND field_id = ?"; params.push(opts.field_id); }
    if (opts.employee_name) { sql += " AND employee_name = ?"; params.push(opts.employee_name); }
    if (opts.employee_phone) { sql += " AND employee_phone = ?"; params.push(opts.employee_phone); }
    if (opts.template_id) { sql += " AND template_id = ?"; params.push(opts.template_id); }
    if (opts.source_action) { sql += " AND source_action = ?"; params.push(opts.source_action); }

    sql += " ORDER BY created_at DESC";
    if (opts.limit) { sql += " LIMIT ?"; params.push(opts.limit); }

    return db.getAll(sql, params);
}

/**
 * Get a single sample by ID
 */
function getSampleById(sampleId) {
    return db.getOne(`SELECT * FROM handwriting_confirmed_samples WHERE sample_id = ?`, [sampleId]);
}

/**
 * Get total sample count
 */
function getTotalSampleCount() {
    const row = db.getOne(`SELECT COUNT(*) as total FROM handwriting_confirmed_samples`);
    return row ? row.total : 0;
}

/**
 * Get sample counts by store
 */
function getSampleCountByStore() {
    return db.getAll(
        `SELECT store_code, COUNT(*) as count FROM handwriting_confirmed_samples GROUP BY store_code`
    );
}

/**
 * Get sample counts by employee
 */
function getSampleCountByEmployee() {
    return db.getAll(
        `SELECT employee_name, store_code, COUNT(*) as count
         FROM handwriting_confirmed_samples
         WHERE employee_name IS NOT NULL AND employee_name != ''
         GROUP BY employee_name, store_code`
    );
}

/**
 * Get sample counts by source_action
 */
function getSampleCountBySource() {
    return db.getAll(
        `SELECT source_action, COUNT(*) as count FROM handwriting_confirmed_samples GROUP BY source_action`
    );
}

module.exports = {
    saveConfirmedSample,
    saveConfirmedSubmission,
    getSamples,
    getSampleById,
    getTotalSampleCount,
    getSampleCountByStore,
    getSampleCountByEmployee,
    getSampleCountBySource,
    SAMPLES_BASE,
};
