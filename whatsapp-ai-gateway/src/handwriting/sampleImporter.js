/**
 * sampleImporter.js — Phase 9: Training Samples Import
 * 
 * CEO will send sample handwriting for each group/store.
 * Supports single sample import and bulk form import.
 */

const fs = require("fs");
const path = require("path");
const logger = require("../logger");
const db = require("../database");
const { saveConfirmedSample } = require("./confirmedSamples");
const { extractFeatures } = require("./featureExtraction");
const { saveCellCrop } = require("./cellCropStorage");

const IMPORT_DIR = path.join(__dirname, "..", "..", "data", "handwriting", "imports");

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

/**
 * Import a single handwriting sample
 * 
 * @param {Object} payload
 * @param {string} payload.store_code - e.g., "B2"
 * @param {string} payload.template_id - e.g., "FoodSafety-StoneOak-v3"
 * @param {string} payload.employee_name - e.g., "LD"
 * @param {string} payload.source_image_path - path to image file
 * @param {string} payload.source_image_buffer - base64 image buffer
 * @param {Object} payload.ground_truth - { "SO-01": 30, "SO-02": 0, ... }
 * @param {string} payload.column - e.g., "10:00"
 * @returns {Object} import result
 */
async function importSample(payload) {
    const {
        store_code,
        template_id,
        employee_name,
        employee_phone,
        group_id,
        source_image_path,
        source_image_buffer,
        ground_truth,
        column,
    } = payload;

    if (!store_code || !ground_truth || Object.keys(ground_truth).length === 0) {
        return { success: false, error: "Missing store_code or ground_truth" };
    }

    // Save image to imports directory
    ensureDir(IMPORT_DIR);
    let imageFilePath = source_image_path;

    if (source_image_buffer) {
        const filename = `import_${store_code}_${Date.now()}.jpg`;
        imageFilePath = path.join(IMPORT_DIR, filename);
        const buffer = Buffer.isBuffer(source_image_buffer)
            ? source_image_buffer
            : Buffer.from(source_image_buffer, "base64");
        fs.writeFileSync(imageFilePath, buffer);
    }

    if (!imageFilePath || !fs.existsSync(imageFilePath)) {
        return { success: false, error: "No valid image provided" };
    }

    const importId = `IMP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const results = [];
    const timestamp = new Date().toISOString();

    for (const [fieldId, confirmedValue] of Object.entries(ground_truth)) {
        // Save as cell crop
        const cropPath = saveCellCrop({
            submission_id: `import_${importId}`,
            group_id: group_id || null,
            store_code: store_code,
            store_name: store_code,
            template_id: template_id || null,
            field_id: fieldId,
            item_name: fieldId,
            column: column || "default",
            raw_cell_image_path: imageFilePath,
            ocr_text: null,
            ocr_value: confirmedValue,
            ocr_confidence: null,
        });

        // Save as confirmed sample
        const sampleId = await saveConfirmedSample({
            submission_id: `import_${importId}`,
            employee_name: employee_name || null,
            employee_phone: employee_phone || null,
            group_id: group_id || null,
            store_code: store_code,
            template_id: template_id || null,
            field_id: fieldId,
            item_name: fieldId,
            column: column || "default",
            confirmed_value: confirmedValue,
            raw_ocr_value: null,
            raw_ocr_confidence: null,
            cell_image_path: imageFilePath,
            source_action: "MANUAL", // Training samples are manual imports
        });

        results.push({
            field_id: fieldId,
            confirmed_value: confirmedValue,
            sample_id: sampleId,
            crop_path: cropPath,
        });
    }

    logger.info("Sample imported", {
        import_id: importId,
        store_code,
        fields_count: results.length,
        employee_name,
    });

    return {
        success: true,
        import_id: importId,
        store_code,
        fields_imported: results.length,
        samples: results,
        created_at: timestamp,
    };
}

/**
 * Import a full form image with ground truth values
 * This crops all fields and creates confirmed samples
 */
async function importForm(payload) {
    const {
        store_code,
        template_id,
        employee_name,
        employee_phone,
        group_id,
        form_image_path,
        form_image_buffer,
        ground_truth, // { "SO-01": 30, "SO-02": 0, ... }
        column,
    } = payload;

    if (!store_code || !ground_truth) {
        return { success: false, error: "Missing store_code or ground_truth" };
    }

    // Save form image
    ensureDir(IMPORT_DIR);
    let imageFilePath = form_image_path;

    if (form_image_buffer) {
        const filename = `form_import_${store_code}_${Date.now()}.jpg`;
        imageFilePath = path.join(IMPORT_DIR, filename);
        const buffer = Buffer.isBuffer(form_image_buffer)
            ? form_image_buffer
            : Buffer.from(form_image_buffer, "base64");
        fs.writeFileSync(imageFilePath, buffer);
    }

    if (!imageFilePath || !fs.existsSync(imageFilePath)) {
        return { success: false, error: "No valid form image provided" };
    }

    // Import each field from the same image
    const result = await importSample({
        store_code,
        template_id,
        employee_name,
        employee_phone,
        group_id,
        source_image_path: imageFilePath,
        ground_truth,
        column,
    });

    return {
        ...result,
        form_image_path: imageFilePath,
    };
}

/**
 * Bulk import from a directory of sample images
 * Expects images named like: B2_SO-01_30.jpg (store_fieldid_value.jpg)
 * or a JSON manifest file
 */
async function importBulkFromDirectory(dirPath, manifestPath) {
    if (!fs.existsSync(dirPath)) {
        return { success: false, error: "Directory not found" };
    }

    // Check for manifest file
    if (manifestPath && fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        const results = [];

        for (const entry of manifest.samples || []) {
            const result = await importSample({
                store_code: entry.store_code,
                template_id: entry.template_id,
                employee_name: entry.employee_name,
                employee_phone: entry.employee_phone,
                group_id: entry.group_id,
                source_image_path: entry.image_path
                    ? path.resolve(dirPath, entry.image_path)
                    : undefined,
                source_image_buffer: entry.image_base64,
                ground_truth: entry.ground_truth,
                column: entry.column,
            });
            results.push(result);
        }

        return {
            success: true,
            imported: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            results,
        };
    }

    return { success: false, error: "No manifest file provided" };
}

module.exports = {
    importSample,
    importForm,
    importBulkFromDirectory,
    IMPORT_DIR,
};
