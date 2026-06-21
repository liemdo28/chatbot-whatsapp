/**
 * captureRateDashboard.js — Phase 7: Capture Rate Dashboard
 *
 * New KPI: Successful Form Capture Rate = Completed Forms / Submitted Forms
 * Target: >95% capture rate, <5% retake rate
 */

const logger = require("./logger");
const db = require("./database");

function initCaptureRateTables() {
    db.run(`
        CREATE TABLE IF NOT EXISTS capture_rate_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            submission_id INTEGER,
            store_code TEXT,
            store_name TEXT,
            writer_name TEXT,
            employee_phone TEXT,
            template_id TEXT,
            total_fields INTEGER DEFAULT 0,
            confident_fields INTEGER DEFAULT 0,
            predicted_fields INTEGER DEFAULT 0,
            manual_correction_fields INTEGER DEFAULT 0,
            uncertain_fields INTEGER DEFAULT 0,
            fields_needing_confirmation INTEGER DEFAULT 0,
            ocr_method TEXT,
            memory_used INTEGER DEFAULT 0,
            writer_profile_used INTEGER DEFAULT 0,
            cross_field_detected INTEGER DEFAULT 0,
            was_retaken INTEGER DEFAULT 0,
            was_manually_entered INTEGER DEFAULT 0,
            was_confirmed INTEGER DEFAULT 0,
            was_auto_confirmed INTEGER DEFAULT 0,
            was_cancelled INTEGER DEFAULT 0,
            was_manager_review INTEGER DEFAULT 0,
            processing_time_ms INTEGER DEFAULT 0,
            confidence_score REAL DEFAULT 0,
            capture_outcome TEXT DEFAULT 'PENDING',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS capture_rate_daily (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            store_code TEXT,
            total_submitted INTEGER DEFAULT 0,
            total_completed INTEGER DEFAULT 0,
            total_retaken INTEGER DEFAULT 0,
            total_manual_corrections INTEGER DEFAULT 0,
            total_predicted_fields INTEGER DEFAULT 0,
            successful_capture_rate REAL DEFAULT 0,
            retake_rate REAL DEFAULT 0,
            avg_confidence REAL DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(date, store_code)
        )
    `);

    try {
        db.run(`CREATE INDEX IF NOT EXISTS idx_crl_store ON capture_rate_log(store_code, created_at DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_crl_writer ON capture_rate_log(writer_name, created_at DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_crd_date ON capture_rate_daily(date DESC, store_code)`);
    } catch (_) { /* already exists */ }
}

