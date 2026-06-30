// Live audit + evidence collection script.
// Runs test suite, captures JSON evidence for each test case + live API responses
// + agent server health. Saves everything to audit-evidence/.

const fs = require('fs');
const path = require('path');
const http = require('http');

const pipeline = require('../review-agent/pipeline');
const { runTests, TEST_CASES } = require('./test-cases');

const EVIDENCE_DIR = path.join(__dirname, '..', 'audit-evidence');
if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const AGENT_PORT = 8788;

function ts() {
    return new Date().toISOString();
}

function httpRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const opts = {
            hostname: 'localhost',
            port: AGENT_PORT,
            path,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
            },
            timeout: 10000,
        };
        const req = http.request(opts, (res) => {
            let chunks = '';
            res.on('data', (d) => (chunks += d));
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(chunks) });
                } catch {
                    resolve({ status: res.statusCode, body: chunks });
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        if (data) req.write(data);
        req.end();
    });
}

async function captureHealthCheck() {
    const evidence = { timestamp: ts(), checks: [] };

    try {
        const health = await httpRequest('GET', '/health');
        evidence.checks.push({ name: 'GET /health', status: health.status, response: health.body });
    } catch (err) {
        evidence.checks.push({ name: 'GET /health', error: err.message });
    }

    return evidence;
}

async function captureLiveApiCalls() {
    const evidence = { timestamp: ts(), calls: [] };

    for (const tc of TEST_CASES) {
        try {
            const resp = await httpRequest('POST', '/api/reviews/reply-agent/run', {
                store_id: tc.input.store_id,
                platform: tc.input.platform,
                rating: tc.input.rating,
                review_text: tc.input.review_text,
                reviewer_name: tc.input.reviewer_name,
            });
            evidence.calls.push({
                case: tc.id,
                name: tc.name,
                input: tc.input,
                http_status: resp.status,
                response: resp.body,
                expected: tc.expected,
                pass: resp.body && resp.body.ok !== false && (
                    tc.expected.auto_reply_allowed === undefined ||
                    resp.body.analysis?.auto_reply_allowed === tc.expected.auto_reply_allowed
                ) && (
                        !tc.expected.risk_level ||
                        resp.body.analysis?.risk_level === tc.expected.risk_level
                    ) && (
                        !tc.expected.sentiment ||
                        resp.body.analysis?.sentiment === tc.expected.sentiment
                    ),
            });
        } catch (err) {
            evidence.calls.push({ case: tc.id, name: tc.name, error: err.message });
        }
    }

    return evidence;
}

async function captureAuditAndApprovals() {
    const evidence = { timestamp: ts() };
    try {
        evidence.audit_log = (await httpRequest('GET', '/api/reviews/audit-log?limit=20')).body;
    } catch (err) {
        evidence.audit_log = { error: err.message };
    }
    try {
        evidence.approvals = (await httpRequest('GET', '/api/reviews/approvals?limit=20')).body;
    } catch (err) {
        evidence.approvals = { error: err.message };
    }
    try {
        evidence.drafts = (await httpRequest('GET', '/api/reviews/drafts?limit=20')).body;
    } catch (err) {
        evidence.drafts = { error: err.message };
    }
    try {
        evidence.stores = (await httpRequest('GET', '/api/reviews/stores')).body;
    } catch (err) {
        evidence.stores = { error: err.message };
    }
    return evidence;
}

async function captureStatsFromServer() {
    try {
        const resp = await httpRequest('GET', '/api/reviews/audit-log?limit=100');
        const log = resp.body?.log || [];
        const stats = {
            total_runs: log.length,
            by_risk_level: {},
            by_sentiment: {},
            auto_replied: 0,
            requires_approval: 0,
            escalated: 0,
            errors: 0,
        };
        for (const entry of log) {
            const lvl = entry.risk_level || 'unknown';
            stats.by_risk_level[lvl] = (stats.by_risk_level[lvl] || 0) + 1;
            const sent = entry.detected_sentiment || 'unknown';
            stats.by_sentiment[sent] = (stats.by_sentiment[sent] || 0) + 1;
            if (entry.auto_reply_allowed) stats.auto_replied++;
            if (entry.approval_status === 'pending') stats.requires_approval++;
            if (entry.risk_level === 'escalation_required') stats.escalated++;
            if (entry.approval_status === 'error') stats.errors++;
        }
        return stats;
    } catch (err) {
        return { error: err.message };
    }
}

