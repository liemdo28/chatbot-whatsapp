/**
 * ceo-batch-import.js — CEO Handwriting Sample Batch 001 Import Script
 * Imports 4 CEO handwriting images as ground-truth training samples.
 * Run: node src/tools/ceo-batch-import.js
 */

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const EVIDENCE_DIR = path.join(PROJECT_ROOT, "data", "evidence");
const BATCH_DIR = path.join(PROJECT_ROOT, "data", "handwriting", "ceo-batch-001");
const SAMPLES_BASE = path.join(PROJECT_ROOT, "data", "handwriting", "samples");
const CROPS_BASE = path.join(PROJECT_ROOT, "data", "handwriting", "crops");
const DB_PATH = path.join(PROJECT_ROOT, "data", "gateway.db");

// ─── Init sql.js DB ─────────────────────────────────────────────────────────
let db = null;
async function initDb() {
    const initSqlJs = require("sql.js");
    const SQL = await initSqlJs();
    if (fs.existsSync(DB_PATH)) {
        const buf = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buf);
    } else {
        db = new SQL.Database();
    }
    return db;
}
function saveDb() {
    if (!db) return;
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
}
function run(sql, params) {
    if (!db) return;
    db.run(sql, params || []);
}
function getAll(sql, params) {
    if (!db) return [];
    const stmt = db.prepare(sql);
    if (params) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
}
function getOne(sql, params) {
    const rows = getAll(sql, params);
    return rows[0] || null;
}
function insertId() {
    const r = getOne("SELECT last_insert_rowid() as id");
    return r ? r.id : 0;
}

// ─── Ensure directories ───────────────────────────────────────────────────────
function ensureDir(d) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ─── Ground Truth Definitions ────────────────────────────────────────────────

const BATCH_NAME = "CEO_HANDWRITING_SAMPLE_BATCH_001";
const SOURCE_GROUP = "LD Agent-Logtest";