function recordCaptureAttempt(data) {
    db.run(
        `INSERT INTO capture_rate_log
           (submission_id, store_code, store_name, writer_name, employee_phone,
            template_id, total_fields, confident_fields, predicted_fields,
            manual_correction_fields, uncertain_fields, fields_needing_confirmation,
            ocr_method, memory_used, writer_profile_used, cross_field_detected,
            was_retaken, was_manually_entered, was_confirmed, was_auto_confirmed,
            was_cancelled, was_manager_review, processing_time_ms, confidence_score,
            capture_outcome)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            data.submissionId || null,
            data.storeCode || null,
            data.storeName || null,
            data.writerName || null,
            data.employeePhone || null,
            data.templateId || null,
            data.totalFields || 0,
            data.confidentFields || 0,
            data.predictedFields || 0,
            data.manualCorrectionFields || 0,
            data.uncertainFields || 0,
            data.fieldsNeedingConfirmation || 0,
            data.ocrMethod || null,
            data.memoryUsed ? 1 : 0,
            data.writerProfileUsed ? 1 : 0,
            data.crossFieldDetected ? 1 : 0,
            data.wasRetaken ? 1 : 0,
            data.wasManuallyEntered ? 1 : 0,
            data.wasConfirmed ? 1 : 0,
            data.wasAutoConfirmed ? 1 : 0,
            data.wasCancelled ? 1 : 0,
            data.wasManagerReview ? 1 : 0,
            data.processingTimeMs || 0,
            data.confidenceScore || 0,
            data.captureOutcome || "PENDING",
        ]
    );
    db.saveDb();
    logger.info("[CAPTURE_RATE] Recorded", {
        submissionId: data.submissionId,
        storeCode: data.storeCode,
        outcome: data.captureOutcome,
    });
}

function updateCaptureOutcome(submissionId, outcome, extra) {
    const updates = ["capture_outcome = ?"];
    const params = [outcome];
    if (outcome === "CONFIRMED") {
        updates.push("was_confirmed = 1");
        if (extra && extra.wasManuallyEntered) updates.push("was_manually_entered = 1");
    }
    if (outcome === "AUTO_CONFIRMED") updates.push("was_auto_confirmed = 1");
    if (outcome === "CANCELLED") updates.push("was_cancelled = 1");
    if (outcome === "MANAGER_REVIEW") updates.push("was_manager_review = 1");
    if (outcome === "RETAKEN") updates.push("was_retaken = 1");
    params.push(submissionId);
    db.run(`UPDATE capture_rate_log SET ${updates.join(", ")} WHERE submission_id = ?`, params);
    db.saveDb();
}

function getOverallCaptureRate(startDate, endDate) {
    const where = [];
    const params = [];
    if (startDate) { where.push("created_at >= ?"); params.push(startDate); }
    if (endDate) { where.push("created_at <= ?"); params.push(endDate); }
    const wc = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const row = db.getOne(
        `SELECT COUNT(*) as total_submitted,
            SUM(CASE WHEN capture_outcome IN ('CONFIRMED','AUTO_CONFIRMED') THEN 1 ELSE 0 END) as total_completed,
            SUM(CASE WHEN was_retaken = 1 THEN 1 ELSE 0 END) as total_retaken,
            SUM(CASE WHEN manual_correction_fields > 0 THEN 1 ELSE 0 END) as total_with_edits,
            SUM(predicted_fields) as total_predicted,
            SUM(confident_fields) as total_confident,
            AVG(confidence_score) as avg_confidence
         FROM capture_rate_log ${wc}`, params
    );
    if (!row || row.total_submitted === 0) {
        return {
            totalSubmitted: 0, totalCompleted: 0, totalRetaken: 0, totalWithEdits: 0,
            totalPredicted: 0, totalConfident: 0, successfulCaptureRate: 0, retakeRate: 0, avgConfidence: 0
        };
    }
    const rate = (num, den) => den > 0 ? Math.round((num / den) * 1000) / 10 : 0;
    return {
        totalSubmitted: row.total_submitted,
        totalCompleted: row.total_completed || 0,
        totalRetaken: row.total_retaken || 0,
        totalWithEdits: row.total_with_edits || 0,
        totalPredicted: row.total_predicted || 0,
        totalConfident: row.total_confident || 0,
        successfulCaptureRate: rate(row.total_completed || 0, row.total_submitted),
        retakeRate: rate(row.total_retaken || 0, row.total_submitted),
        avgConfidence: row.avg_confidence ? Math.round(row.avg_confidence * 10) / 10 : 0,
    };
}

function getStoreCaptureRates(startDate, endDate) {
    const where = [];
    const params = [];
    if (startDate) { where.push("created_at >= ?"); params.push(startDate); }
    if (endDate) { where.push("created_at <= ?"); params.push(endDate); }
    const wc = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    return db.getAll(
        `SELECT store_code, store_name, COUNT(*) as total_submitted,
            SUM(CASE WHEN capture_outcome IN ('CONFIRMED','AUTO_CONFIRMED') THEN 1 ELSE 0 END) as total_completed,
            SUM(CASE WHEN was_retaken = 1 THEN 1 ELSE 0 END) as total_retaken,
            AVG(confidence_score) as avg_confidence
         FROM capture_rate_log ${wc} GROUP BY store_code ORDER BY total_submitted DESC`, params
    ).map(r => ({
        storeCode: r.store_code, storeName: r.store_name,
        totalSubmitted: r.total_submitted, totalCompleted: r.total_completed || 0,
        totalRetaken: r.total_retaken || 0,
        successfulCaptureRate: r.total_submitted > 0 ? Math.round((r.total_completed / r.total_submitted) * 1000) / 10 : 0,
        retakeRate: r.total_submitted > 0 ? Math.round((r.total_retaken / r.total_submitted) * 1000) / 10 : 0,
        avgConfidence: r.avg_confidence ? Math.round(r.avg_confidence * 10) / 10 : 0,
    }));
}

function getWriterCaptureRates(startDate, endDate) {
    const where = ["writer_name IS NOT NULL AND writer_name != ''"];
    const params = [];
    if (startDate) { where.push("created_at >= ?"); params.push(startDate); }
    if (endDate) { where.push("created_at <= ?"); params.push(endDate); }
    return db.getAll(
        `SELECT writer_name, store_code, COUNT(*) as total_submitted,
            SUM(CASE WHEN capture_outcome IN ('CONFIRMED','AUTO_CONFIRMED') THEN 1 ELSE 0 END) as total_completed,
            SUM(CASE WHEN was_retaken = 1 THEN 1 ELSE 0 END) as total_retaken,
            SUM(manual_correction_fields) as total_edits,
            AVG(confidence_score) as avg_confidence
         FROM capture_rate_log WHERE ${where.join(" AND ")} GROUP BY writer_name, store_code ORDER BY total_submitted DESC`, params
    ).map(r => ({
        writerName: r.writer_name, storeCode: r.store_code,
        totalSubmitted: r.total_submitted, totalCompleted: r.total_completed || 0,
        totalRetaken: r.total_retaken || 0, totalEdits: r.total_edits || 0,
        successfulCaptureRate: r.total_submitted > 0 ? Math.round((r.total_completed / r.total_submitted) * 1000) / 10 : 0,
        avgConfidence: r.avg_confidence ? Math.round(r.avg_confidence * 10) / 10 : 0,
    }));
}

function buildDashboardMessage(startDate, endDate) {
    const overall = getOverallCaptureRate(startDate, endDate);
    const stores = getStoreCaptureRates(startDate, endDate);
    const writers = getWriterCaptureRates(startDate, endDate);
    const lines = [
        "📊 FOOD SAFETY CAPTURE RATE DASHBOARD",
        `Period: ${startDate || "All time"} to ${endDate || "Now"}`,
        "",
        "═══ OVERALL ═══",
        `Submitted: ${overall.totalSubmitted}  |  Completed: ${overall.totalCompleted}  |  Retaken: ${overall.totalRetaken}`,
        `Capture Rate: ${overall.successfulCaptureRate}%  (Target >95%) ${overall.successfulCaptureRate >= 95 ? "✅" : "❌"}`,
        `Retake Rate: ${overall.retakeRate}%  (Target <5%) ${overall.retakeRate <= 5 ? "✅" : "❌"}`,
        `Manual Edits: ${overall.totalWithEdits}  |  Predicted: ${overall.totalPredicted}  |  Confident: ${overall.totalConfident}`,
        `Avg Confidence: ${overall.avgConfidence}%`,
    ];
    if (stores.length > 0) {
        lines.push("", "═══ BY STORE ═══");
        for (const s of stores) {
            lines.push(`${s.storeCode} (${s.storeName}): ${s.successfulCaptureRate}% capture, ${s.retakeRate}% retake, ${s.totalSubmitted} subs`);
        }
    }
    if (writers.length > 0) {
        lines.push("", "═══ BY WRITER ═══");
        for (const w of writers) {
            lines.push(`${w.writerName} @ ${w.storeCode}: ${w.successfulCaptureRate}% capture, ${w.totalEdits} edits, ${w.totalSubmitted} subs`);
        }
    }
    return lines.join("\n");
}

module.exports = {
    initCaptureRateTables,
    recordCaptureAttempt,
    updateCaptureOutcome,
    getOverallCaptureRate,
    getStoreCaptureRates,
    getWriterCaptureRates,
    buildDashboardMessage,
};
