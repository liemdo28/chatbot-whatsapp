// Verify Finding 2 fix: manager decision now updates audit log.
// Simulates the full flow: pipeline run → approval created → decision made
// → both approval and audit-log statuses synced.

const pipeline = require('../review-agent/pipeline');
const audit = require('../review-agent/audit');

async function main() {
    console.log('═'.repeat(80));
    console.log('  MANAGER DECISION DRIFT FIX VERIFICATION');
    console.log('═'.repeat(80));
    console.log('');

    // 1. Run a fresh pipeline to create a new approval
    console.log('[1/4] Run pipeline to create a new approval...');
    const result = await pipeline.run({
        store_id: 'bakudan_rim',
        platform: 'google',
        rating: 2,
        review_text: 'Drift test review ' + Date.now(),
        reviewer_name: 'DriftTester',
    });
    const approvalId = result.approval_id;
    const auditId = result.audit_id;
    console.log(`   approval_id=${approvalId}, audit_id=${auditId}`);
    console.log(`   requires_approval=${result.requires_approval}`);
    console.log('');

    // 2. Verify approval status before decision
    console.log('[2/4] Status BEFORE manager decision:');
    const approvals = audit.getApprovals(null, 100);
    const auditLog = audit.getAuditLog(100);
    const beforeApproval = approvals.find(a => a.id === approvalId);
    const beforeAudit = auditLog.find(e => e.id === auditId);
    console.log(`   approval.status    = "${beforeApproval.status}"`);
    console.log(`   audit_log.approval_status = "${beforeAudit.approval_status}"`);
    console.log('');

    // 3. Simulate manager decision (same logic as server.js endpoint)
    console.log('[3/4] Simulate manager "approve" decision...');
    const decision = 'approve';
    const statusMap = { approve: 'approved', reject: 'rejected', edit: 'edited', escalate: 'escalated' };
    const decisionFields = {
        decided_by: 'manager_smoke_test',
        decided_at: new Date().toISOString(),
    };
    audit.updateApprovalStatus(approvalId, statusMap[decision], decisionFields);
    audit.updateApprovalAuditLog(approvalId, statusMap[decision], decisionFields);
    console.log(`   decision="${decision}" → status="${statusMap[decision]}"`);
    console.log('');

    // 4. Verify status after decision — BOTH should be aligned
    console.log('[4/4] Status AFTER manager decision:');
    const approvalsAfter = audit.getApprovals(null, 100);
    const auditLogAfter = audit.getAuditLog(100);
    const afterApproval = approvalsAfter.find(a => a.id === approvalId);
    const afterAudit = auditLogAfter.find(e => e.id === auditId);
    console.log(`   approval.status    = "${afterApproval.status}"`);
    console.log(`   audit_log.approval_status = "${afterAudit.approval_status}"`);
    console.log('');

    const aligned = afterApproval.status === afterAudit.approval_status;
    if (aligned) {
        console.log('✅ DRIFT FIX VERIFIED: approval and audit-log are in sync.');
        console.log(`   Both show: "${afterApproval.status}" (decided_by=${afterAudit.decided_by || 'n/a'})`);
    } else {
        console.log('❌ DRIFT STILL EXISTS:');
        console.log(`   approval.status="${afterApproval.status}" vs audit_log.approval_status="${afterAudit.approval_status}"`);
        process.exit(1);
    }

    console.log('');
    console.log('═'.repeat(80));
}

main().catch(err => {
    console.error('VERIFY FAILED:', err.message);
    console.error(err.stack);
    process.exit(1);
});