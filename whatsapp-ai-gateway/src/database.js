const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");
const logger = require("./logger");

const DB_PATH = process.env.GATEWAY_DB_PATH || path.join(__dirname, "..", "data", "gateway.db");

let db = null;
let dbReady = null;

async function getDb() {
  if (db) return db;
  if (dbReady) return dbReady;

  dbReady = (async () => {
    const SQL = await initSqlJs();
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const createFreshDb = (reason) => {
      if (fs.existsSync(DB_PATH)) {
        const backupPath = `${DB_PATH}.corrupt-${Date.now()}`;
        fs.renameSync(DB_PATH, backupPath);
        logger.warn("Invalid database moved aside; creating fresh database", { path: DB_PATH, backupPath, reason });
      }
      db = new SQL.Database();
    };

    if (fs.existsSync(DB_PATH)) {
      try {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
        db.run("PRAGMA schema_version");
      } catch (err) {
        createFreshDb(err.message);
      }
    } else {
      db = new SQL.Database();
    }

    try {
      initTables();
    } catch (err) {
      createFreshDb(err.message);
      initTables();
    }
    saveDb();
    logger.info("Database initialized", { path: DB_PATH });
    return db;
  })();

  return dbReady;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Auto-save periodically without keeping test/CLI processes alive.
const autosaveTimer = setInterval(() => { saveDb(); }, 5000);
if (autosaveTimer.unref) autosaveTimer.unref();

function initTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_number TEXT,
      status TEXT DEFAULT 'DISCONNECTED',
      last_activity TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS food_safety_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_name TEXT NOT NULL DEFAULT 'StoneOak',
      phone_number TEXT,
      employee_name TEXT,
      message_id TEXT,
      trace_id TEXT,
      image_path TEXT,
      ocr_raw_text TEXT,
      ocr_json TEXT,
      ocr_confidence REAL,
      detected_items TEXT,
      status TEXT DEFAULT 'PENDING',
      language TEXT DEFAULT 'ES',
      manager_review TEXT,
      google_sheet_synced INTEGER DEFAULT 0,
      google_sheet_sync_error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  try { db.run(`ALTER TABLE food_safety_submissions ADD COLUMN trace_id TEXT`); } catch (_) { /* already exists */ }
  db.run(`
    CREATE TABLE IF NOT EXISTS food_safety_edits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER,
      edit_command TEXT,
      field_index INTEGER,
      old_value TEXT,
      new_value TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS message_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_number TEXT,
      direction TEXT,
      content TEXT,
      message_type TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS missing_submission_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id TEXT NOT NULL,
      store_name TEXT NOT NULL,
      label TEXT NOT NULL,
      deadline TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      alert_message_es TEXT,
      alert_message_en TEXT,
      sent_to_group INTEGER DEFAULT 0,
      sent_to_manager INTEGER DEFAULT 0,
      sent_to_admin INTEGER DEFAULT 0,
      suppressed INTEGER DEFAULT 0,
      suppress_reason TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS ceo_handwriting_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_name TEXT UNIQUE NOT NULL,
      source TEXT,
      created_by TEXT DEFAULT 'CEO',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'ACTIVE'
    );
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
    );
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
    );
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
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ceo_gt_lookup ON ceo_handwriting_ground_truth(store_code, field_id, column_label, created_at DESC);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ceo_audit_submission ON ceo_runtime_prediction_audit(submission_id);`);

  // Hybrid runtime trace proof tables
  db.run(`
    CREATE TABLE IF NOT EXISTS pipeline_trace_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id TEXT NOT NULL,
      submission_id TEXT,
      chat_id TEXT,
      chat_name TEXT,
      sender TEXT,
      image_id TEXT,
      step TEXT NOT NULL,
      status TEXT NOT NULL,
      input_summary TEXT,
      output_summary TEXT,
      duration_ms INTEGER,
      error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id TEXT,
      submission_id TEXT,
      event_type TEXT,
      step TEXT,
      status TEXT,
      chat_id TEXT,
      chat_name TEXT,
      payload_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS decision_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id TEXT,
      submission_id TEXT,
      step TEXT,
      status TEXT,
      decision_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS pilot_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id TEXT,
      submission_id TEXT,
      metric_name TEXT,
      metric_value TEXT,
      payload_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pipeline_trace_id ON pipeline_trace_events(trace_id, id);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_events_trace ON audit_events(trace_id, id);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_decision_audit_trace ON decision_audit(trace_id, id);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pilot_metrics_trace ON pilot_metrics(trace_id, id);`);

  // ─── Production Pipeline Tables ──────────────────────────────────────

  // Handwriting forms: one row per uploaded form image
  db.run(`
    CREATE TABLE IF NOT EXISTS handwriting_forms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id TEXT,
      message_id TEXT,
      chat_id TEXT,
      chat_name TEXT,
      store_code TEXT,
      store_name TEXT,
      template_id TEXT,
      detected_writer TEXT,
      selected_column TEXT,
      image_path TEXT,
      image_quality_score REAL,
      image_quality_decision TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Cell-level handwriting dataset
  db.run(`
    CREATE TABLE IF NOT EXISTS handwriting_cell_dataset (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form_id INTEGER,
      submission_id TEXT,
      store_code TEXT,
      store_name TEXT,
      template_id TEXT,
      field_id TEXT,
      field_label TEXT,
      column_label TEXT,
      writer_name TEXT,
      confirmed_value REAL,
      value_state TEXT DEFAULT 'VALUE',
      range_min REAL,
      range_max REAL,
      crop_path TEXT,
      processed_crop_path TEXT,
      crop_quality_score REAL,
      fingerprint_hash TEXT,
      embedding_json TEXT,
      source TEXT DEFAULT 'LIVE_CONFIRMED',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Writer profiles
  db.run(`
    CREATE TABLE IF NOT EXISTS handwriting_writer_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      writer_name TEXT,
      store_code TEXT,
      sample_count INTEGER DEFAULT 0,
      common_misreads_json TEXT,
      last_seen_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(writer_name, store_code)
    )
  `);

  // Production prediction audit (enhanced version)
  db.run(`
    CREATE TABLE IF NOT EXISTS food_safety_decision_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id TEXT,
      message_id TEXT,
      store_code TEXT,
      template_id TEXT,
      field_id TEXT,
      column_label TEXT,
      raw_ocr_value TEXT,
      raw_ocr_confidence REAL,
      memory_value REAL,
      memory_similarity REAL,
      writer_memory_value REAL,
      writer_similarity REAL,
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

  // Processing dedup lock (one image = one reply)
  db.run(`
    CREATE TABLE IF NOT EXISTS food_safety_processing_lock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_hash TEXT,
      chat_id TEXT,
      message_id TEXT,
      submission_id INTEGER,
      status TEXT DEFAULT 'PROCESSING',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(media_hash, chat_id)
    )
  `);

  // Create indexes for new tables
  try {
    db.run(`CREATE INDEX IF NOT EXISTS idx_hf_store ON handwriting_forms(store_code, created_at DESC)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_hcd_store_field ON handwriting_cell_dataset(store_code, field_id, column_label)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_hwp_writer ON handwriting_writer_profiles(writer_name, store_code)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_fsda_submission ON food_safety_decision_audit(submission_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_fspl_hash ON food_safety_processing_lock(media_hash, chat_id)`);
  } catch (err) {
    // Indexes may already exist
  }
}

function getAll(sql, params = []) {
  if (!db) return [];
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function getOne(sql, params = []) {
  const rows = getAll(sql, params);
  return rows.length > 0 ? rows[0] : undefined;
}

function run(sql, params = []) {
  if (!db) return;
  db.run(sql, params);
}

function insertSubmission(data) {
  db.run(
    `INSERT INTO food_safety_submissions
       (store_name, phone_number, employee_name, message_id, trace_id, image_path, ocr_raw_text, ocr_json, ocr_confidence, detected_items, status, language)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.store_name, data.phone_number, data.employee_name,
      data.message_id, data.trace_id || null, data.image_path, data.ocr_raw_text,
      data.ocr_json, data.ocr_confidence, data.detected_items,
      data.status, data.language,
    ]
  );
  const rows = getAll("SELECT last_insert_rowid() as id");
  const id = rows.length > 0 ? rows[0].id : 0;
  saveDb();
  logger.info("Submission inserted", { id, store: data.store_name });
  return id;
}

function updateSubmissionStatus(id, status) {
  run(`UPDATE food_safety_submissions SET status = ?, updated_at = datetime('now') WHERE id = ?`, [status, id]);
  saveDb();
}

function updateSubmissionOcr(id, data) {
  run(
    `UPDATE food_safety_submissions
       SET store_name = ?,
           ocr_raw_text = ?,
           ocr_json = ?,
           ocr_confidence = ?,
           detected_items = ?,
           status = ?,
           updated_at = datetime('now')
     WHERE id = ?`,
    [
      data.store_name,
      data.ocr_raw_text,
      data.ocr_json,
      data.ocr_confidence,
      data.detected_items,
      data.status,
      id,
    ]
  );
  saveDb();
}

function getSubmission(id) {
  return getOne(`SELECT * FROM food_safety_submissions WHERE id = ?`, [id]);
}

function getSubmissions(opts = {}) {
  let sql = "SELECT * FROM food_safety_submissions WHERE 1=1";
  const params = [];
  if (opts.store_name) { sql += " AND store_name = ?"; params.push(opts.store_name); }
  if (opts.status) { sql += " AND status = ?"; params.push(opts.status); }
  if (opts.created_after) { sql += " AND created_at >= ?"; params.push(opts.created_after); }
  if (opts.created_before) { sql += " AND created_at <= ?"; params.push(opts.created_before); }
  if (opts.message_id) { sql += " AND message_id = ?"; params.push(opts.message_id); }
  sql += " ORDER BY created_at DESC, id DESC";
  if (opts.limit) { sql += " LIMIT ?"; params.push(opts.limit); }
  return getAll(sql, params);
}

function insertEdit(data) {
  run(
    `INSERT INTO food_safety_edits (submission_id, edit_command, field_index, old_value, new_value)
     VALUES (?, ?, ?, ?, ?)`,
    [data.submission_id, data.edit_command, data.field_index, data.old_value, data.new_value]
  );
  saveDb();
}

function updateSessionStatus(phoneNumber, status) {
  const existing = getOne(`SELECT id FROM whatsapp_sessions WHERE phone_number = ?`, [phoneNumber]);
  if (existing) {
    run(`UPDATE whatsapp_sessions SET status = ?, last_activity = datetime('now'), updated_at = datetime('now') WHERE phone_number = ?`, [status, phoneNumber]);
  } else {
    run(`INSERT INTO whatsapp_sessions (phone_number, status, last_activity) VALUES (?, ?, datetime('now'))`, [phoneNumber, status]);
  }
}

function getWhatsAppSessionStatus() {
  const row = getOne(`SELECT status FROM whatsapp_sessions ORDER BY updated_at DESC LIMIT 1`);
  return row ? row.status : "DISCONNECTED";
}

function logMessage(phoneNumber, direction, content, messageType) {
  run(
    `INSERT INTO message_log (phone_number, direction, content, message_type) VALUES (?, ?, ?, ?)`,
    [phoneNumber, direction, content, messageType || "text"]
  );
  saveDb();
}

module.exports = {
  getDb,
  insertSubmission,
  updateSubmissionStatus,
  updateSubmissionOcr,
  getSubmission,
  getSubmissions,
  insertEdit,
  updateSessionStatus,
  getWhatsAppSessionStatus,
  logMessage,
  saveDb,
  // Sync helpers (work after first getDb() call)
  getAll,
  getOne,
  run,
  getAllSync: getAll,
  getOneSync: getOne,
  runSync: run,
};
