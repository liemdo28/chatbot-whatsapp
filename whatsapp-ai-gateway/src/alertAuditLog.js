/**
 * Alert Audit Log
 * Records all missing submission alerts sent, prevents duplicates.
 */
const db = require("./database");
const logger = require("./logger");

/**
 * Ensure audit_log table exists.
 */
function ensureTable() {
    try {
        db.runSync(`
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
    } catch (e) {
        logger.error("[AlertAuditLog] Failed to create table", { error: e.message });
    }
}

/**
 * Check if an alert was already sent today for this store + label.
 * Prevents duplicate alerts.
 */
function wasAlertSentToday(storeId, label, date = new Date()) {
    const dayStr = date.toISOString().split("T")[0];
    const rows = db.getAllSync(
        `SELECT id FROM missing_submission_alerts 
         WHERE store_id = ? AND label = ? AND date(created_at) = ? AND suppressed = 0
         LIMIT 1`,
        [storeId, label, dayStr]
    );
    return rows.length > 0;
}

/**
 * Record an alert in the audit log.
 */
function recordAlert(alert, options = {}) {
    try {
        db.runSync(
            `INSERT INTO missing_submission_alerts 
             (store_id, store_name, label, deadline, detected_at, alert_message_es, alert_message_en, sent_to_group, sent_to_manager, sent_to_admin, suppressed, suppress_reason)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                alert.store_id || alert.store_code || "unknown",
                alert.store_name || "",
                alert.label,
                alert.deadline || new Date().toISOString(),
                alert.detected_at || new Date().toISOString(),
                alert.es,
                alert.en,
                (options.sent_to_group || options.sent_to_management_group) ? 1 : 0,
                options.sent_to_manager ? 1 : 0,
                options.sent_to_admin ? 1 : 0,
                options.suppressed ? 1 : 0,
                options.suppress_reason || null,
            ]
        );
        const rows = db.getAllSync("SELECT last_insert_rowid() as id");
        const id = rows.length > 0 ? rows[0].id : null;
        logger.info("[AlertAuditLog] Alert recorded", { id, store_id: alert.store_id, label: alert.label });
        return id;
    } catch (e) {
        logger.error("[AlertAuditLog] Failed to record alert", { error: e.message });
        return null;
    }
}

/**
 * Get all alerts for today.
 */
function getTodayAlerts(date = new Date()) {
    const dayStr = date.toISOString().split("T")[0];
    return db.getAllSync(
        `SELECT * FROM missing_submission_alerts WHERE date(created_at) = ? ORDER BY created_at DESC`,
        [dayStr]
    );
}

/**
 * Get all alerts for a specific date range.
 */
function getAlerts(startDate, endDate) {
    return db.getAllSync(
        `SELECT * FROM missing_submission_alerts WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC`,
        [startDate, endDate]
    );
}

module.exports = {
    ensureTable,
    wasAlertSentToday,
    recordAlert,
    getTodayAlerts,
    getAlerts,
};
