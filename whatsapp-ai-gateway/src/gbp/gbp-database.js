/**
 * GBP Database — SQLite Storage for Daily Snapshots
 *
 * Stores GBP data in the existing sql.js database.
 * Tables:
 *   - gbp_locations: Location metadata
 *   - gbp_performance: Daily performance metrics
 *   - gbp_reviews: Customer reviews
 *   - gbp_sync_logs: Sync history
 *
 * All data written here is REAL — from live Google API calls.
 */

const logger = require("../logger");
const db = require("../database");

const GBP_TABLES = [
    `CREATE TABLE IF NOT EXISTS gbp_locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id TEXT UNIQUE NOT NULL,
        location_name TEXT NOT NULL,
        account_id TEXT,
        title TEXT,
        address_json TEXT,
        phone TEXT,
        website TEXT,
        categories_json TEXT,
        regular_hours_json TEXT,
        metadata_json TEXT,
        last_synced_at TEXT DEFAULT (datetime('now')),
        created_at TEXT DEFAULT (datetime('now'))
    );`,
    `CREATE TABLE IF NOT EXISTS gbp_performance_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id TEXT NOT NULL,
        date TEXT NOT NULL,
        metric TEXT NOT NULL,
        value INTEGER DEFAULT 0,
        snapshot_at TEXT DEFAULT (datetime('now')),
        UNIQUE(location_id, date, metric)
    );`,
    `CREATE TABLE IF NOT EXISTS gbp_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id TEXT NOT NULL,
        review_id TEXT UNIQUE,
        author_name TEXT,
        rating INTEGER,
        comment TEXT,
        create_time TEXT,
        update_time TEXT,
        fetched_at TEXT DEFAULT (datetime('now'))
    );`,
    `CREATE TABLE IF NOT EXISTS gbp_sync_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sync_timestamp TEXT NOT NULL,
        location_count INTEGER,
        snapshot_path TEXT,
        status TEXT,
        error TEXT,
        duration_ms INTEGER,
        date_range_start TEXT,
        date_range_end TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_gbp_perf_loc_date ON gbp_performance_snapshots(location_id, date DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_gbp_reviews_loc ON gbp_reviews(location_id, create_time DESC);`,
];

let _initialized = false;

/**
 * Ensure all GBP tables exist. Idempotent.
 */
async function initTables() {
    if (_initialized) return;
    await db.getDb();
    for (const sql of GBP_TABLES) {
        try {
            db.run(sql);
        } catch (err) {
            logger.warn("GBP DB: Table init failed (continuing)", { error: err.message, sql: sql.slice(0, 60) });
        }
    }
    db.saveDb();
    _initialized = true;
    logger.info("GBP DB: Tables initialized");
}

/**
 * Upsert location metadata.
 */
