/**
 * dbSchema.js — Handwriting Memory Database Schema
 * 
 * Creates all required tables for the handwriting memory system.
 */

const logger = require("../logger");
const db = require("../database");

/**
 * Initialize all handwriting memory tables
 */
function initHandwritingTables() {
    // Phase 1: Cell Crop Storage
    db.run(`
        CREATE TABLE IF NOT EXISTS handwriting_cell_crops (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            submission_id TEXT,
            group_id TEXT,
            store_code TEXT NOT NULL,
            store_name TEXT,
            template_id TEXT,
            field_id TEXT NOT NULL,
            item_name TEXT,
            column TEXT,
            raw_cell_image_path TEXT,
            processed_cell_image_path TEXT,
            ocr_text TEXT,
            ocr_value TEXT,
            ocr_confidence REAL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);

    // Phase 2: Confirmed Handwriting Samples
    db.run(`
        CREATE TABLE IF NOT EXISTS handwriting_confirmed_samples (
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
        )
    `);

    // Prediction audit log
    db.run(`
        CREATE TABLE IF NOT EXISTS handwriting_predictions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            submission_id INTEGER,
            field_id TEXT,
            store_code TEXT,
            ocr_value TEXT,
            ocr_confidence REAL,
            memory_match_count INTEGER DEFAULT 0,
            predicted_value TEXT,
            prediction_source TEXT,
            prediction_confidence REAL,
            needs_confirmation INTEGER DEFAULT 1,
            final_confirmed_value TEXT,
            final_source TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            confirmed_at TEXT
        )
    `);

    // Accuracy tracking
    db.run(`
        CREATE TABLE IF NOT EXISTS handwriting_accuracy_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            submission_id INTEGER,
            store_code TEXT,
            field_id TEXT,
            ocr_value TEXT,
            predicted_value TEXT,
            confirmed_value TEXT,
            ocr_correct INTEGER DEFAULT 0,
            prediction_correct INTEGER DEFAULT 0,
            prediction_source TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS ceo_handwriting_batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_name TEXT UNIQUE NOT NULL,
            source TEXT,
            created_by TEXT DEFAULT 'CEO',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'ACTIVE'
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS ceo_handwriting_ground_truth (
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
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS ceo_handwriting_cell_crops (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ground_truth_id INTEGER NOT NULL,
            crop_path TEXT,
            processed_crop_path TEXT,
            fingerprint_hash TEXT,
            embedding_json TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS ceo_runtime_prediction_audit (
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
        )
    `);

    // Create indexes for fast lookups
    try {
        db.run(`CREATE INDEX IF NOT EXISTS idx_hc_store_field ON handwriting_confirmed_samples(store_code, field_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_hc_employee ON handwriting_confirmed_samples(employee_name, store_code)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_hc_fingerprint ON handwriting_confirmed_samples(fingerprint)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_hc_created ON handwriting_confirmed_samples(created_at DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_cc_submission ON handwriting_cell_crops(submission_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_hp_submission ON handwriting_predictions(submission_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_ceo_gt_lookup ON ceo_handwriting_ground_truth(store_code, field_id, column_label, created_at DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_ceo_audit_submission ON ceo_runtime_prediction_audit(submission_id)`);
    } catch (err) {
        logger.warn("Index creation warning (non-fatal)", { error: err.message });
    }

    db.saveDb();
    logger.info("Handwriting memory tables initialized");
}

module.exports = { initHandwritingTables };
