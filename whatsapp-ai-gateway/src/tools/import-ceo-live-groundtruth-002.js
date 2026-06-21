/**
 * Imports CEO_LIVE_GROUNDTRUTH_BATCH_002 from the two live CEO images.
 * Run with the gateway stopped: node src/tools/import-ceo-live-groundtruth-002.js
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const DB_PATH = path.join(PROJECT_ROOT, "data", "gateway.db");
const BATCH_NAME = "CEO_LIVE_GROUNDTRUTH_BATCH_002";
const BATCH_DIR = path.join(PROJECT_ROOT, "data", "handwriting", "ceo-live-batch-002");
const CROPS_DIR = path.join(BATCH_DIR, "crops");
const PROCESSED_DIR = path.join(BATCH_DIR, "processed");
const FORM_TEMPLATES = require("../formTemplates.json").templates;

let db = null;

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function initDb() {
    const initSqlJs = require("sql.js");
    const SQL = await initSqlJs();
    db = fs.existsSync(DB_PATH)
        ? new SQL.Database(fs.readFileSync(DB_PATH))
        : new SQL.Database();
}

function saveDb() {
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function run(sql, params = []) {
    db.run(sql, params);
}

function all(sql, params = []) {
    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
}

function one(sql, params = []) {
    return all(sql, params)[0] || null;
}

function lastId() {
    return one("SELECT last_insert_rowid() AS id").id;
}

function createTables() {
    run(`CREATE TABLE IF NOT EXISTS ceo_handwriting_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_name TEXT UNIQUE NOT NULL,
        source TEXT,
        created_by TEXT DEFAULT 'CEO',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'ACTIVE'
    )`);
    run(`CREATE TABLE IF NOT EXISTS ceo_handwriting_ground_truth (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL,
        image_label TEXT NOT NULL,
        image_message_id TEXT,
        image_path TEXT,
        chat_id TEXT,
        chat_name TEXT,
        store_code TEXT NOT NULL,
        store_name TEXT NOT NULL,
        template_id TEXT NOT NULL,
        field_id TEXT NOT NULL,
        field_label TEXT,
        column_label TEXT NOT NULL,
        confirmed_value REAL,
        value_state TEXT DEFAULT 'VALUE',
        range_min REAL,
        range_max REAL,
        manager_name TEXT,
        manager_phone TEXT,
        needs_review INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    run(`CREATE TABLE IF NOT EXISTS ceo_handwriting_cell_crops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ground_truth_id INTEGER NOT NULL,
        crop_path TEXT,
        processed_crop_path TEXT,
        fingerprint_hash TEXT,
        embedding_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    run(`CREATE TABLE IF NOT EXISTS ceo_runtime_prediction_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        submission_id TEXT,
        message_id TEXT,
        chat_id TEXT,
        chat_name TEXT,
        store_code TEXT,
        field_id TEXT,
        column_label TEXT,
        raw_ocr_value TEXT,
        raw_ocr_confidence REAL,
        memory_top_value REAL,
        memory_similarity REAL,
        range_min REAL,
        range_max REAL,
        final_value REAL,
        final_source TEXT,
        final_status TEXT,
        alert_allowed INTEGER,
        alert_block_reason TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    run(`CREATE TABLE IF NOT EXISTS handwriting_confirmed_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sample_id TEXT UNIQUE,
        submission_id TEXT,
        employee_name TEXT,
        employee_phone TEXT,
        group_id TEXT,
        store_code TEXT NOT NULL,
        template_id TEXT,
        field_id TEXT NOT NULL,
        item_name TEXT,
        column TEXT,
        confirmed_value TEXT NOT NULL,
        raw_ocr_value TEXT,
        raw_ocr_confidence REAL,
        cell_image_path TEXT,
        normalized_cell_image_path TEXT,
        fingerprint TEXT,
        source_action TEXT DEFAULT 'CONFIRM',
        created_at TEXT DEFAULT (datetime('now'))
    )`);
    run(`CREATE INDEX IF NOT EXISTS idx_ceo_gt_lookup ON ceo_handwriting_ground_truth(store_code, field_id, column_label, created_at DESC)`);
    run(`CREATE INDEX IF NOT EXISTS idx_hc_store_field ON handwriting_confirmed_samples(store_code, field_id)`);
}

const IMAGES = [
    {
        label: "IMAGE_A_B3_BANDERA",
        source: "B3 Kitchen Log / live Bandera CEO upload",
        preferredPath: path.join(PROJECT_ROOT, "data", "evidence", "evidence_1781918501314_93b89c46.jpg"),
        image_message_id: "false_120363426386364543@g.us_3A24A4B5BA1CEE86A0DF_172425924882645@lid",
        chat_id: "120363426386364543@g.us",
        chat_name: "LD Agent-Logtest",
        expected_chat_name: "B3 Kitchen Log",
        store_code: "B3",
        store_name: "Bandera",
        template_key: "bandera",
        template_id: "FoodSafety-Bandera-v3",
        manager: "Miles",
        manager_phone: "+12107712832",
        crop: { y0: 336, rowH: 22.7, h: 26, cols: { "10AM": [350, 436], "4PM": [452, 536] } },
        values_10am: {
            "BAN-01": 47, "BAN-02": -7, "BAN-03": null, "BAN-04": 98, "BAN-05": 43,
            "BAN-06": 40, "BAN-07": 10, "BAN-08": 109, "BAN-09": 103, "BAN-10": 105,
            "BAN-11": 41, "BAN-12": 31, "BAN-13": 31, "BAN-14": 42, "BAN-15": 33,
            "BAN-16": 353, "BAN-17": 357, "BAN-18": 200, "BAN-19": 210,
        },
        values_4pm: {
            "BAN-01": 42, "BAN-02": -7, "BAN-03": null, "BAN-04": 100, "BAN-05": 43,
            "BAN-06": 42, "BAN-07": 12, "BAN-08": 109, "BAN-09": 101, "BAN-10": 102,
            "BAN-11": 43, "BAN-12": 44, "BAN-13": 40, "BAN-14": 43, "BAN-15": 37,
            "BAN-16": 353, "BAN-17": 357, "BAN-18": 210, "BAN-19": 210,
        },
    },
    {
        label: "IMAGE_B_B2_STONE_OAK",
        source: "LD Agent-Logtest / live Stone Oak CEO upload",
        preferredPath: path.join(PROJECT_ROOT, "data", "evidence", "evidence_1781918504018_f4ce26d0.jpg"),
        image_message_id: "false_120363426386364543@g.us_3A6C0E7521B89E6765A5_172425924882645@lid",
        chat_id: "120363426386364543@g.us",
        chat_name: "LD Agent-Logtest",
        store_code: "B2",
        store_name: "Stone Oak",
        template_key: "stone_oak",
        template_id: "FoodSafety-StoneOak-v3",
        manager: "Edga",
        manager_phone: "+12109791918",
        crop: { y0: 301, rowH: 24.5, h: 28, cols: { "10AM": [306, 374], "4PM": [383, 456] } },
        values_10am: {
            "SO-01": 37, "SO-02": 0, "SO-03": 41, "SO-04": 104, "SO-05": 36,
            "SO-06": 33, "SO-07": null, "SO-08": 100, "SO-09": 100, "SO-10": 102,
            "SO-11": 37, "SO-12": 39, "SO-13": 40, "SO-14": 40, "SO-15": 39,
            "SO-16": 350, "SO-17": 350, "SO-18": 200, "SO-19": 210,
        },
        values_4pm: {
            "SO-01": 40, "SO-02": 1, "SO-03": 40, "SO-04": 102, "SO-05": 36,
            "SO-06": 38, "SO-07": null, "SO-08": 100, "SO-09": 101, "SO-10": 103,
            "SO-11": 33, "SO-12": 33, "SO-13": 38, "SO-14": 38, "SO-15": 39,
            "SO-16": 360, "SO-17": 350, "SO-18": 215, "SO-19": 210,
        },
    },
];

const PY_CROP = `
import json, sys, shutil
from PIL import Image, ImageOps
job=json.loads(sys.argv[1])
im=Image.open(job["src"])
w,h=im.size
x1,y1,x2,y2=job["box"]
x1=max(0,min(w,int(x1))); x2=max(0,min(w,int(x2)))
y1=max(0,min(h,int(y1))); y2=max(0,min(h,int(y2)))
crop=im.crop((x1,y1,x2,y2))
crop.save(job["crop"])
proc=ImageOps.grayscale(crop)
proc.save(job["processed"])
`;

function cropCell(src, dest, processed, box) {
    const result = spawnSync("python", ["-c", PY_CROP, JSON.stringify({ src, crop: dest, processed, box })], {
        encoding: "utf8",
    });
    if (result.status !== 0) {
        throw new Error(`crop failed: ${result.stderr || result.stdout}`);
    }
}

function fingerprint(filePath) {
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function templateItem(image, fieldId) {
    const template = FORM_TEMPLATES[image.template_key];
    return (template.items || []).find((item) => item.id === fieldId);
}

function cellBox(image, fieldId, columnLabel) {
    const index = Number(String(fieldId).slice(-2));
    const [x1, x2] = image.crop.cols[columnLabel];
    const y1 = image.crop.y0 + (index - 1) * image.crop.rowH;
    return [x1, y1, x2, y1 + image.crop.h];
}

function resolvedImagePath(image) {
    if (fs.existsSync(image.preferredPath)) return image.preferredPath;
    throw new Error(`Required image missing for ${image.label}: ${image.preferredPath}`);
}

async function main() {
    ensureDir(BATCH_DIR);
    ensureDir(CROPS_DIR);
    ensureDir(PROCESSED_DIR);
    await initDb();
    createTables();

    const existing = one("SELECT id FROM ceo_handwriting_batches WHERE batch_name = ?", [BATCH_NAME]);
    if (existing) {
        run("DELETE FROM ceo_handwriting_cell_crops WHERE ground_truth_id IN (SELECT id FROM ceo_handwriting_ground_truth WHERE batch_id = ?)", [existing.id]);
        run("DELETE FROM ceo_handwriting_ground_truth WHERE batch_id = ?", [existing.id]);
        run("DELETE FROM handwriting_confirmed_samples WHERE sample_id LIKE ?", ["CEO-BATCH002-%"]);
        run("DELETE FROM ceo_handwriting_batches WHERE id = ?", [existing.id]);
    }

    run("INSERT INTO ceo_handwriting_batches (batch_name, source, created_by, status) VALUES (?, ?, 'CEO', 'ACTIVE')", [
        BATCH_NAME,
        "Two live CEO images: B3 Bandera and B2 Stone Oak",
    ]);
    const batchId = lastId();

    let groundTruthRows = 0;
    let cropRows = 0;
    let sampleRows = 0;
    const imageResults = [];

    for (const image of IMAGES) {
        const srcPath = resolvedImagePath(image);
        const imageCopy = path.join(BATCH_DIR, `${image.label}${path.extname(srcPath)}`);
        fs.copyFileSync(srcPath, imageCopy);
        imageResults.push({ label: image.label, image_path: imageCopy, original_path: srcPath, message_id: image.image_message_id });

        const columns = [
            ["10AM", image.values_10am],
            ["4PM", image.values_4pm],
        ];

        for (const [columnLabel, values] of columns) {
            for (const fieldId of Object.keys(values)) {
                const item = templateItem(image, fieldId);
                const value = values[fieldId];
                const valueState = value === null || value === undefined ? "MISSING" : "VALUE";
                run(
                    `INSERT INTO ceo_handwriting_ground_truth
                       (batch_id, image_label, image_message_id, image_path, chat_id, chat_name,
                        store_code, store_name, template_id, field_id, field_label, column_label,
                        confirmed_value, value_state, range_min, range_max, manager_name, manager_phone, needs_review)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
                    [
                        batchId, image.label, image.image_message_id, imageCopy, image.chat_id, image.chat_name,
                        image.store_code, image.store_name, image.template_id, fieldId, item.label, columnLabel,
                        value, valueState, item.safeRange.min, item.safeRange.max, image.manager, image.manager_phone,
                    ]
                );
                const groundTruthId = lastId();
                groundTruthRows++;

                const safeName = `${image.label}_${fieldId}_${columnLabel}`;
                const cropPath = path.join(CROPS_DIR, `${safeName}.png`);
                const processedPath = path.join(PROCESSED_DIR, `${safeName}_processed.png`);
                cropCell(imageCopy, cropPath, processedPath, cellBox(image, fieldId, columnLabel));
                const fp = fingerprint(processedPath);

                run(
                    `INSERT INTO ceo_handwriting_cell_crops
                       (ground_truth_id, crop_path, processed_crop_path, fingerprint_hash, embedding_json)
                     VALUES (?, ?, ?, ?, ?)`,
                    [groundTruthId, cropPath, processedPath, fp, null]
                );
                cropRows++;

                run(
                    `INSERT OR REPLACE INTO handwriting_confirmed_samples
                       (sample_id, submission_id, employee_name, employee_phone, group_id, store_code, template_id,
                        field_id, item_name, column, confirmed_value, raw_ocr_value, raw_ocr_confidence,
                        cell_image_path, normalized_cell_image_path, fingerprint, source_action, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
                    [
                        `CEO-BATCH002-${image.store_code}-${fieldId}-${columnLabel}`,
                        BATCH_NAME,
                        "CEO",
                        null,
                        image.chat_id,
                        image.store_code,
                        image.template_id,
                        fieldId,
                        item.label,
                        columnLabel,
                        valueState === "MISSING" ? "MISSING" : String(value),
                        null,
                        null,
                        cropPath,
                        processedPath,
                        fp,
                        valueState === "MISSING" ? "CEO_GROUND_TRUTH_MISSING" : "CEO_GROUND_TRUTH",
                    ]
                );
                sampleRows++;
            }
        }
    }

    saveDb();
    const summary = {
        batch_name: BATCH_NAME,
        batch_id: batchId,
        images: imageResults,
        ground_truth_rows: groundTruthRows,
        cell_crop_rows: cropRows,
        confirmed_runtime_samples: sampleRows,
        status: groundTruthRows >= 76 && cropRows >= 76 && sampleRows >= 76 ? "PASS" : "FAIL",
    };
    console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
});