// The 4 CEO images in upload order (first 4 of the 8 evidence_1781865191xxx files)
const CEO_IMAGES = [
    {
        image_order: 1,
        message_id: "evidence_1781865191704_17c8e77e",
        filename: "evidence_1781865191704_17c8e77e.jpg",
        store_code: "B3",
        store_name: "Bandera",
        template_family: "legacy_bandera_road_line_check",
        legacy_form: "BANDERA ROAD - LINE CHECK",
        description: "Bandera Road multi-day form — handwriting sample only",
        columns: {
            MON: {
                FREEZER_PHOTO: -7, WALK_IN_COOLER_PHOTO: 40, BOWL_WARMERS: 104,
                RAMEN_TOP: 40, RAMEN_BELOW: 41, FREEZER_LINE: 10,
                PORK_CHASHU: 103, SEASONED_EGG_PHOTO: 103,
                TAPAS_TOP: 41, TAPAS_BELOW: 41, TAPAS_SIDE_FRIED: 36,
                FRYER_LEFT_PHOTO: 363, FRYER_RIGHT_PHOTO: 365,
                PORK_BROTH: 200, CHICKEN_BROTH: 200,
                PASTA_BOILER_LEFT: 210, PASTA_BOILER_RIGHT: 211
            },
            TUES: {
                FREEZER_PHOTO: -3, WALK_IN_COOLER_PHOTO: 40, BOWL_WARMERS: 88,
                RAMEN_TOP: 40, RAMEN_BELOW: 40, FREEZER_LINE: 10,
                PORK_CHASHU: 104, SEASONED_EGG_PHOTO: 100,
                TAPAS_TOP: 40, TAPAS_BELOW: 40, TAPAS_SIDE_FRIED: 36,
                FRYER_LEFT_PHOTO: 356, FRYER_RIGHT_PHOTO: 360,
                PORK_BROTH: 200, CHICKEN_BROTH: 200,
                PASTA_BOILER_LEFT: 211
            },
            WED: {
                FREEZER_PHOTO: -7, WALK_IN_COOLER_PHOTO: 40, BOWL_WARMERS: 102,
                RAMEN_TOP: 40, RAMEN_BELOW: 38, FREEZER_LINE: 10,
                PORK_CHASHU: 100, SEASONED_EGG_PHOTO: 101,
                TAPAS_TOP: 39, TAPAS_BELOW: 40, TAPAS_SIDE_FRIED: 36,
                FRYER_LEFT_PHOTO: 361, FRYER_RIGHT_PHOTO: 358,
                PORK_BROTH: 200, CHICKEN_BROTH: 200,
                PASTA_BOILER_LEFT: 211
            }
        },
        needs_review: false
    },
    {
        image_order: 2,
        message_id: "evidence_1781865191707_44978794",
        filename: "evidence_1781865191707_44978794.jpg",
        store_code: "B2",
        store_name: "Stone Oak",
        template_family: "legacy_stone_oak_line_check",
        legacy_form: "STONE OAK LINE CHECK",
        description: "Stone Oak close-up",
        column: "11:00 AM",
        values: [40, 0, 40, 34, 41, 0, 35, 36, 37, 37, 334, 330, 200, 200, 100, 200, 200],
        needs_review: false
    },
    {
        image_order: 3,
        message_id: "evidence_1781865191710_5420b270",
        filename: "evidence_1781865191710_5420b270.jpg",
        store_code: "B2",
        store_name: "Stone Oak",
        template_family: "legacy_stone_oak_line_check",
        legacy_form: "LEGACY LINE CHECK",
        description: "Legacy line check close-up — handwriting sample only",
        column: "AM",
        values: [40, 40, 40, 0, 40, 40, 348, 331, 200, 200, 150, 45, 100, 200, 200, 200],
        needs_review: true
    },
    {
        image_order: 4,
        message_id: "evidence_1781865191714_aa430f11",
        filename: "evidence_1781865191714_aa430f11.jpg",
        store_code: "B3",
        store_name: "Bandera",
        template_family: "legacy_bandera_road_line_check",
        legacy_form: "BANDERA ROAD - LINE CHECK",
        description: "Bandera Road clear full form",
        columns: {
            MON: {
                FREEZER_PHOTO: -7, WALK_IN_COOLER_PHOTO: 40, BOWL_WARMERS: 104,
                RAMEN_TOP: 40, RAMEN_BELOW: 41, FREEZER_LINE: 10,
                PORK_CHASHU: 103, SEASONED_EGG_PHOTO: 103,
                TAPAS_TOP: 41, TAPAS_BELOW: 41, TAPAS_SIDE_FRIED: 36,
                FRYER_LEFT_PHOTO: 363, FRYER_RIGHT_PHOTO: 365,
                PORK_BROTH: 200, CHICKEN_BROTH: 200,
                PASTA_BOILER_LEFT: 210, PASTA_BOILER_RIGHT: 211
            },
            TUES: {
                FREEZER_PHOTO: -3, WALK_IN_COOLER_PHOTO: 40, BOWL_WARMERS: 88,
                RAMEN_TOP: 40, RAMEN_BELOW: 40, FREEZER_LINE: 10,
                PORK_CHASHU: 104, SEASONED_EGG_PHOTO: 100,
                TAPAS_TOP: 40, TAPAS_BELOW: 40, TAPAS_SIDE_FRIED: 36,
                FRYER_LEFT_PHOTO: 356, FRYER_RIGHT_PHOTO: 360,
                PORK_BROTH: 200, CHICKEN_BROTH: 200,
                PASTA_BOILER_LEFT: 211
            },
            WED: {
                FREEZER_PHOTO: -7, WALK_IN_COOLER_PHOTO: 40, BOWL_WARMERS: 102,
                RAMEN_TOP: 40, RAMEN_BELOW: 38, FREEZER_LINE: 10,
                PORK_CHASHU: 100, SEASONED_EGG_PHOTO: 101,
                TAPAS_TOP: 39, TAPAS_BELOW: 40, TAPAS_SIDE_FRIED: 36,
                FRYER_LEFT_PHOTO: 361, FRYER_RIGHT_PHOTO: 358,
                PORK_BROTH: 200, CHICKEN_BROTH: 200,
                PASTA_BOILER_LEFT: 211
            }
        },
        needs_review: false
    }
];

// ─── Create DB Tables ────────────────────────────────────────────────────────

