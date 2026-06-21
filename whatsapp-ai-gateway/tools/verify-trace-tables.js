const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'gateway.db');

(async () => {
    const SQL = await initSqlJs();
    const buf = fs.readFileSync(DB_PATH);
    const db = new SQL.Database(buf);

    // List all tables
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    console.log('\n=== TABLES ===');
    if (tables.length > 0) {
        tables[0].values.forEach(r => console.log(' ', r[0]));
    }

    // Count trace events
    try {
        const traceCount = db.exec("SELECT count(*) FROM pipeline_trace_events");
        console.log('\n=== PIPELINE TRACE EVENTS ===');
        console.log('Count:', traceCount[0].values[0][0]);
        // Show recent 5
        const recent = db.exec("SELECT trace_id, step, status, chat_id, chat_name, created_at FROM pipeline_trace_events ORDER BY id DESC LIMIT 5");
        if (recent.length > 0) {
            console.log('Recent:');
            recent[0].values.forEach(r => console.log(' ', JSON.stringify(r)));
        }
    } catch (e) {
        console.log('pipeline_trace_events: NOT FOUND or empty -', e.message);
    }

    // Count audit events
    try {
        const auditCount = db.exec("SELECT count(*) FROM audit_events");
        console.log('\n=== AUDIT EVENTS ===');
        console.log('Count:', auditCount[0].values[0][0]);
    } catch (e) {
        console.log('audit_events: NOT FOUND -', e.message);
    }

    // Count decision audit
    try {
        const decisionCount = db.exec("SELECT count(*) FROM decision_audit");
        console.log('\n=== DECISION AUDIT ===');
        console.log('Count:', decisionCount[0].values[0][0]);
    } catch (e) {
        console.log('decision_audit: NOT FOUND -', e.message);
    }

    // Count pilot metrics
    try {
        const pilotCount = db.exec("SELECT count(*) FROM pilot_metrics");
        console.log('\n=== PILOT METRICS ===');
        console.log('Count:', pilotCount[0].values[0][0]);
    } catch (e) {
        console.log('pilot_metrics: NOT FOUND -', e.message);
    }

    // Check env verification
    console.log('\n=== ENV TRACE VERIFICATION ===');
    console.log('HYBRID_TRACE_ENABLED:', process.env.HYBRID_TRACE_ENABLED || '(not set in this process)');
    console.log('HYBRID_TRACE_GROUPS:', process.env.HYBRID_TRACE_GROUPS || '(not set in this process)');
    console.log('\nDone.');
})();
