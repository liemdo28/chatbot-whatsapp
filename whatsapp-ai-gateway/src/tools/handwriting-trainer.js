/**
 * handwriting-trainer.js — Phase 9: CEO Training Tool
 *
 * Import CEO-provided images with ground truth values.
 *
 * Usage:
 *   node src/tools/handwriting-trainer.js --batch CEO_BATCH_003 --store B2 --image path/to/image.jpg --column 4PM --values values.json
 *
 * The tool must:
 *   - align form
 *   - crop cells
 *   - save ground truth
 *   - save crop images
 *   - update memory index
 *   - verify values can be retrieved by prediction engine
 */

const fs = require("fs");
const path = require("path");
const logger = require("../logger");

const DB_PATH = path.join(__dirname, "..", "..", "data", "gateway.db");
const CROPS_BASE = path.join(__dirname, "..", "..", "data", "handwriting", "crops");
const GROUND_TRUTH_BASE = path.join(__dirname, "..", "..", "data", "handwriting", "ground-truth");

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Parse CLI arguments into options object.
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {};
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case "--batch": opts.batchName = args[++i]; break;
            case "--store": opts.storeCode = args[++i]; break;
            case "--image": opts.imagePath = args[++i]; break;
            case "--column": opts.column = args[++i]; break;
            case "--values": opts.valuesFile = args[++i]; break;
            case "--writer": opts.writerName = args[++i]; break;
            case "--template": opts.templateId = args[++i]; break;
            default: break;
        }
    }
    return opts;
}

/**
 * Store code to template ID mapping.
 */
const STORE_TEMPLATE = {
    B1: "FoodSafety-Rim-v3",
    B2: "FoodSafety-StoneOak-v3",
    B3: "FoodSafety-Bandera-v3",
};

const STORE_PREFIX = { B1: "RIM", B2: "SO", B3: "BAN" };
const STORE_NAME = { B1: "The Rim", B2: "Stone Oak", B3: "Bandera" };

/**
 * Load values from a JSON file.
 */
function loadValues(valuesFile) {
    if (!valuesFile) {
        console.error("--values <path> is required");
        process.exit(1);
    }
    const absPath = path.resolve(valuesFile);
    if (!fs.existsSync(absPath)) {
        console.error(`Values file not found: ${absPath}`);
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(absPath, "utf-8"));
}

/**
 * Save ground truth records and crop references to database.
 */
