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

    const openaiVision = require("../src/vision/providers/openaiVision");
    const { PHOTO_WORKFLOW_RETIRED_REPLY } = require("../src/foodSafetyPilotGuard");
    let visionCalls = 0;

    openaiVision.extractForm = async () => {
        visionCalls++;
        throw new Error("Vision must not be called for pilot group images");
    };

    const clientManager = require("../src/clientManager");
    clientManager.resetDedupForTests();

    let downloadCalls = 0;
    const replies = [];
    const msg = {
        from: "120363365547218966@g.us",
        author: "employee@c.us",
        id: { _serialized: "runtime-proof-retired-msg-1" },
        hasMedia: true,
        type: "image",
        timestamp: 1234567890,
        fromMe: false,
        body: "",
        async getChat() {
            return { isGroup: true, name: "B2 Kitchen Log" };
        },
        async downloadMedia() {
            downloadCalls++;
            throw new Error("downloadMedia must not be called for pilot group images");
        },
        async reply(text) {
            replies.push(text);
            return { id: { _serialized: "wa-reply-runtime-proof-retired-1" } };
        },
    };

    await clientManager._unifiedHandlerForTests(msg);

    assert.strictEqual(downloadCalls, 0, "pilot photo must be rejected before media download");
    assert.strictEqual(visionCalls, 0, "pilot photo must not call GPT-4o/OpenAI Vision");
    assert.strictEqual(replies.length, 1, "one pilot photo should produce one operational instruction reply");
    assert.strictEqual(replies[0], PHOTO_WORKFLOW_RETIRED_REPLY);
    assert.ok(!replies[0].includes("Runtime proof:"));
    assert.ok(!replies[0].includes("python_vision_llm_pipeline"));
    assert.ok(!replies[0].includes("provider_used"));
    assert.ok(!replies[0].includes("trace_id"));
    assert.ok(!replies[0].includes("Vision did not complete"));

    console.log("PASS runtime proof path retired for pilot group images");
}

main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
});