function upsertLocation(loc) {
    try {
        const existing = db.getOne(
            `SELECT id FROM gbp_locations WHERE location_id = ?`,
            [loc.locationId]
        );
        const addressJson = JSON.stringify(loc.address || {});
        const categoriesJson = JSON.stringify(loc.categories || {});
        const regularHoursJson = JSON.stringify(loc.regularHours || {});
        const metadataJson = JSON.stringify(loc.metadata || {});

        if (existing) {
            db.run(
                `UPDATE gbp_locations SET
                    location_name = ?, account_id = ?, title = ?, address_json = ?,
                    phone = ?, website = ?, categories_json = ?, regular_hours_json = ?,
                    metadata_json = ?, last_synced_at = datetime('now')
                 WHERE location_id = ?`,
                [
                    loc.locationName, loc.accountId, loc.title, addressJson,
                    loc.phone || "", loc.website || "", categoriesJson, regularHoursJson,
                    metadataJson, loc.locationId,
                ]
            );
        } else {
            db.run(
                `INSERT INTO gbp_locations
                    (location_id, location_name, account_id, title, address_json, phone, website,
                     categories_json, regular_hours_json, metadata_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    loc.locationId, loc.locationName, loc.accountId, loc.title, addressJson,
                    loc.phone || "", loc.website || "", categoriesJson, regularHoursJson,
                    metadataJson,
                ]
            );
        }
        db.saveDb();
    } catch (err) {
        logger.error("GBP DB: upsertLocation failed", { error: err.message, location: loc.locationId });
    }
}

/**
 * Insert (or replace) a daily performance metric point.
 */
function insertPerformanceSnapshot(data) {
    try {
        db.run(
            `INSERT OR REPLACE INTO gbp_performance_snapshots (location_id, date, metric, value, snapshot_at)
             VALUES (?, ?, ?, ?, datetime('now'))`,
            [data.locationId, data.date, data.metric, data.value]
        );
        db.saveDb();
    } catch (err) {
        logger.error("GBP DB: insertPerformanceSnapshot failed", { error: err.message });
    }
}

/**
 * Upsert a review.
 */
function upsertReview(review) {
    try {
        const existing = db.getOne(
            `SELECT id FROM gbp_reviews WHERE review_id = ?`,
            [review.reviewId]
        );

        if (existing) {
            db.run(
                `UPDATE gbp_reviews SET
                    location_id = ?, author_name = ?, rating = ?, comment = ?,
                    update_time = ?
                 WHERE review_id = ?`,
                [
                    review.locationId, review.authorName, review.rating,
                    review.comment, review.updateTime, review.reviewId,
                ]
            );
        } else {
            db.run(
                `INSERT INTO gbp_reviews
                    (location_id, review_id, author_name, rating, comment, create_time, update_time)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    review.locationId, review.reviewId, review.authorName,
                    review.rating, review.comment, review.createTime, review.updateTime,
                ]
            );
        }
        db.saveDb();
    } catch (err) {
        logger.error("GBP DB: upsertReview failed", { error: err.message });
    }
}

/**
 * Insert a sync log entry.
 */
function insertSyncLog(data) {
    try {
        db.run(
            `INSERT INTO gbp_sync_logs
                (sync_timestamp, location_count, snapshot_path, status, error, duration_ms,
                 date_range_start, date_range_end)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.timestamp, data.locationCount || 0, data.snapshotPath || "",
                data.status || "UNKNOWN", data.error || "", data.durationMs || 0,
                data.dateRangeStart || "", data.dateRangeEnd || "",
            ]
        );
        db.saveDb();
    } catch (err) {
        logger.error("GBP DB: insertSyncLog failed", { error: err.message });
    }
}

/**
 * Get recent sync logs.
 */
function getSyncLogs(limit = 30) {
    try {
        return db.getAll(
            `SELECT * FROM gbp_sync_logs ORDER BY id DESC LIMIT ?`,
            [limit]
        );
    } catch (err) {
        logger.error("GBP DB: getSyncLogs failed", { error: err.message });
        return [];
    }
}

/**
 * Get performance snapshots for a location over the last N days.
 */
function getPerformanceSnapshots(locationId, days = 30) {
    try {
        return db.getAll(
            `SELECT * FROM gbp_performance_snapshots
             WHERE location_id = ? AND date >= date('now', ?)
             ORDER BY date DESC, metric ASC`,
            [locationId, `-${days} days`]
        );
    } catch (err) {
        logger.error("GBP DB: getPerformanceSnapshots failed", { error: err.message });
        return [];
    }
}

/**
 * Get all stored locations.
 */
function getAllLocations() {
    try {
        return db.getAll(`SELECT * FROM gbp_locations ORDER BY title ASC`);
    } catch (err) {
        logger.error("GBP DB: getAllLocations failed", { error: err.message });
        return [];
    }
}

/**
 * Get all stored reviews.
 */
function getAllReviews(locationId = null) {
    try {
        if (locationId) {
            return db.getAll(
                `SELECT * FROM gbp_reviews WHERE location_id = ? ORDER BY create_time DESC`,
                [locationId]
            );
        }
        return db.getAll(`SELECT * FROM gbp_reviews ORDER BY create_time DESC`);
    } catch (err) {
        logger.error("GBP DB: getAllReviews failed", { error: err.message });
        return [];
    }
}

module.exports = {
    initTables,
    upsertLocation,
    insertPerformanceSnapshot,
    upsertReview,
    insertSyncLog,
    getSyncLogs,
    getPerformanceSnapshots,
    getAllLocations,
    getAllReviews,
};