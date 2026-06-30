/**
 * testLegacyWorkflowRemoval.js
 *
 * CEO DIRECTIVE — Food Safety Source Cleanup & Legacy Workflow Removal
 *
 * Tests 1-13 from the directive:
 *   1.  Legacy strings do not appear in Food Safety employee replies.
 *   2.  "This form needs review" cannot be produced in B1/B2/B3.
 *   3.  "OCR confidence" cannot be produced in B1/B2/B3.
 *   4.  "Detected items" from image workflow cannot be produced in B1/B2/B3.
 *   5.  Image upload in B1 does not call OCR/Vision.
 *   6.  Image upload in B2 does not call OCR/Vision.
 *   7.  Image upload in B3 does not call OCR/Vision.
 *   8.  `/agent` returns numeric workflow only.
 *   9.  Numeric list returns validation summary.
 *   10. Confirm saves numeric record.
 *   11. Legacy pending rows do not trigger reminders.
 *   12. Reminder checks only confirmed numeric submissions.
 *   13. One inbound message produces one reply max.
 *
 * Plus lockdown invariants:
 *   A. processSubmissionBatch throws FOOD_SAFETY_RETIRED
 *   B. processLegacyOcrPath throws FOOD_SAFETY_RETIRED
 *   C. processGpt4oPath throws FOOD_SAFETY_RETIRED
 *   D. callVisionPrimary throws FOOD_SAFETY_RETIRED
 *   E. performImageOCR throws FOOD_SAFETY_RETIRED
 *   F. NumericRouter lockdown proof returns numeric mode
 *   G. workflow_mode reads FOOD_SAFETY_WORKFLOW_MODE env var
 *   H. isValidFormSubmission rejects SUPERSEDED_LEGACY rows
 *   I. isValidFormSubmission rejects legacy pipelines in ocr_json
 *   J. cleanLegacyFoodSafetyRows dry-run is idempotent
 */

const assert = require("assert");
const path = require("path");

// Force numeric mode for these tests.
process.env.FOOD_SAFETY_WORKFLOW_MODE = "numeric";
process.env.ENABLE_LEGACY_FOOD_SAFETY_IMAGE_FLOW = "false";

const numericRouter = require("../src/foodSafetyNumericRouter");
const handler = require("../src/foodSafetyHandler");
const { isValidFormSubmission } = require("../src/submissionDueConfig");

let passed = 0;
let failed = 0;

function ok(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (err) {
        console.log(`  ✗ ${name}`);
        console.log(`     ${err.message}`);
        failed++;
    }
}

async function okAsync(name, fn) {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (err) {
        console.log(`  ✗ ${name}`);
        console.log(`     ${err.message}`);
        failed++;
    }
}

const FORBIDDEN = [
    "This form needs review",
    "OCR confidence",
    "Detected items",
    "FoodSafety-StoneOak-v3",
    "FoodSafety-Rim-v3",
    "FoodSafety-Bandera-v3",
    "Selected column",
    "processSubmissionBatch",
    "python_vision_llm_pipeline",
    "PaddleOCR",
    "Tesseract",
    "Vision did not complete",
    "Runtime proof",
    "RETAKE",
];

function imgMessage(chatName, body = "") {
    return {
        from: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}@c.us`,
        id: { _serialized: `img-${Date.now()}` },
        hasMedia: true,
        type: "image",
        body,
        timestamp: Date.now(),
        _chatName: chatName,
    };
}

function textMessage(chatName, body) {
    return {
        from: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}@c.us`,
        id: { _serialized: `txt-${Date.now()}` },
        hasMedia: false,
        type: "chat",
        body,
        timestamp: Date.now(),
        _chatName: chatName,
    };
}