async function main() {
    console.log('═'.repeat(80));
    console.log('  REVIEW REPLY AGENT — LIVE AUDIT & EVIDENCE COLLECTION');
    console.log('═'.repeat(80));

    // 1. Health check
    console.log('\n[1/5] Health check...');
    const health = await captureHealthCheck();
    fs.writeFileSync(
        path.join(EVIDENCE_DIR, '01-health-check.json'),
        JSON.stringify(health, null, 2),
    );
    console.log(`   ✅ Saved: 01-health-check.json (${health.checks.length} checks)`);

    // 2. Run unit tests (direct, no HTTP)
    console.log('\n[2/5] Running unit test suite (Case A-F)...');
    const unitResult = runTests();
    fs.writeFileSync(
        path.join(EVIDENCE_DIR, '02-unit-test-results.json'),
        JSON.stringify({ timestamp: ts(), passed: unitResult.passed, total: unitResult.total, results: unitResult.results }, null, 2),
    );
    console.log(`   ✅ Saved: 02-unit-test-results.json (${unitResult.passed}/${unitResult.total} PASS)`);

    // 3. Live API calls
    console.log('\n[3/5] Live API calls (server on :8788)...');
    const liveCalls = await captureLiveApiCalls();
    fs.writeFileSync(
        path.join(EVIDENCE_DIR, '03-live-api-calls.json'),
        JSON.stringify(liveCalls, null, 2),
    );
    const livePassed = liveCalls.calls.filter(c => c.pass).length;
    console.log(`   ✅ Saved: 03-live-api-calls.json (${livePassed}/${liveCalls.calls.length} PASS)`);

    // 4. Audit log + approvals
    console.log('\n[4/5] Audit log + approvals + drafts...');
    const auditData = await captureAuditAndApprovals();
    fs.writeFileSync(
        path.join(EVIDENCE_DIR, '04-audit-and-approvals.json'),
        JSON.stringify(auditData, null, 2),
    );
    console.log(`   ✅ Saved: 04-audit-and-approvals.json`);

    // 5. Stats
    console.log('\n[5/5] Computing stats...');
    const stats = await captureStatsFromServer();
    fs.writeFileSync(
        path.join(EVIDENCE_DIR, '05-stats.json'),
        JSON.stringify({ timestamp: ts(), stats }, null, 2),
    );
    console.log(`   ✅ Saved: 05-stats.json`);

    // Final summary
    console.log('\n' + '═'.repeat(80));
    console.log('  AUDIT COMPLETE');
    console.log('═'.repeat(80));
    console.log(`  Unit tests: ${unitResult.passed}/${unitResult.total} PASS`);
    console.log(`  Live API:   ${livePassed}/${liveCalls.calls.length} PASS`);
    console.log(`  Audit log:  ${auditData.audit_log?.log?.length || 0} entries`);
    console.log(`  Approvals:  ${auditData.approvals?.approvals?.length || 0} entries`);
    console.log(`  Stores:     ${auditData.stores?.stores?.length || 0} registered`);
    console.log(`  Evidence:   ${EVIDENCE_DIR}`);
    console.log('═'.repeat(80));

    // Save summary as text "screenshot"
    const summary = [
        '═══════════════════════════════════════════════════════════════════════════════',
        '  REVIEW REPLY AGENT — AUDIT EVIDENCE SUMMARY',
        `  Generated: ${ts()}`,
        '═══════════════════════════════════════════════════════════════════════════════',
        '',
        'TEST RESULTS:',
        `  Unit tests: ${unitResult.passed}/${unitResult.total} PASS`,
        `  Live API:   ${livePassed}/${liveCalls.calls.length} PASS`,
        '',
        'DETAILED RESULTS:',
        ...unitResult.results.map(r =>
            `  ${r.pass ? '✅' : '❌'} Case ${r.id}: ${r.name}` +
            (r.error ? ` — ERROR: ${r.error}` : '')
        ),
        '',
        'LIVE API RESPONSES:',
        ...liveCalls.calls.map(c =>
            c.error
                ? `  ❌ Case ${c.case}: ${c.name} — ERROR: ${c.error}`
                : `  ${c.pass ? '✅' : '❌'} Case ${c.case}: ${c.name} (HTTP ${c.http_status})`
        ),
        '',
        'SERVER STATUS:',
        `  Service: review-reply-agent`,
        `  Port: ${AGENT_PORT}`,
        `  Status: ${health.checks[0]?.response?.status || 'unknown'}`,
        `  Uptime: ${health.checks[0]?.response?.uptime_s || '?'}s`,
        '',
        'EVIDENCE FILES:',
        '  01-health-check.json — Health endpoint response',
        '  02-unit-test-results.json — Direct unit test results',
        '  03-live-api-calls.json — Live HTTP API responses per case',
        '  04-audit-and-approvals.json — Audit log + approval queue snapshot',
        '  05-stats.json — Aggregate statistics',
        '',
        '═══════════════════════════════════════════════════════════════════════════════',
    ].join('\n');

    fs.writeFileSync(
        path.join(EVIDENCE_DIR, '00-AUDIT-SUMMARY.txt'),
        summary,
    );

    console.log('\n📋 Summary written to 00-AUDIT-SUMMARY.txt');
}

main().catch((err) => {
    console.error('AUDIT FAILED:', err.message);
    fs.writeFileSync(
        path.join(EVIDENCE_DIR, 'AUDIT_ERROR.txt'),
        `Audit script failed at ${ts()}\n\nError: ${err.message}\n\nStack: ${err.stack}\n`,
    );
    process.exit(1);
});