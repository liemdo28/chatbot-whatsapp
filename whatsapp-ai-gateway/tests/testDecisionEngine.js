/**
 * testDecisionEngine.js — Acceptance Tests for the Production Decision Engine
 *
 * Tests all CEO acceptance criteria:
 *   - Critical field blocking (fryer 350→138 blocked)
 *   - Missing values stay missing
 *   - Alert gate rules
 *   - Range validation
 */

const { decideFieldValue, decideFormValues, canSendAlert, isCriticallyLowOcrValue, classifyFieldRange } = require("../src/foodSafetyDecisionEngine");

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  PASS: ${name}`);
        passed++;
    } catch (err) {
        console.log(`  FAIL: ${name} — ${err.message}`);
        failed++;
    }
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg || "Assertion failed");
}

function assertEq(actual, expected, msg) {
    if (actual !== expected) throw new Error(`${msg || "assertEq"}: expected ${expected}, got ${actual}`);
}

console.log("\n=== Food Safety Decision Engine Acceptance Tests ===\n");

// ─── Critical Field Blocking ──────────────────────────────────────────

console.log("--- Critical Field Blocking ---");

test("SO-16 fryer value 138 is BLOCKED (range 350-360)", () => {
    const item = { field_id: "SO-16", id: "SO-16", safeRange: { min: 350, max: 360 }, detectedValue: 138, confidence: 80 };
    const decision = decideFieldValue({ item, storeCode: "B2", columnLabel: "4PM", ocrConfidence: 0.80 });
    assertEq(decision.status, "MANUAL_REQUIRED", "Should be MANUAL_REQUIRED");
    assertEq(decision.alert_allowed, false, "Alert should be blocked");
    assertEq(decision.final_suggested_value, null, "Value should be null (blocked)");
    assert(decision.alert_block_reason.includes("CRITICAL_LOW"), "Should mention CRITICAL_LOW");
});

test("SO-17 fryer value 300 is BLOCKED (range 350-360)", () => {
    const item = { field_id: "SO-17", id: "SO-17", safeRange: { min: 350, max: 360 }, detectedValue: 300, confidence: 80 };
    const decision = decideFieldValue({ item, storeCode: "B2", columnLabel: "4PM", ocrConfidence: 0.80 });
    assertEq(decision.status, "MANUAL_REQUIRED", "Should be MANUAL_REQUIRED");
    assertEq(decision.alert_allowed, false, "Alert should be blocked");
});

test("SO-16 fryer value 360 is ACCEPTED (range 350-360, in range)", () => {
    const item = { field_id: "SO-16", id: "SO-16", safeRange: { min: 350, max: 360 }, detectedValue: 360, confidence: 95 };
    const decision = decideFieldValue({ item, storeCode: "B2", columnLabel: "4PM", ocrConfidence: 0.95 });
    assertEq(decision.status, "CONFIDENT", "Should be CONFIDENT");
    assertEq(decision.final_suggested_value, 360, "Should keep 360");
});

test("SO-16 fryer value 350 is ACCEPTED (range 350-360, in range)", () => {
    const item = { field_id: "SO-16", id: "SO-16", safeRange: { min: 350, max: 360 }, detectedValue: 350, confidence: 95 };
    const decision = decideFieldValue({ item, storeCode: "B2", columnLabel: "4PM", ocrConfidence: 0.95 });
    assertEq(decision.status, "CONFIDENT", "Should be CONFIDENT");
    assertEq(decision.final_suggested_value, 350, "Should keep 350");
});

test("BAN-16 fryer value 138 is BLOCKED", () => {
    const item = { field_id: "BAN-16", id: "BAN-16", safeRange: { min: 350, max: 360 }, detectedValue: 138, confidence: 80 };
    const decision = decideFieldValue({ item, storeCode: "B3", columnLabel: "4PM", ocrConfidence: 0.80 });
    assertEq(decision.status, "MANUAL_REQUIRED", "Should be MANUAL_REQUIRED");
    assertEq(decision.alert_allowed, false, "Alert should be blocked");
});

test("SO-18 boiler value 2 is BLOCKED (range 200-220, read < 150)", () => {
    const item = { field_id: "SO-18", id: "SO-18", safeRange: { min: 200, max: 220 }, detectedValue: 2, confidence: 80 };
    const decision = decideFieldValue({ item, storeCode: "B2", columnLabel: "4PM", ocrConfidence: 0.80 });
    assertEq(decision.status, "MANUAL_REQUIRED", "Should be MANUAL_REQUIRED");
    assertEq(decision.alert_allowed, false, "Alert should be blocked");
    assert(decision.alert_block_reason.includes("CRITICAL_LOW"), "Should block critically low");
});

test("SO-18 boiler value 215 is ACCEPTED", () => {
    const item = { field_id: "SO-18", id: "SO-18", safeRange: { min: 200, max: 220 }, detectedValue: 215, confidence: 92 };
    const decision = decideFieldValue({ item, storeCode: "B2", columnLabel: "4PM", ocrConfidence: 0.92 });
    assertEq(decision.status, "CONFIDENT", "Should be CONFIDENT");
    assertEq(decision.final_suggested_value, 215, "Should keep 215");
});

test("SO-08 hot food value 4 is BLOCKED (range 95-105, read < 50)", () => {
    const item = { field_id: "SO-08", id: "SO-08", safeRange: { min: 95, max: 105 }, detectedValue: 4, confidence: 80 };
    const decision = decideFieldValue({ item, storeCode: "B2", columnLabel: "4PM", ocrConfidence: 0.80 });
    assertEq(decision.status, "MANUAL_REQUIRED", "Should be MANUAL_REQUIRED");
    assertEq(decision.alert_allowed, false, "Alert should be blocked");
});

test("SO-08 hot food value 7 is BLOCKED (range 95-105, read < 50)", () => {
    const item = { field_id: "SO-08", id: "SO-08", safeRange: { min: 95, max: 105 }, detectedValue: 7, confidence: 80 };
    const decision = decideFieldValue({ item, storeCode: "B2", columnLabel: "4PM", ocrConfidence: 0.80 });
    assertEq(decision.status, "MANUAL_REQUIRED", "Should be MANUAL_REQUIRED");
});

test("SO-08 hot food value 100 is ACCEPTED", () => {
    const item = { field_id: "SO-08", id: "SO-08", safeRange: { min: 95, max: 105 }, detectedValue: 100, confidence: 90 };
    const decision = decideFieldValue({ item, storeCode: "B2", columnLabel: "4PM", ocrConfidence: 0.90 });
    assertEq(decision.status, "CONFIDENT", "Should be CONFIDENT");
    assertEq(decision.final_suggested_value, 100, "Should keep 100");
});

// ─── Missing Values ───────────────────────────────────────────────────

console.log("\n--- Missing Values ---");

test("Null value stays MISSING_VALUE (no invented number)", () => {
    const item = { field_id: "SO-01", id: "SO-01", safeRange: { min: 30, max: 45 }, detectedValue: null, confidence: 0 };
    const decision = decideFieldValue({ item, storeCode: "B2", columnLabel: "4PM", ocrConfidence: 0.80 });
    assertEq(decision.status, "MISSING_VALUE", "Should be MISSING_VALUE");
    assertEq(decision.final_suggested_value, null, "Should stay null");
    assertEq(decision.alert_allowed, false, "No alert for missing");
});

test("Undefined value stays MISSING_VALUE", () => {
    const item = { field_id: "SO-07", id: "SO-07", safeRange: { min: -20, max: 0 }, detectedValue: undefined, confidence: 0 };
    const decision = decideFieldValue({ item, storeCode: "B2", columnLabel: "4PM", ocrConfidence: 0.80 });
    assertEq(decision.status, "MISSING_VALUE", "Should be MISSING_VALUE");
    assertEq(decision.final_suggested_value, null, "Should stay null");
});

// ─── Negative Values ──────────────────────────────────────────────────

console.log("\n--- Negative Values ---");

test("BAN-02 value -7 is ACCEPTED (range -20 to 5) and sign preserved", () => {
    const item = { field_id: "BAN-02", id: "BAN-02", safeRange: { min: -20, max: 5 }, detectedValue: -7, confidence: 90 };
    const decision = decideFieldValue({ item, storeCode: "B3", columnLabel: "4PM", ocrConfidence: 0.90 });
    assertEq(decision.status, "CONFIDENT", "Should be CONFIDENT");
    assertEq(decision.final_suggested_value, -7, "Should preserve -7 (NOT 7)");
    assertEq(decision.alert_allowed, true, "Alert should be allowed for CONFIDENT in-range value");
});

// ─── Alert Gate ───────────────────────────────────────────────────────

console.log("\n--- Alert Gate ---");

test("Alert blocked when needs_confirmation = true", () => {
    const item = {
        field_id: "SO-16", safeRange: { min: 350, max: 360 }, detectedValue: 360,
        _prediction: { final_suggested_value: 360, prediction_source: "MEMORY_ASSISTED", prediction_confidence: 0.9, needs_confirmation: true },
    };
    const result = canSendAlert(item);
    assertEq(result.allowed, false, "Should block alert when needs_confirmation");
});

test("Alert blocked when prediction_confidence < 0.85", () => {
    const item = {
        field_id: "SO-16", safeRange: { min: 350, max: 360 }, detectedValue: 360,
        _prediction: { final_suggested_value: 360, prediction_source: "OCR_HIGH_CONFIDENCE", prediction_confidence: 0.70, needs_confirmation: false },
    };
    const result = canSendAlert(item);
    assertEq(result.allowed, false, "Should block low confidence alert");
});

test("Alert blocked for MISSING_VALUE", () => {
    const item = {
        field_id: "SO-16", safeRange: { min: 350, max: 360 }, detectedValue: null,
        _prediction: { final_suggested_value: null, prediction_source: "MISSING_VALUE", prediction_confidence: 0, needs_confirmation: true },
    };
    const result = canSendAlert(item);
    assertEq(result.allowed, false, "Should block missing value alert");
});

// ─── Field Classification ─────────────────────────────────────────────

console.log("\n--- Field Classification ---");

test("classifyFieldRange: 350-360 = FRYER", () => {
    assertEq(classifyFieldRange(350, 360), "FRYER");
});

test("classifyFieldRange: 200-220 = BOILER", () => {
    assertEq(classifyFieldRange(200, 220), "BOILER");
});

test("classifyFieldRange: 95-105 = HOT_FOOD", () => {
    assertEq(classifyFieldRange(95, 105), "HOT_FOOD");
});

test("classifyFieldRange: 30-45 = COOLER", () => {
    assertEq(classifyFieldRange(30, 45), "COOLER");
});

test("classifyFieldRange: -20-5 = FREEZER", () => {
    assertEq(classifyFieldRange(-20, 5), "FREEZER");
});

// ─── Batch Form Decision ──────────────────────────────────────────────

console.log("\n--- Batch Form Decision (B2 4PM) ---");

test("Full B2 form with CEO ground truth: critical fields blocked correctly", () => {
    const items = [
        { field_id: "SO-16", id: "SO-16", safeRange: { min: 350, max: 360 }, detectedValue: 138, confidence: 60 },
        { field_id: "SO-17", id: "SO-17", safeRange: { min: 350, max: 360 }, detectedValue: 350, confidence: 92 },
        { field_id: "SO-18", id: "SO-18", safeRange: { min: 200, max: 220 }, detectedValue: 215, confidence: 90 },
        { field_id: "SO-01", id: "SO-01", safeRange: { min: 30, max: 45 }, detectedValue: null, confidence: 0 },
    ];
    const result = decideFormValues(items, "B2", null, "4PM", 0.75);
    assertEq(result.items.length, 4, "Should have 4 items");

    // SO-16: critically low → blocked
    assertEq(result.items[0]._decision.status, "MANUAL_REQUIRED", "SO-16 should be MANUAL_REQUIRED");
    assertEq(result.items[0]._decision.alert_allowed, false, "SO-16 alert should be blocked");

    // SO-17: in range + high confidence → CONFIDENT
    assertEq(result.items[1]._decision.status, "CONFIDENT", "SO-17 should be CONFIDENT");
    assertEq(result.items[1]._decision.final_suggested_value, 350, "SO-17 value should be 350");

    // SO-18: in range + high confidence → CONFIDENT
    assertEq(result.items[2]._decision.status, "CONFIDENT", "SO-18 should be CONFIDENT");
    assertEq(result.items[2]._decision.final_suggested_value, 215, "SO-18 value should be 215");

    // SO-01: null → MISSING_VALUE
    assertEq(result.items[3]._decision.status, "MISSING_VALUE", "SO-01 should be MISSING_VALUE");
    assertEq(result.items[3]._decision.alert_allowed, false, "SO-01 alert blocked");
});

// ─── Summary ──────────────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
    process.exit(1);
} else {
    console.log("All acceptance tests PASSED!");
    process.exit(0);
}
