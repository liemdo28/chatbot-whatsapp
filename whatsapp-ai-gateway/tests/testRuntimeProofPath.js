const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.LOG_LEVEL = "error";
process.env.GATEWAY_DB_PATH = path.join(__dirname, "..", "data", "gateway-runtime-proof-test.db");
process.env.USE_GPT4O_VISION_PIPELINE = "true";
process.env.HYBRID_TRACE_ENABLED = "true";

try { fs.unlinkSync(process.env.GATEWAY_DB_PATH); } catch (_) { /* fresh test DB */ }

async function main() {
    const db = require("../src/database");
    await db.getDb();

    const storeKnowledge = require("../src/storeKnowledge");
    const openaiVision = require("../src/vision/providers/openaiVision");
    let visionCalls = 0;

    openaiVision.extractForm = async (opts) => {
        visionCalls++;
        assert.strictEqual(opts.storeInfo.storeCode, "B2");
        assert.ok(opts.traceId);
        assert.ok(opts.imageHash);
        const values = [30, 0, 35, 100, 40, 40, 0, 100, 101, 102, 39, 39, 39, 38, 40, 351, 352, 210, 210];
        return {
            available: true,
            provider: "openai",
            model: "gpt-4o",
            called: true,
            latency_ms: 12,
            openai_request_id: "req_runtime_proof_test",
            is_food_safety_form: true,
            store: "Stone Oak",
            template_id: "FoodSafety-StoneOak-v3",
            date: "2026-06-21",
            selected_column: "10AM",
            overall_confidence: 0.94,
            readings: storeKnowledge.getStoreKnowledge("B2").fields.map((field, index) => ({
                field_id: field.field_id,
                value: values[index],
                raw_text: String(values[index]),
                confidence: 0.93,
                notes: "test vision reading",
            })),
        };
    };

    const clientManager = require("../src/clientManager");
    clientManager.resetDedupForTests();

    const replies = [];
    const msg = {
        from: "b2@g.us",
        author: "employee@c.us",
        id: { _serialized: "runtime-proof-msg-1" },
        hasMedia: true,
        type: "image",
        timestamp: 1234567890,
        fromMe: false,
        body: "",
        async getChat() {
            return { isGroup: true, name: "B2 Kitchen Log" };
        },
        async downloadMedia() {
            return {
                data: Buffer.from("fake-food-safety-form-image").toString("base64"),
                mimetype: "image/jpeg",
                mediaKey: "runtime-proof-media-1",
            };
        },
        async reply(text) {
            replies.push(text);
            return { id: { _serialized: "wa-reply-runtime-proof-1" } };
        },
    };

    await clientManager._unifiedHandlerForTests(msg);

    assert.strictEqual(visionCalls, 1, "GPT-4o vision provider must be called exactly once");
    assert.strictEqual(replies.length, 1, "one submitted image must produce exactly one WhatsApp reply");
    assert.ok(replies[0].includes("Runtime proof:"));
    assert.ok(replies[0].includes("pipeline selected: gpt4o_vision_primary"));
    assert.ok(replies[0].includes("OCR provider: none/skipped"));
    assert.ok(replies[0].includes("Vision provider: openai/gpt-4o"));
    assert.ok(replies[0].includes("GPT-4o Vision called: true"));
    assert.ok(replies[0].includes("selected column: 10AM"));
    assert.ok(replies[0].includes("execution path count: 1"));
    assert.ok(replies[0].includes("WhatsApp reply count: 1"));

    const traceId = replies[0].match(/trace_id: (FS-[^\n]+)/)[1];
    const rows = db.getAll("SELECT step, status, output_summary FROM pipeline_trace_events WHERE trace_id = ? ORDER BY id ASC", [traceId]);
    const steps = rows.map((row) => row.step);
    assert.ok(steps.includes("HANDLER_SELECTED"));
    assert.ok(steps.includes("PIPELINE_SELECTED"));
    assert.ok(steps.includes("GPT4O_VISION_CALLED"));
    assert.ok(steps.includes("REPLY_BUILDER_DONE"));
    assert.ok(steps.includes("WHATSAPP_REPLY_SENT"));

    const visionRow = rows.find((row) => row.step === "GPT4O_VISION_CALLED");
    assert.strictEqual(visionRow.status, "OK");
    assert.ok(visionRow.output_summary.includes("req_runtime_proof_test"));

    const replyRow = rows.find((row) => row.step === "WHATSAPP_REPLY_SENT");
    assert.strictEqual(replyRow.status, "OK");
    assert.ok(replyRow.output_summary.includes("wa-reply-runtime-proof-1"));

    console.log("PASS runtime proof path uses one GPT-4o pipeline and one WhatsApp reply");
}

main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
});
