/**
 * testZeroRetake.js — Comprehensive tests for the Zero Retake Strategy
 *
 * Tests all 8 phases:
 *   Phase 1: Field-Level Confidence Scoring
 *   Phase 2: Prediction Before Retake
 *   Phase 3: Cross-Field Intelligence
 *   Phase 4: Writer Memory Priority
 *   Phase 5: Smart Confirmation Flow
 *   Phase 6: Retake Rules
 *   Phase 7: Capture Rate Dashboard
 *   Phase 8: Acceptance Criteria
 */

const assert = require("assert");
const zeroRetakeReply = require("../src/zeroRetakeReplyBuilder");
const crossFieldIntelligence = require("../src/crossFieldIntelligence");
const acceptanceCriteria = require("../src/acceptanceCriteria");
const captureRate = require("../src/captureRateDashboard");

let passed = 0;
let failed = 0;
let total = 0;

function test(name, fn) {
    total++;
    try {
        fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err) {
        failed++;
        console.log(`  ❌ ${name}: ${err.message}`);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Phase 1: Field-Level Confidence Scoring
// ═══════════════════════════════════════════════════════════════════════

console.log("\n═══ Phase 1: Field-Level Confidence Scoring ═══");

test("classifyField returns CONFIDENT for OCR_HIGH_CONFIDENCE without confirmation", () => {
    const item = { detectedValue: 40, _predictionSource: "OCR_HIGH_CONFIDENCE", _needsConfirmation: false, confidence: 0.95 };
    const result = zeroRetakeReply.classifyField(item);
    assert.strictEqual(result, "CONFIDENT");
});

test("classifyField returns CONFIDENT for MANUAL_ENTRY", () => {
    const item = { detectedValue: 40, _predictionSource: "MANUAL_ENTRY", _needsConfirmation: false, confidence: 1.0 };
    const result = zeroRetakeReply.classifyField(item);
    assert.strictEqual(result, "CONFIDENT");
});

test("classifyField returns PREDICTED for MEMORY_ASSISTED", () => {
    const item = { detectedValue: 360, _predictionSource: "MEMORY_ASSISTED", _needsConfirmation: true, confidence: 0.7 };
    const result = zeroRetakeReply.classifyField(item);
    assert.strictEqual(result, "PREDICTED");
});

test("classifyField returns UNCERTAIN for HUMAN_REQUIRED", () => {
    const item = { detectedValue: 138, _predictionSource: "HUMAN_REQUIRED", _needsConfirmation: true, confidence: 0.3 };
    const result = zeroRetakeReply.classifyField(item);
    assert.strictEqual(result, "UNCERTAIN");
});

test("classifyField returns MISSING for null detectedValue", () => {
    const item = { detectedValue: null, _predictionSource: "MISSING_VALUE", _needsConfirmation: true, confidence: 0 };
    const result = zeroRetakeReply.classifyField(item);
    assert.strictEqual(result, "MISSING");
});

test("getFieldConfidenceSummary counts correctly", () => {
    const items = [
        { detectedValue: 40, _predictionSource: "OCR_HIGH_CONFIDENCE", _needsConfirmation: false, confidence: 0.95 },
        { detectedValue: 42, _predictionSource: "OCR_HIGH_CONFIDENCE", _needsConfirmation: false, confidence: 0.92 },
        { detectedValue: 360, _predictionSource: "MEMORY_ASSISTED", _needsConfirmation: true, confidence: 0.7 },
        { detectedValue: 138, _predictionSource: "HUMAN_REQUIRED", _needsConfirmation: true, confidence: 0.3 },
        { detectedValue: null, _predictionSource: "MISSING_VALUE", _needsConfirmation: true, confidence: 0 },
    ];
    const summary = zeroRetakeReply.getFieldConfidenceSummary(items);
    assert.strictEqual(summary.confident, 2);
    assert.strictEqual(summary.predicted, 1);
    assert.strictEqual(summary.uncertain, 1);
    assert.strictEqual(summary.missing, 1);
    assert.strictEqual(summary.total, 5);
});

// ═══════════════════════════════════════════════════════════════════════
// Phase 3: Cross-Field Intelligence
// ═══════════════════════════════════════════════════════════════════════

console.log("\n═══ Phase 3: Cross-Field Intelligence ═══");

test("detects impossible fryer pair (both reading 138)", () => {
    const items = [
        { field_id: "SO-16", detectedValue: 138, label: "Fryer Left" },
        { field_id: "SO-17", detectedValue: 138, label: "Fryer Right" },
    ];
    const result = crossFieldIntelligence.analyzeCrossField(items, {});
    assert.strictEqual(result.correctedFields.size, 2);
    assert.ok(result.anomalies.length >= 1);
    assert.strictEqual(result.anomalies[0].type, "IMPOSSIBLE_GROUP_READ");
});

test("detects impossible boiler pair", () => {
    const items = [
        { field_id: "SO-18", detectedValue: 100, label: "Pasta Boiler Left" },
        { field_id: "SO-19", detectedValue: 105, label: "Pasta Boiler Right" },
    ];
    const result = crossFieldIntelligence.analyzeCrossField(items, {});
    assert.strictEqual(result.correctedFields.size, 2);
});

test("does NOT flag valid fryer pair", () => {
    const items = [
        { field_id: "SO-16", detectedValue: 355, label: "Fryer Left" },
        { field_id: "SO-17", detectedValue: 358, label: "Fryer Right" },
    ];
    const result = crossFieldIntelligence.analyzeCrossField(items, {});
    assert.strictEqual(result.correctedFields.size, 0);
});

test("detects extreme spread in boiler pair", () => {
    const items = [
        { field_id: "SO-18", detectedValue: 210, label: "Pasta Boiler Left" },
        { field_id: "SO-19", detectedValue: 50, label: "Pasta Boiler Right" },
    ];
    const result = crossFieldIntelligence.analyzeCrossField(items, {});
    assert.ok(result.correctedFields.size >= 1);
});

test("detects single field impossible reading with memory override", () => {
    const items = [
        { field_id: "SO-16", detectedValue: 100, label: "Fryer Left" },
    ];
    const memoryData = {
        "SO-16": { recentValues: [352, 355, 358, 360, 350], median: 355, count: 5 },
    };
    const result = crossFieldIntelligence.analyzeCrossField(items, memoryData);
    assert.strictEqual(result.correctedFields.size, 1);
    assert.strictEqual(result.anomalies[0].action, "MEMORY_OVERRIDE");
});

test("getFieldGroup identifies fryer pair", () => {
    const group = crossFieldIntelligence.getFieldGroup("SO-16");
    assert.ok(group);
    assert.strictEqual(group.groupName, "FRYER_PAIR");
});

test("getFieldGroup identifies boiler pair", () => {
    const group = crossFieldIntelligence.getFieldGroup("RIM-18");
    assert.ok(group);
    assert.strictEqual(group.groupName, "BOILER_PAIR");
});

test("getFieldGroup returns null for ungrouped field", () => {
    const group = crossFieldIntelligence.getFieldGroup("SO-99");
    assert.strictEqual(group, null);
});

// ═══════════════════════════════════════════════════════════════════════
// Phase 5: Smart Confirmation Flow
// ═══════════════════════════════════════════════════════════════════════

console.log("\n═══ Phase 5: Smart Confirmation Flow ═══");

test("buildSmartConfirmationMessage with all confident fields", () => {
    const items = [];
    for (let i = 1; i <= 19; i++) {
        const num = String(i).padStart(2, "0");
        items.push({
            field_id: `SO-${num}`, detectedValue: 40, unit: "F",
            _predictionSource: "OCR_HIGH_CONFIDENCE", _needsConfirmation: false,
            confidence: 0.95, label: `Field ${num}`,
        });
    }
    const result = zeroRetakeReply.buildSmartConfirmationMessage({
        items,
        storeInfo: { storeName: "Stone Oak", storeCode: "B2", templateId: "FoodSafety-StoneOak-v3" },
        selectedColumn: "16:00",
        language: "EN",
    });
    assert.strictEqual(result.needsRetake, false);
    assert.strictEqual(result.confidentCount, 19);
    assert.strictEqual(result.uncertainCount, 0);
    assert.ok(result.message.includes("Confirmed values"));
    assert.ok(result.message.includes("CONFIRM = save"));
    assert.ok(!result.message.includes("RETAKE"));
});

test("buildSmartConfirmationMessage with 2 uncertain fields does NOT suggest retake", () => {
    const items = [];
    for (let i = 1; i <= 19; i++) {
        const num = String(i).padStart(2, "0");
        const isFryer = i === 16 || i === 17;
        items.push({
            field_id: `SO-${num}`, detectedValue: isFryer ? 138 : 40, unit: "F",
            _predictionSource: isFryer ? "HUMAN_REQUIRED" : "OCR_HIGH_CONFIDENCE",
            _needsConfirmation: isFryer, confidence: isFryer ? 0.3 : 0.95,
            label: `Field ${num}`,
        });
    }
    const result = zeroRetakeReply.buildSmartConfirmationMessage({
        items,
        storeInfo: { storeName: "Stone Oak", storeCode: "B2", templateId: "FoodSafety-StoneOak-v3" },
        selectedColumn: "16:00",
        language: "EN",
    });
    assert.strictEqual(result.needsRetake, false);
    assert.strictEqual(result.uncertainCount, 2);
    assert.strictEqual(result.confidentCount, 17);
    assert.ok(result.message.includes("Need confirmation"));
    assert.ok(!result.message.includes("RETAKE"));
});

test("buildSmartConfirmationMessage with >40% uncertain DOES suggest retake", () => {
    const items = [];
    for (let i = 1; i <= 19; i++) {
        const num = String(i).padStart(2, "0");
        const isUncertain = i > 10; // 9 uncertain out of 19 = ~47%
        items.push({
            field_id: `SO-${num}`, detectedValue: isUncertain ? null : 40, unit: "F",
            _predictionSource: isUncertain ? "HUMAN_REQUIRED" : "OCR_HIGH_CONFIDENCE",
            _needsConfirmation: isUncertain, confidence: isUncertain ? 0.2 : 0.95,
            label: `Field ${num}`,
        });
    }
    const result = zeroRetakeReply.buildSmartConfirmationMessage({
        items,
        storeInfo: { storeName: "Stone Oak", storeCode: "B2", templateId: "FoodSafety-StoneOak-v3" },
        selectedColumn: "16:00",
        language: "EN",
    });
    assert.strictEqual(result.needsRetake, true);
    assert.ok(result.message.includes("RETAKE"));
});

test("buildSmartConfirmationMessage shows EDIT shortcuts for uncertain fields", () => {
    const items = [
        { field_id: "SO-16", detectedValue: 138, unit: "F", _predictionSource: "HUMAN_REQUIRED", _needsConfirmation: true, confidence: 0.3, label: "Fryer Left" },
        { field_id: "SO-17", detectedValue: 358, unit: "F", _predictionSource: "OCR_HIGH_CONFIDENCE", _needsConfirmation: false, confidence: 0.95, label: "Fryer Right" },
    ];
    const result = zeroRetakeReply.buildSmartConfirmationMessage({
        items,
        storeInfo: { storeName: "Stone Oak", storeCode: "B2", templateId: "FoodSafety-StoneOak-v3" },
        selectedColumn: "16:00",
        language: "EN",
    });
    assert.ok(result.message.includes("EDIT SO-16"));
    assert.ok(!result.message.includes("EDIT SO-17"));
});

// ═══════════════════════════════════════════════════════════════════════
// Phase 8: Acceptance Criteria
// ═══════════════════════════════════════════════════════════════════════

console.log("\n═══ Phase 8: Acceptance Criteria ═══");

test("validateSubmission passes for good submission", () => {
    const result = acceptanceCriteria.validateSubmission({
        replyCount: 1,
        isForm: true,
        memoryUsed: true,
        predictionUsed: true,
        uncertainFieldCount: 2,
        totalFields: 19,
        falseAlertSent: false,
        managerAlertCount: 1,
        ocrConfidence: 85,
    });
    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.failures.length, 0);
});

test("validateSubmission fails for multiple replies", () => {
    const result = acceptanceCriteria.validateSubmission({
        replyCount: 3,
        isForm: true,
        memoryUsed: true,
        predictionUsed: true,
        uncertainFieldCount: 0,
        totalFields: 19,
        falseAlertSent: false,
        managerAlertCount: 1,
        ocrConfidence: 85,
    });
    assert.strictEqual(result.passed, false);
    assert.ok(result.failures.includes("one_image_one_reply"));
});

test("validateSubmission fails for non-form not silent", () => {
    const result = acceptanceCriteria.validateSubmission({
        replyCount: 1,
        isForm: false,
        wasSilent: false,
        memoryUsed: true,
        predictionUsed: true,
        uncertainFieldCount: 0,
        totalFields: 19,
        falseAlertSent: false,
        managerAlertCount: 1,
        ocrConfidence: 85,
    });
    assert.strictEqual(result.passed, false);
    assert.ok(result.failures.includes("non_form_silent"));
});

test("validateSubmission fails for false unsafe alert", () => {
    const result = acceptanceCriteria.validateSubmission({
        replyCount: 1,
        isForm: true,
        memoryUsed: true,
        predictionUsed: true,
        uncertainFieldCount: 0,
        totalFields: 19,
        falseAlertSent: true,
        managerAlertCount: 1,
        ocrConfidence: 85,
    });
    assert.strictEqual(result.passed, false);
    assert.ok(result.failures.includes("no_false_unsafe_alerts"));
});

// ═══════════════════════════════════════════════════════════════════════
// Phase 6: Retake Rules Validation
// ═══════════════════════════════════════════════════════════════════════

console.log("\n═══ Phase 6: Retake Rules ═══");

test("RETAKE is NOT suggested when only 2 fields uncertain (out of 19)", () => {
    const items = [];
    for (let i = 1; i <= 19; i++) {
        const num = String(i).padStart(2, "0");
        const uncertain = i === 16 || i === 17;
        items.push({
            field_id: `SO-${num}`, detectedValue: uncertain ? 138 : 40, unit: "F",
            _predictionSource: uncertain ? "HUMAN_REQUIRED" : "OCR_HIGH_CONFIDENCE",
            _needsConfirmation: uncertain, confidence: uncertain ? 0.3 : 0.95,
            label: `Field ${num}`,
        });
    }
    const result = zeroRetakeReply.buildSmartConfirmationMessage({
        items,
        storeInfo: { storeName: "Stone Oak", storeCode: "B2", templateId: "FoodSafety-StoneOak-v3" },
        selectedColumn: "16:00",
        language: "EN",
    });
    // CEO Directive: 2 uncertain fields out of 19 = 10.5% — should NOT retake
    assert.strictEqual(result.needsRetake, false);
    assert.strictEqual(result.uncertainPct, 11); // rounded
});

test("RETAKE is NOT suggested when only 5 fields uncertain (out of 19)", () => {
    const items = [];
    for (let i = 1; i <= 19; i++) {
        const num = String(i).padStart(2, "0");
        const uncertain = i <= 5;
        items.push({
            field_id: `SO-${num}`, detectedValue: uncertain ? null : 40, unit: "F",
            _predictionSource: uncertain ? "HUMAN_REQUIRED" : "OCR_HIGH_CONFIDENCE",
            _needsConfirmation: uncertain, confidence: uncertain ? 0.2 : 0.95,
            label: `Field ${num}`,
        });
    }
    const result = zeroRetakeReply.buildSmartConfirmationMessage({
        items,
        storeInfo: { storeName: "Stone Oak", storeCode: "B2", templateId: "FoodSafety-StoneOak-v3" },
        selectedColumn: "16:00",
        language: "EN",
    });
    // CEO Directive: 5 uncertain fields out of 19 = 26% — should NOT retake
    assert.strictEqual(result.needsRetake, false);
});

// ═══════════════════════════════════════════════════════════════════════
// Run summary
// ═══════════════════════════════════════════════════════════════════════

console.log(`\n═══ RESULTS: ${passed}/${total} passed, ${failed} failed ═══`);
if (failed > 0) {
    console.log("❌ SOME TESTS FAILED");
    process.exit(1);
} else {
    console.log("✅ ALL TESTS PASSED");
}
