/**
 * test_handwriting_memory.js - Phase 14: Required Tests
 * Run: node tests/test_handwriting_memory.js
 */

const path = require("path");
process.chdir(path.join(__dirname, ".."));

const db = require("../src/database");
const { predictSingleField, SOURCES } = require("../src/handwriting/predictionEngine");
const { getAccuracyMetrics } = require("../src/handwriting/api");
const { initHandwritingTables } = require("../src/handwriting/dbSchema");
const { getTotalSampleCount, getSampleCountByStore } = require("../src/handwriting/confirmedSamples");
const { searchMemory } = require("../src/handwriting/memorySearch");

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log("  PASS: " + name);
        passed++;
    } catch (err) {
        console.error("  FAIL: " + name + " - " + err.message);
        failed++;
    }
}

function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
        throw new Error((msg || "Mismatch") + " - expected " + expected + ", got " + actual);
    }
}

async function runTests() {
    console.log("\n=== Handwriting Memory System Tests ===\n");

    await db.getDb();
    initHandwritingTables();

    // Phase 3: Feature Extraction
    console.log("Phase 3: Feature Extraction");
    test("fingerprintSimilarity: identical = 1.0", function () {
        const { fingerprintSimilarity } = require("../src/handwriting/featureExtraction");
        const sim = fingerprintSimilarity("aabbccdd", "aabbccdd");
        assertEqual(sim, 1.0);
    });

    test("fingerprintSimilarity: different < 0.3", function () {
        const { fingerprintSimilarity } = require("../src/handwriting/featureExtraction");
        const sim = fingerprintSimilarity("00000000", "ffffffff");
        assertEqual(sim < 0.3, true);
    });

    test("cosineSimilarity: identical vectors = 1.0", function () {
        const { cosineSimilarity } = require("../src/handwriting/featureExtraction");
        const sim = cosineSimilarity([1, 0, 1, 0], [1, 0, 1, 0]);
        assertEqual(sim, 1.0);
    });

    // Phase 5: Prediction Engine
    console.log("\nPhase 5: Prediction Engine");

    test("Rule 1: OCR high conf + in range = OCR_HIGH_CONFIDENCE", function () {
        const result = predictSingleField({
            ocrValue: 30,
            ocrItemConfidence: 95,
            ocrOverallConfidence: 90,
            fieldRange: { min: 30, max: 45 },
            fieldId: "SO-01",
            bestMatch: null,
            memoryMatchCount: 0,
            item: {},
        });
        assertEqual(result.prediction_source, SOURCES.OCR_HIGH_CONFIDENCE);
        assertEqual(result.final_suggested_value, 30);
        assertEqual(result.needs_confirmation, false);
    });

    test("Rule 3: OCR out-of-range + memory strong = MEMORY_ASSISTED", function () {
        const result = predictSingleField({
            ocrValue: 7,
            ocrItemConfidence: 50,
            ocrOverallConfidence: 50,
            fieldRange: { min: 30, max: 45 },
            fieldId: "SO-01",
            bestMatch: { confirmed_value: "35", similarity_score: 0.85 },
            memoryMatchCount: 3,
            item: {},
        });
        assertEqual(result.prediction_source, SOURCES.MEMORY_ASSISTED);
        assertEqual(result.final_suggested_value, 35);
        assertEqual(result.needs_confirmation, true);
    });

    test("Rule 4: No OCR + memory strong = MEMORY_ASSISTED", function () {
        const result = predictSingleField({
            ocrValue: null,
            ocrItemConfidence: 0,
            ocrOverallConfidence: 0,
            fieldRange: { min: 30, max: 45 },
            fieldId: "SO-01",
            bestMatch: { confirmed_value: "32", similarity_score: 0.8 },
            memoryMatchCount: 2,
            item: {},
        });
        assertEqual(result.prediction_source, SOURCES.MEMORY_ASSISTED);
        assertEqual(result.final_suggested_value, 32);
    });

    test("Rule 7: OCR OOR + no memory = needs confirmation", function () {
        const result = predictSingleField({
            ocrValue: 0,
            ocrItemConfidence: 40,
            ocrOverallConfidence: 40,
            fieldRange: { min: 30, max: 45 },
            fieldId: "SO-03",
            bestMatch: null,
            memoryMatchCount: 0,
            item: {},
        });
        assertEqual(result.needs_confirmation, true);
    });

    test("Safe auto-confirm: OCR 95% + in range", function () {
        const result = predictSingleField({
            ocrValue: 32,
            ocrItemConfidence: 95,
            ocrOverallConfidence: 95,
            fieldRange: { min: 30, max: 45 },
            fieldId: "SO-01",
            bestMatch: null,
            memoryMatchCount: 0,
            item: {},
        });
        assertEqual(result.needs_confirmation, false);
    });

    // Phase 4: Memory Search
    console.log("\nPhase 4: Memory Search");

    test("searchMemory returns array", async function () {
        const matches = await searchMemory({ store_code: "B999", field_id: "SO-99", limit: 5 });
        assertEqual(Array.isArray(matches), true);
    });

    test("searchMemory respects limit", async function () {
        const matches = await searchMemory({ store_code: "B999", field_id: "SO-99", limit: 3 });
        assertEqual(matches.length <= 3, true);
    });

    // Phase 2: Confirmed Samples
    console.log("\nPhase 2: Confirmed Samples");

    test("getTotalSampleCount returns number", function () {
        const count = getTotalSampleCount();
        assertEqual(typeof count, "number");
    });

    test("getSampleCountByStore returns array", function () {
        const counts = getSampleCountByStore();
        assertEqual(Array.isArray(counts), true);
    });

    // Phase 12: API / Accuracy
    console.log("\nPhase 12: API / Accuracy");

    test("getAccuracyMetrics returns object", function () {
        const metrics = getAccuracyMetrics("overall");
        assertEqual(typeof metrics, "object");
        assertEqual(typeof metrics.total, "number");
    });

    test("getAccuracyMetrics handles empty DB", function () {
        const metrics = getAccuracyMetrics("empty");
        assertEqual(metrics.total === 0 || metrics.samples === 0, true);
    });

    // Phase 1: Cell Crop Storage
    console.log("\nPhase 1: Cell Crop Storage");

    test("cellCropStorage module loads", function () {
        const ccs = require("../src/handwriting/cellCropStorage");
        assertEqual(typeof ccs.saveCellCrop, "function");
        assertEqual(typeof ccs.getTotalCropCount, "function");
    });

    // Phase 9: Sample Importer
    console.log("\nPhase 9: Sample Importer");

    test("sampleImporter validates store_code required", async function () {
        const si = require("../src/handwriting/sampleImporter");
        const result = await si.importSample({ store_code: "", ground_truth: {} });
        assertEqual(result.success, false);
        assertEqual(result.error.indexOf("store_code") >= 0, true);
    });

    test("sampleImporter validates ground_truth required", async function () {
        const si = require("../src/handwriting/sampleImporter");
        const result = await si.importSample({ store_code: "B2", ground_truth: {} });
        assertEqual(result.success, false);
    });

    // Summary
    console.log("\n=== Results: " + passed + " passed, " + failed + " failed ===\n");
    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(function (err) {
    console.error("Test runner error: " + err);
    process.exit(1);
});
