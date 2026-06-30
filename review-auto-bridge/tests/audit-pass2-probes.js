// Second-pass audit probes — verify edge cases not covered by test-cases.js
// Runs in-process, no HTTP needed.

const { detectAspects } = require('../review-agent/aspect');
const { analyzeSentiment } = require('../review-agent/sentiment');
const { classifyRisk } = require('../review-agent/risk');
const { getAuditLog, getApprovals, updateApprovalStatus } = require('../review-agent/audit');

const PROBES = [
    { id: 'E1', text: 'I got sick after eating here.', note: 'health-issue, no aspect keywords' },
    { id: 'E2', text: 'Terrible service and dirty table.', note: 'has keywords' },
    { id: 'E3', text: 'My DoorDash order was missing items and everything was cold.', note: 'has keywords' },
    { id: 'E4', text: "Food was good but the ramen came out late and the server didn't check on us.", note: 'mixed' },
    { id: 'E5', text: 'Amazing ramen and great service.', note: 'positive' },
    { id: 'E6', text: '', note: 'empty' },
    { id: 'E7', text: '   ', note: 'whitespace' },
    { id: 'E8', text: 'You will get sick from here.', note: 'health-issue future tense' },
    { id: 'E9', text: 'Found a hair in my soup.', note: 'contamination' },
    { id: 'E10', text: 'It was OK.', note: 'soft positive (SOFT_POSITIVE_KEYWORDS path)' },
];

console.log('═'.repeat(80));
console.log('  ASPECT DETECTION PROBES (second-pass audit)');
console.log('═'.repeat(80));
console.log('');
console.log('NOTE: aspect.js fallback returns "general_positive" for any text without');
console.log('      recognized aspect keywords, even when sentiment is clearly negative.');
console.log('');

for (const p of PROBES) {
    const aspects = detectAspects(p.text);
    const sent = analyzeSentiment(p.text);
    const risk = classifyRisk({
        rating: 2,
        reviewText: p.text,
        sentiment: sent,
        aspects,
    });
    console.log(`[${p.id}] ${p.note}`);
    console.log(`     text:   "${p.text}"`);
    console.log(`     aspects: ${JSON.stringify(aspects)}`);
    console.log(`     sentiment: ${sent.label} (score=${sent.score})`);
    console.log(`     risk: ${risk.risk_level} (flags=${JSON.stringify(risk.escalation_flags)})`);
    console.log('');
}

// ─── Approval/audit drift probe ──────────────────────────────────────────────

console.log('═'.repeat(80));
console.log('  APPROVAL ↔ AUDIT-LOG DRIFT PROBE');
console.log('═'.repeat(80));
console.log('');

const approvals = getApprovals(null, 20);
const auditLog = getAuditLog(20);

const auditByApprovalId = {};
for (const e of auditLog) {
    if (e.approval_id) auditByApprovalId[e.approval_id] = e;
}

let drifts = 0;
console.log('Approval status vs corresponding audit-log entry:');
console.log('');
for (const a of approvals.slice(0, 10)) {
    const aud = auditByApprovalId[a.id];
    const audStatus = aud ? aud.approval_status : '(no audit)';
    const drift = aud && a.status !== audStatus;
    if (drift) drifts++;
    console.log(`  approval #${a.id} status="${a.status}"  → audit_log status="${audStatus}"  ${drift ? '❌ DRIFT' : '✅ aligned'}`);
}
console.log('');
console.log(`Total drifts found: ${drifts}/${approvals.slice(0, 10).length} (sample 10)`);
console.log('');
console.log('NOTE: When manager decides on approval via POST /api/reviews/approvals/:id/decide,');
console.log('      only the approval store is updated. The audit log entry keeps approval_status');
console.log('      = "pending" forever → violates directive §10 requirement for accurate');
console.log('      approval_status.');

// ─── Risk: missing health-issue aspect detection ─────────────────────��───────

console.log('');
console.log('═'.repeat(80));
console.log('  HEALTH/SAFETY KEYWORD → ASPECT MAPPING PROBE');
console.log('═'.repeat(80));
console.log('');

const HEALTH_TEXTS = [
    'I got sick after eating here.',
    'You will get sick from here.',
    'Found a hair in my soup.',
    'Saw a roach on the table.',
    'The food tasted contaminated.',
    'I had an allergic reaction.',
    'I went to the hospital after eating here.',
];
console.log('Health/safety reviews currently classified only by sentiment + risk-tier,');
console.log('but aspect detection returns "general_positive"/"general_negative" fallback');
console.log('instead of a "health_safety" or "food_safety" aspect tag.');
console.log('');
for (const t of HEALTH_TEXTS) {
    const aspects = detectAspects(t);
    console.log(`  "${t}" → ${JSON.stringify(aspects)}`);
}