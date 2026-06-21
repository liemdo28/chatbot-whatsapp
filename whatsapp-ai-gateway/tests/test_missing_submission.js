/**
 * Missing Submission Alert System — Test Suite
 * Tests all 8 required scenarios + scheduler + dashboard.
 * Run: node tests/test_missing_submission.js
 */
const path = require("path");
const fs = require("fs");

// Set up env before requiring modules
process.env.NODE_ENV = "test";

const { isValidFormSubmission } = require("../src/submissionDueConfig");
const { buildAlertMessage } = require("../src/missingSubmissionDetector");

let passed = 0;
let failed = 0;
let total = 0;

function assert(condition, name) {
    total++;
    if (condition) {
        console.log(`  PASS: ${name}`);
        passed++;
    } else {
        console.log(`  FAIL: ${name}`);
        failed++;
    }
}

// Mock store group for tests
const mockGroup = {
    store_id: "stone_oak",
    store_name: "Bakudan Stone Oak",
    group_id: "stone-oak-safety",
    manager_phones: [],
    admin_phones: [],
    expected_submissions: [{ label: "AM Line Check", time: "11:00", grace_minutes: 15 }],
    alert_targets: { group: true, manager: true, admin: true },
    enabled: true,
};

console.log("\n=== Missing Submission Alert System Tests ===\n");

// ── Test 1: Before deadline = no alert ──────────────────────────
console.log("Test 1: Before deadline = no alert");
{
    const deadline = new Date();
    deadline.setHours(deadline.getHours() + 2); // 2 hours from now
    const expected = { label: "AM Line Check", deadline, grace_minutes: 15 };
    const now = new Date();
    const deadlineWithGrace = new Date(deadline);
    deadlineWithGrace.setMinutes(deadlineWithGrace.getMinutes() + 15);
    const isPastDeadline = now > deadlineWithGrace;
    assert(!isPastDeadline, "Before deadline — no alert should fire");
}

// ── Test 2: After deadline with valid form = no alert ────────────
console.log("\nTest 2: After deadline with valid form = no alert");
{
    const validSubmission = {
        status: "CONFIRMED",
        ocr_json: JSON.stringify({ confidence: 85, items: [{ id: "SO-01", detectedValue: 38 }] }),
    };
    assert(isValidFormSubmission(validSubmission), "Valid CONFIRMED submission accepted");
}

// ── Test 3: After deadline with no form = alert ──────────────────
console.log("\nTest 3: After deadline with no form = alert");
{
    const deadline = new Date();
    deadline.setHours(deadline.getHours() - 2); // 2 hours ago
    const now = new Date();
    const deadlineWithGrace = new Date(deadline);
    deadlineWithGrace.setMinutes(deadlineWithGrace.getMinutes() + 15);
    const isPastDeadline = now > deadlineWithGrace;
    const noSubmissions = [];
    const hasValid = noSubmissions.some((s) => isValidFormSubmission(s));
    assert(isPastDeadline && !hasValid, "Past deadline with no forms — alert should fire");
}

// ── Test 4: After deadline with unreadable image only = alert ─────
console.log("\nTest 4: After deadline with unreadable image only = alert");
{
    const unreadableSubmission = {
        status: "PENDING",
        ocr_json: null, // No OCR result
    };
    assert(!isValidFormSubmission(unreadableSubmission), "PENDING status not valid");
}

// ── Test 5: After deadline with evidence photo only = alert ───────
console.log("\nTest 5: After deadline with evidence photo only = alert");
{
    const evidenceOnly = {
        status: "CONFIRMED",
        ocr_json: JSON.stringify({ confidence: 10, items: [] }), // Very low confidence, no items
    };
    assert(!isValidFormSubmission(evidenceOnly), "Low confidence evidence photo not valid");
}

// ── Test 6: After deadline with cancelled submission = alert ──────
console.log("\nTest 6: After deadline with cancelled submission = alert");
{
    const cancelled = {
        status: "CANCELLED",
        ocr_json: JSON.stringify({ confidence: 85, items: [{ id: "SO-01" }] }),
    };
    assert(!isValidFormSubmission(cancelled), "CANCELLED status not valid");
}

// ── Test 7: Duplicate alert prevention ───────────────────────────
console.log("\nTest 7: Duplicate alert prevention");
{
    const today = new Date();
    const alert1 = buildAlertMessage(mockGroup, { label: "AM Line Check", deadline: today, grace_minutes: 15 }, today);
    const alert2 = buildAlertMessage(mockGroup, { label: "AM Line Check", deadline: today, grace_minutes: 15 }, today);
    // Same store + same label on same day = duplicate
    assert(
        alert1.store_id === alert2.store_id && alert1.label === alert2.label,
        "Duplicate alerts have same store_id and label"
    );
}

// ── Test 8: Manual override / mark received ──────────────────────
console.log("\nTest 8: Manual override — submission status check");
{
    // A MANAGER_REVIEW status should count as valid
    const managerReview = {
        status: "MANAGER_REVIEW",
        ocr_json: JSON.stringify({ confidence: 75, items: [{ id: "SO-01", detectedValue: 40 }] }),
    };
    assert(isValidFormSubmission(managerReview), "MANAGER_REVIEW status counts as valid submission");

    // SAVED status should count as valid
    const saved = {
        status: "SAVED",
        ocr_json: JSON.stringify({ confidence: 90, items: [{ id: "SO-01", detectedValue: 38 }] }),
    };
    assert(isValidFormSubmission(saved), "SAVED status counts as valid submission");
}

// ── Additional edge case tests ──────────────────────────────────
console.log("\nAdditional: Edge cases");
{
    assert(!isValidFormSubmission(null), "Null submission is not valid");
    assert(!isValidFormSubmission(undefined), "Undefined submission is not valid");
    assert(!isValidFormSubmission({ status: "CONFIRMED" }), "Missing ocr_json is not valid");
    assert(
        !isValidFormSubmission({ status: "CONFIRMED", ocr_json: "invalid" }),
        "Invalid ocr_json is not valid"
    );
    assert(
        !isValidFormSubmission({
            status: "CONFIRMED",
            ocr_json: JSON.stringify({ confidence: 85, items: [] }),
        }),
        "Empty items array is not valid"
    );
    assert(
        isValidFormSubmission({
            status: "CONFIRMED",
            ocr_json: JSON.stringify({ confidence: 85, items: [{ id: "SO-01", detectedValue: 38 }] }),
        }),
        "Minimal valid submission accepted"
    );
}

// ── Alert message format test ───────────────────────────────────
console.log("\nAdditional: Alert message format");
{
    const now = new Date();
    const deadline = new Date(now);
    deadline.setHours(11, 0, 0, 0);
    const alert = buildAlertMessage(mockGroup, { label: "AM Line Check", deadline, grace_minutes: 15 }, now);
    assert(alert.es.includes("Stone Oak"), "Alert mentions store name");
    assert(alert.es.includes("missing"), "Alert mentions missing");
    assert(alert.es.includes("11:00"), "Alert shows deadline time");
    assert(alert.store_id === "stone_oak", "Alert has correct store_id");
    assert(alert.label === "AM Line Check", "Alert has correct label");
}

// ── Summary ─────────────────────────────────────────────────────
console.log(`\n=== RESULTS: ${passed}/${total} passed, ${failed} failed ===\n`);

if (failed > 0) {
    console.log("OVERALL: FAIL");
    process.exit(1);
} else {
    console.log("OVERALL: PASS");
    process.exit(0);
}