function createTables() {
    // Batch record table
    run(`
        CREATE TABLE IF NOT EXISTS handwriting_training_batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_name TEXT NOT NULL UNIQUE,
            source_group_name TEXT,
            source_group_id TEXT,
            purpose TEXT,
            created_by TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'IMPORTED',
            notes TEXT
        )
    `);

    // Ground truth table
    run(`
        CREATE TABLE IF NOT EXISTS handwriting_ground_truth (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_id INTEGER,
            image_order INTEGER,
            image_message_id TEXT,
            image_filename TEXT,
            image_path TEXT,
            store_code TEXT,
            store_name TEXT,
            template_family TEXT,
            field_key TEXT,
            field_label TEXT,
            column_label TEXT,
            day_label TEXT,
            confirmed_value REAL,
            value_type TEXT DEFAULT 'temperature',
            confidence_label TEXT DEFAULT 'CEO_GROUND_TRUTH',
            needs_review INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Cell samples table (enhanced version)
    run(`
        CREATE TABLE IF NOT EXISTS handwriting_cell_samples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ground_truth_id INTEGER,
            batch_id INTEGER,
            crop_path TEXT,
            processed_crop_path TEXT,
            fingerprint_hash TEXT,
            embedding_json TEXT,
            confirmed_value REAL,
            store_code TEXT,
            template_family TEXT,
            field_key TEXT,
            column_label TEXT,
            day_label TEXT,
            image_filename TEXT,
            needs_review INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Create indexes
    run(`CREATE INDEX IF NOT EXISTS idx_gt_batch ON handwriting_ground_truth(batch_id)`);
    run(`CREATE INDEX IF NOT EXISTS idx_gt_store ON handwriting_ground_truth(store_code)`);
    run(`CREATE INDEX IF NOT EXISTS idx_gt_field ON handwriting_ground_truth(store_code, field_key)`);
    run(`CREATE INDEX IF NOT EXISTS idx_gt_review ON handwriting_ground_truth(needs_review)`);
    run(`CREATE INDEX IF NOT EXISTS idx_cs_batch ON handwriting_cell_samples(batch_id)`);
    run(`CREATE INDEX IF NOT EXISTS idx_cs_store_field ON handwriting_cell_samples(store_code, field_key)`);
    run(`CREATE INDEX IF NOT EXISTS idx_cs_fingerprint ON handwriting_cell_samples(fingerprint_hash)`);

    saveDb();
    console.log("[OK] Database tables created/verified");
}

// ─── Generate Fingerprint (file hash fallback) ───────────────────────────────
function generateFingerprint(filePath) {
    try {
        const buf = fs.readFileSync(filePath);
        const hash = crypto.createHash("sha256").update(buf).digest("hex");
        return hash.substring(0, 32);
    } catch {
        return "FALLBACK_" + Date.now();
    }
}
const crypto = require("crypto");

// ─── Save Image to Batch Directory ──────────────────────────────────────────
function copyImageToBatch(srcFilename) {
    const src = path.join(EVIDENCE_DIR, srcFilename);
    if (!fs.existsSync(src)) {
        console.warn("[WARN] Source image not found:", src);
        return null;
    }
    ensureDir(BATCH_DIR);
    const dst = path.join(BATCH_DIR, srcFilename);
    fs.copyFileSync(src, dst);
    return dst;
}

// ─── Save Cell Crop ──────────────────────────────────────────────────────────
function saveCrop(groundTruthId, batchId, imageFilename, storeCode, templateFamily, fieldKey, columnLabel, dayLabel, confirmedValue, needsReview) {
    const cropDir = path.join(CROPS_BASE, storeCode, "ceo-batch-001");
    ensureDir(cropDir);
    const safeField = fieldKey.replace(/[^a-zA-Z0-9_]/g, "_");
    const safeCol = (columnLabel || dayLabel || "default").replace(/[^a-zA-Z0-9_]/g, "_");
    const cropFilename = `crop_${safeField}_${safeCol}_${Date.now()}.jpg`;
    const cropPath = path.join(cropDir, cropFilename);

    // Copy from batch image as placeholder crop (in production would crop cell region)
    const srcImage = path.join(BATCH_DIR, imageFilename);
    if (fs.existsSync(srcImage)) {
        fs.copyFileSync(srcImage, cropPath);
    }

    const fingerprint = generateFingerprint(srcImage);

    const procPath = cropPath.replace(".jpg", "_proc.jpg");
    if (fs.existsSync(cropPath)) fs.copyFileSync(cropPath, procPath);

    run(
        `INSERT INTO handwriting_cell_samples
            (ground_truth_id, batch_id, crop_path, processed_crop_path, fingerprint_hash,
             confirmed_value, store_code, template_family, field_key, column_label,
             day_label, image_filename, needs_review)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [groundTruthId, batchId, cropPath, procPath, fingerprint,
            confirmedValue, storeCode, templateFamily, fieldKey, columnLabel,
            dayLabel, imageFilename, needsReview ? 1 : 0]
