/**
 * cellCropStorage.js — Phase 1: Cell Crop Storage
 * 
 * Saves cropped cell images for every official Food Safety form.
 * These crops are the training memory for the handwriting learning system.
 */

const fs = require("fs");
const path = require("path");
const logger = require("../logger");
const db = require("../database");

const CROPS_BASE = path.join(__dirname, "..", "..", "data", "handwriting", "crops");

/**
 * Ensure directory exists
 */
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

/**
 * Get the crop storage path for a specific cell
 * Path: data/handwriting/crops/{store_code}/{date}/{submission_id}/{field_id}_{column}.png
 */
function getCropPath(storeCode, submissionId, fieldId, column) {
    const dateStr = new Date().toISOString().slice(0, 10);
    const safeFieldId = String(fieldId).replace(/[^a-zA-Z0-9-]/g, "_");
    const safeColumn = String(column || "default").replace(/[^a-zA-Z0-9-:]/g, "_");
    const filename = `${safeFieldId}_${safeColumn}.png`;

    const cropDir = path.join(CROPS_BASE, storeCode, dateStr, String(submissionId));
    ensureDir(cropDir);

    return path.join(cropDir, filename);
}

/**
 * Save a cell crop image and metadata
 */
function saveCellCrop(data) {
    const {
        submission_id,
        group_id,
        store_code,
        store_name,
        template_id,
        field_id,
        item_name,
        column,
        raw_cell_image_buffer,  // Buffer or path to copy from
        raw_cell_image_path,    // Alternative: source path
        ocr_text,
        ocr_value,
        ocr_confidence,
    } = data;

    const targetPath = getCropPath(store_code, submission_id, field_id, column);

    // Copy/write the image
    if (raw_cell_image_buffer && Buffer.isBuffer(raw_cell_image_buffer)) {
        fs.writeFileSync(targetPath, raw_cell_image_buffer);
    } else if (raw_cell_image_path && fs.existsSync(raw_cell_image_path)) {
        fs.copyFileSync(raw_cell_image_path, targetPath);
    } else {
        logger.warn("No image data for cell crop", { field_id, submission_id });
        return null;
    }

    // Save processed version (same as raw for now; can add preprocessing later)
    const processedPath = targetPath.replace(".png", "_processed.png");
    fs.copyFileSync(targetPath, processedPath);

    // Insert into database
    db.run(
        `INSERT INTO handwriting_cell_crops
           (submission_id, group_id, store_code, store_name, template_id,
            field_id, item_name, column, raw_cell_image_path, processed_cell_image_path,
            ocr_text, ocr_value, ocr_confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
            submission_id,
            group_id || null,
            store_code || "unknown",
            store_name || null,
            template_id || null,
            field_id,
            item_name || null,
            column || null,
            targetPath,
            processedPath,
            ocr_text || null,
            ocr_value !== undefined ? String(ocr_value) : null,
            ocr_confidence || null,
        ]
    );
    db.saveDb();

    logger.info("Cell crop saved", {
        submission_id,
        field_id,
        store_code,
        path: targetPath,
    });

    return targetPath;
}

/**
 * Save all cell crops for a submission in batch
 */
function saveSubmissionCrops(submissionId, storeCode, storeName, templateId, groupId, items, column) {
    const results = [];
    for (const item of items) {
        const cropData = {
            submission_id: submissionId,
            group_id: groupId,
            store_code: storeCode,
            store_name: storeName,
            template_id: templateId,
            field_id: item.field_id || item.id,
            item_name: item.label || item.item || item.item_name,
            column: column || "default",
            raw_cell_image_buffer: item._cellImageBuffer || null,
            raw_cell_image_path: item._cellImagePath || null,
            ocr_text: item._ocrText || null,
            ocr_value: item.detectedValue !== undefined ? item.detectedValue : item.value,
            ocr_confidence: item.confidence || null,
        };
        const p = saveCellCrop(cropData);
        if (p) results.push(p);
    }
    return results;
}

/**
 * Get all crops for a submission
 */
function getCropsForSubmission(submissionId) {
    return db.getAll(
        `SELECT * FROM handwriting_cell_crops WHERE submission_id = ? ORDER BY field_id`,
        [submissionId]
    );
}

/**
 * Get crop count by store
 */
function getCropCountByStore() {
    return db.getAll(
        `SELECT store_code, COUNT(*) as count FROM handwriting_cell_crops GROUP BY store_code`
    );
}

/**
 * Get total crop count
 */
function getTotalCropCount() {
    const row = db.getOne(`SELECT COUNT(*) as total FROM handwriting_cell_crops`);
    return row ? row.total : 0;
}

module.exports = {
    saveCellCrop,
    saveSubmissionCrops,
    getCropsForSubmission,
    getCropCountByStore,
    getTotalCropCount,
    getCropPath,
    CROPS_BASE,
};