async function importTrainingBatch(db, opts) {
    const {
        batchName,
        storeCode,
        imagePath,
        column,
        values,
        writerName,
        templateId,
    } = opts;

    const resolvedTemplate = templateId || STORE_TEMPLATE[storeCode] || "FoodSafety-StoneOak-v3";
    const prefix = STORE_PREFIX[storeCode] || "SO";
    const storeName = STORE_NAME[storeCode] || "Unknown";

    console.log(`\n=== CEO Training Import ===`);
    console.log(`Batch:    ${batchName}`);
    console.log(`Store:    ${storeName} / ${storeCode}`);
    console.log(`Template: ${resolvedTemplate}`);
    console.log(`Column:   ${column}`);
    console.log(`Image:    ${imagePath}`);
    console.log(`Values:   ${Object.keys(values).length} fields`);
    console.log();

    // Create batch
    try {
        db.run(
            `INSERT OR IGNORE INTO ceo_handwriting_batches (batch_name, source, created_by)
             VALUES (?, 'CEO_IMPORT', 'CEO')`,
            [batchName]
        );
    } catch (e) {
        console.warn(`Batch ${batchName} may already exist: ${e.message}`);
    }

    const batchRow = db.getOne(
        `SELECT id FROM ceo_handwriting_batches WHERE batch_name = ?`,
        [batchName]
    );
    const batchId = batchRow ? batchRow.id : 0;

    // Set up crop output directory
    const cropDir = path.join(CROPS_BASE, storeCode, batchName);
    ensureDir(cropDir);

    let importCount = 0;
    let verifiedCount = 0;

    // Get image path for crop storage
    const imageAbsPath = imagePath ? path.resolve(imagePath) : null;

    for (const [fieldId, value] of Object.entries(values)) {
        const valueState = (value === null || value === undefined || value === "" || value === "null") ? "MISSING" : "VALUE";
        const confirmedValue = valueState === "MISSING" ? null : Number(value);

        // Range from template
        const range = getRangeForField(resolvedTemplate, fieldId);

        // Insert ground truth
        db.run(
            `INSERT INTO ceo_handwriting_ground_truth
               (batch_id, image_label, image_path, store_code, store_name,
                template_id, field_id, field_label, column_label,
                confirmed_value, value_state, range_min, range_max, manager_name, manager_phone)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                batchId,
                `${fieldId}_${column}`,
                imageAbsPath || null,
                storeCode,
                storeName,
                resolvedTemplate,
                fieldId,
                getFieldLabel(resolvedTemplate, fieldId),
                column,
                confirmedValue,
                valueState,
                range.min,
                range.max,
                getManagerName(storeCode),
                getManagerPhone(storeCode),
            ]
        );
        importCount++;

        // Create crop reference (even without actual crop image)
        const gtRow = db.getOne(
            `SELECT id FROM ceo_handwriting_ground_truth
             WHERE batch_id = ? AND field_id = ? AND column_label = ?
             ORDER BY id DESC LIMIT 1`,
            [batchId, fieldId, column]
        );
        if (gtRow) {
            const cropPath = path.join(cropDir, `${fieldId}_${column}.png`);
            db.run(
                `INSERT INTO ceo_handwriting_cell_crops
                   (ground_truth_id, crop_path)
                 VALUES (?, ?)`,
                [gtRow.id, cropPath]
            );
        }
    }

    db.saveDb();

    // Verify: try to look up each value through the decision engine
    try {
        const { getCeoGroundTruth } = require("../foodSafetyDecisionEngine");
        for (const [fieldId, value] of Object.entries(values)) {
            if (value === null || value === undefined) continue;
            const lookup = getCeoGroundTruth(storeCode, fieldId, column);
            if (lookup && lookup.confirmed_value == value) {
                verifiedCount++;
            }
        }
    } catch (e) {
        console.warn(`Verification step skipped: ${e.message}`);
    }

    console.log(`\n=== Results ===`);
    console.log(`Imported: ${importCount} ground truth records`);
    console.log(`Verified: ${verifiedCount}/${Object.keys(values).length} retrievable by prediction engine`);
    console.log(`Batch:    ${batchName}`);
    console.log();

    return { importCount, verifiedCount };
}

function getRangeForField(templateId, fieldId) {
    try {
        const templates = require("../formTemplates.json");
        for (const [, t] of Object.entries(templates.templates)) {
            if (t.template_id === templateId) {
                const item = t.items.find(i => i.id === fieldId);
                if (item) return item.safeRange;
            }
        }
    } catch (_) { }
    return { min: -20, max: 450 };
}

function getFieldLabel(templateId, fieldId) {
    try {
        const templates = require("../formTemplates.json");
        for (const [, t] of Object.entries(templates.templates)) {
            if (t.template_id === templateId) {
                const item = t.items.find(i => i.id === fieldId);
                if (item) return item.label;
            }
        }
    } catch (_) { }
    return fieldId;
}

function getManagerName(storeCode) {
    return { B1: "David", B2: "Edga", B3: "Miles" }[storeCode] || "Unknown";
}

function getManagerPhone(storeCode) {
    return { B1: "12106853184", B2: "12109791918", B3: "12107712832" }[storeCode] || "";
}

async function main() {
    const opts = parseArgs();
    if (!opts.batchName || !opts.storeCode) {
        console.log("Usage: node src/tools/handwriting-trainer.js --batch BATCH_NAME --store B2 --column 4PM --values values.json [--image path]");
        process.exit(1);
    }

    const values = loadValues(opts.valuesFile);
    opts.values = values;

    // Initialize DB
    const db = require("../database");
    await db.getDb();

    await importTrainingBatch(db, opts);
}

if (require.main === module) {
    main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { importTrainingBatch, parseArgs, loadValues };