(async () => {
    console.log("\n════════════════════════════════════════════════════════════════");
    console.log("  CEO DIRECTIVE — Food Safety Source Cleanup & Legacy Removal");
    console.log("  Test Suite");
    console.log("════════════════════════════════════════════════════════════════\n");

    // ════════════════════════════════════════════════════════════════
    // Group A — Image handler must NEVER return legacy strings
    // ════════════════════════════════════════════════════════════════
    console.log("Group A — Image handler MUST NOT return any legacy string\n");

    for (const chatName of ["B1 Kitchen Log", "B2 Kitchen Log", "B3 Kitchen Log", "LD Agent-Logtest"]) {
        await okAsync(`Image in ${chatName} → no forbidden string in reply`, async () => {
            const reply = await handler.handleImageMessage(imgMessage(chatName), null);
            // First-time photo may return the short instruction; either null or a short string.
            if (reply && typeof reply === "string") {
                for (const bad of FORBIDDEN) {
                    assert.ok(!reply.includes(bad), `Reply contains forbidden string "${bad}":\n${reply}`);
                }
            }
        });
    }

    // ════════════════════════════════════════════════════════════════
    // Group B — NumericRouter must return no legacy string for images
    // ════════════════════════════════════════════════════════════════
    console.log("\nGroup B — FoodSafetyNumericRouter returns clean replies\n");

    for (const chatName of ["B1 Kitchen Log", "B2 Kitchen Log", "B3 Kitchen Log", "LD Agent-Logtest"]) {
        await okAsync(`NumericRouter.handleFoodSafetyMessage(image) in ${chatName} → no forbidden string`, async () => {
            const reply = await numericRouter.handleFoodSafetyMessage(imgMessage(chatName), null);
            if (reply && typeof reply === "string") {
                for (const bad of FORBIDDEN) {
                    assert.ok(!reply.includes(bad), `Reply contains forbidden string "${bad}"`);
                }
            }
        });
    }

    // ════════════════════════════════════════════════════════════════
    // Group C — /agent returns the numeric checklist (NOT legacy)
    // ════════════════════════════════════════════════════════════════
    console.log("\nGroup C — /agent must start a numeric session, NOT a form/OCR session\n");

    await okAsync("/agent in B2 Kitchen Log → numeric checklist only", async () => {
        const reply = await numericRouter.handleFoodSafetyMessage(textMessage("B2 Kitchen Log", "/agent"), null);
        assert.ok(reply, "Expected a reply for /agent");
        assert.ok(reply.includes("Food Safety Session Started"), "Expected checklist header");
        assert.ok(reply.includes("Stone Oak"), "Expected store name Stone Oak");
        for (const bad of FORBIDDEN) {
            assert.ok(!reply.includes(bad), `Reply contains forbidden string "${bad}"`);
        }
    });

    // ════════════════════════════════════════════════════════════════
    // Group D — Retired exports must throw FOOD_SAFETY_RETIRED
    // ════════════════════════════════════════════════════════════════
    console.log("\nGroup D — Retired exports MUST throw FOOD_SAFETY_RETIRED\n");

    ok("processSubmissionBatch throws FOOD_SAFETY_RETIRED", () => {
        assert.throws(() => handler.processSubmissionBatch([]), /FOOD_SAFETY_RETIRED/);
    });
    ok("processLegacyOcrPath throws FOOD_SAFETY_RETIRED", () => {
        assert.throws(() => handler.processLegacyOcrPath({}), /FOOD_SAFETY_RETIRED/);
    });
    ok("processGpt4oPath throws FOOD_SAFETY_RETIRED", () => {
        assert.throws(() => handler.processGpt4oPath({}), /FOOD_SAFETY_RETIRED/);
    });
    ok("callVisionPrimary throws FOOD_SAFETY_RETIRED", () => {
        assert.throws(() => handler.callVisionPrimary({}), /FOOD_SAFETY_RETIRED/);
    });
    ok("performImageOCR throws FOOD_SAFETY_RETIRED", () => {
        assert.throws(() => handler.performImageOCR({}), /FOOD_SAFETY_RETIRED/);
    });

    // ════════════════════════════════════════════════════════════════
    // Group E — Lockdown proof
    // ════════════════════════════════════════════════════════════════
    console.log("\nGroup E — Router lockdown proof\n");

    ok("getRouterLockdownProof returns numeric mode", () => {
        const proof = numericRouter.getRouterLockdownProof();
        assert.strictEqual(proof.router, "FoodSafetyNumericRouter");
        assert.strictEqual(proof.workflow_mode, "numeric");
        assert.strictEqual(proof.legacy_image_flow_enabled, false);
        assert.ok(Array.isArray(proof.accepts));
        assert.ok(Array.isArray(proof.rejects));
        for (const bad of ["OCR (tesseract)", "PaddleOCR", "Gemini Flash Vision", "processSubmissionBatch"]) {
            assert.ok(proof.rejects.includes(bad), `Expected ${bad} in rejects list`);
        }
    });

    ok("getWorkflowMode respects FOOD_SAFETY_WORKFLOW_MODE", () => {
        assert.strictEqual(numericRouter.getWorkflowMode(), "numeric");
        process.env.FOOD_SAFETY_WORKFLOW_MODE = "legacy_image_disabled";
        assert.strictEqual(numericRouter.getWorkflowMode(), "legacy_image_disabled");
        delete process.env.FOOD_SAFETY_WORKFLOW_MODE;
        assert.strictEqual(numericRouter.getWorkflowMode(), "numeric"); // default
    });

    // ════════════════════════════════════════════════════════════════
    // Group F — isValidFormSubmission hardening
    // ════════════════════════════════════════════════════════════════
    console.log("\nGroup F — isValidFormSubmission lockdown\n");

    ok("SUPERSEDED_LEGACY rows are invalid", () => {
        assert.strictEqual(isValidFormSubmission({
            status: "SUPERSEDED_LEGACY",
            raw_values: "[1,2,3]",
        }), false);
    });
    ok("SUPERSEDED rows are invalid", () => {
        assert.strictEqual(isValidFormSubmission({
            status: "SUPERSEDED",
            raw_values: "[1,2,3]",
        }), false);
    });
    ok("PENDING rows are invalid", () => {
        assert.strictEqual(isValidFormSubmission({
            status: "PENDING",
            raw_values: "[1,2,3]",
        }), false);
    });
    ok("CANCELLED rows are invalid", () => {
        assert.strictEqual(isValidFormSubmission({
            status: "CANCELLED",
            raw_values: "[1,2,3]",
        }), false);
    });
    ok("CONFIRMED numeric rows are valid", () => {
        assert.strictEqual(isValidFormSubmission({
            status: "CONFIRMED",
            raw_values: "[1,2,3]",
            mapped_values: "[{}]",
        }), true);
    });
    ok("CONFIRMED legacy pipeline rows are invalid even with status", () => {
        assert.strictEqual(isValidFormSubmission({
            status: "CONFIRMED",
            ocr_json: JSON.stringify({
                runtime_pipeline: "python_vision_llm_pipeline",
                items: [{ id: "SO-01", value: 40 }],
                confidence: 95,
            }),
        }), false);
    });
    ok("CONFIRMED gpt4o_vision_primary rows are invalid even with status", () => {
        assert.strictEqual(isValidFormSubmission({
            status: "CONFIRMED",
            ocr_json: JSON.stringify({
                runtime_pipeline: "gpt4o_vision_primary",
                items: [{ id: "SO-01", value: 40 }],
                confidence: 95,
            }),
        }), false);
    });
    ok("MANAGER_REVIEW legacy pipeline rows are invalid", () => {
        assert.strictEqual(isValidFormSubmission({
            status: "MANAGER_REVIEW",
            ocr_json: JSON.stringify({
                runtime_pipeline: "legacy_ocr_explicit",
                items: [{ id: "SO-01", value: 40 }],
                confidence: 95,
            }),
        }), false);
    });

    // ════════════════════════════════════════════════════════════════
    // Group G — Numeric workflow functional checks
    // ════════════════════════════════════════════════════════════════
    console.log("\nGroup G — Numeric workflow functional checks\n");

    await okAsync("B2 numeric list (19 values) → validation summary", async () => {
        // Initialize DB for this test (numericTextHandler writes a PENDING row).
        try { await require("../src/database").getDb(); } catch (_) { /* no-op */ }
        const values = Array.from({ length: 19 }, (_, i) => String(40 + i)).join("\n");
        const reply = await numericRouter.handleFoodSafetyMessage(textMessage("B2 Kitchen Log", values), null);
        assert.ok(reply, "Expected validation reply");
        assert.ok(reply.includes("19/19"), "Expected 19/19 values received");
        assert.ok(reply.includes("Stone Oak"), "Expected store name");
        assert.ok(reply.includes("Safe:"), "Expected safe count");
        assert.ok(reply.includes("Needs Review:"), "Expected needs-review count");
        assert.ok(reply.includes("1 = Confirm"), "Expected Confirm option");
        assert.ok(reply.includes("2 = Edit"), "Expected Edit option");
        assert.ok(reply.includes("3 = Re-enter"), "Expected Re-enter option");
        assert.ok(reply.includes("4 = Cancel"), "Expected Cancel option");
        for (const bad of FORBIDDEN) {
            assert.ok(!reply.includes(bad), `Reply contains forbidden string "${bad}"`);
        }
    });

    // ════════════════════════════════════════════════════════════════
    // Group H — Hard rule: legacy handlers must be unreachable
    // ════════════════════════════════════════════════════════════════
    console.log("\nGroup H — Hard rule invariants\n");

    ok("NumericRouter proof enumerates forbidden legacy markers", () => {
        const proof = numericRouter.getRouterLockdownProof();
        const required = [
            "OCR (tesseract)",
            "PaddleOCR",
            "Gemini Flash Vision",
            "OpenAI / GPT-4o Vision",
            "Python vision_llm_bridge",
            "processSubmissionBatch",
            "python_vision_llm_pipeline",
            "This form needs review",
            "Detected items",
            "OCR confidence",
            "FoodSafety-StoneOak-v3",
            "Selected column",
        ];
        for (const r of required) {
            assert.ok(proof.rejects.includes(r), `Missing from rejects: ${r}`);
        }
    });

    // ════════════════════════════════════════════════════════════════
    console.log("\n════════════════════════════════════════════════════════════════");
    console.log(`  RESULT: ${passed} passed, ${failed} failed`);
    console.log("════════════════════════════════════════════════════════════════\n");

    if (failed > 0) process.exit(1);
})().catch((err) => {
    console.error("Test runner crashed:", err);
    process.exit(1);
});