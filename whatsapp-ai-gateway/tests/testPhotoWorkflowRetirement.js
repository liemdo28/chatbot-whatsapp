const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.LOG_LEVEL = "error";
process.env.GATEWAY_DB_PATH = path.join(__dirname, "..", "data", "gateway-photo-retirement-test.db");
process.env.GOOGLE_SHEET_ID = "";
process.env.GOOGLE_SERVICE_ACCOUNT_PATH = "";
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;

try { fs.unlinkSync(process.env.GATEWAY_DB_PATH); } catch (_) { /* fresh */ }

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await Promise.race([
            fn(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("test timeout")), 10000)),
        ]);
        passed++;
        console.log("  PASS " + name);
    } catch (err) {
        failed++;
        console.log("  FAIL " + name);
        console.log("      " + (err.stack || err.message));
    }
}

function makeTextMessage({ body, from, chatName }) {
    return {
        from: from || "12105550100@g.us",
        body,
        id: { _serialized: "txt-" + Date.now() + "-" + Math.random() },
        type: "chat",
        hasMedia: false,
        timestamp: Date.now(),
        _chatName: chatName || "B2 Kitchen Log",
    };
}

function makeImageMessage({ from, chatName, onDownload }) {
    return {
        from: from || "12105550200@g.us",
        body: "",
        id: { _serialized: "img-" + Date.now() + "-" + Math.random() },
        type: "image",
        hasMedia: true,
        timestamp: Date.now(),
        _chatName: chatName,
        downloadMedia: async () => {
            if (onDownload) onDownload();
            return { data: Buffer.from("fake-image").toString("base64"), mimetype: "image/jpeg" };
        },
    };
}

const valid19 = "33\n-2\n35\n110\n40\n40\n-3\n100\n101\n102\n39\n35\n35\n38\n40\n352\n353\n210\n211";
const valid19Comma = "33, -2, 35, 110, 40, 40, -3, 100, 101, 102, 39, 35, 35, 38, 40, 352, 353, 210, 211";
const valid19Space = "33 -2 35 110 40 40 -3 100 101 102 39 35 35 38 40 352 353 210 211";

function assertNoTechnicalText(reply) {
    const forbidden = [
        "OPENAI_API_KEY",
        "Vision did not complete",
        "python_vision_llm_pipeline",
        "provider_used",
        "trace_id",
        "decision_engine_final",
        "store resolver unresolved",
        "runtime proof",
        "GPT-4o",
        "Gemini",
        "Claude",
        "Tesseract",
        "PaddleOCR",
    ];
    for (const term of forbidden) {
        assert.ok(!reply.includes(term), "Employee reply leaked technical text: " + term);
    }
}

async function main() {
    const db = require("../src/database");
    await db.getDb();

    const handler = require("../src/foodSafetyHandler");
    const clientManager = require("../src/clientManager");
    const gsheet = require("../src/googleSheet");
    const openaiVision = require("../src/vision/providers/openaiVision");
    const { PHOTO_WORKFLOW_RETIRED_REPLY } = require("../src/foodSafetyPilotGuard");

    async function assertPhotoRetired(chatName) {
        let mediaDownloaded = false;
        let ocrCalled = false;
        let visionCalled = false;

        const originalExtract = openaiVision.extractForm;
        openaiVision.extractForm = async () => {
            visionCalled = true;
            throw new Error("VISION_CALLED");
        };
        handler.setOcrProcessorForTests(async () => {
            ocrCalled = true;
            throw new Error("OCR_CALLED");
        });

        try {
            const reply = await handler.handleImageMessage(makeImageMessage({
                chatName,
                onDownload: () => { mediaDownloaded = true; },
            }), null);

            assert.strictEqual(reply, PHOTO_WORKFLOW_RETIRED_REPLY);
            assert.strictEqual(mediaDownloaded, false, "pilot photo should not download media");
            assert.strictEqual(ocrCalled, false, "pilot photo should not call OCR");
            assert.strictEqual(visionCalled, false, "pilot photo should not call Vision");
            assert.ok(reply.includes("Food Safety photo processing is no longer used for this pilot."));
            assert.ok(reply.includes("Please use the new workflow:"));
            assert.ok(reply.includes("1. Type /agent"));
            assert.ok(reply.includes("4. Reply 1 to confirm"));
            assert.ok(reply.includes("Paper forms should still be completed and kept for records."));
            assertNoTechnicalText(reply);
        } finally {
            openaiVision.extractForm = originalExtract;
            handler.resetProcessingCachesForTests();
        }
    }

    console.log("\n[Photo Workflow Retirement Guard]");

    await test("image sent in B1 does not call Vision/OCR", async () => {
        await assertPhotoRetired("B1 Kitchen Log");
    });

    await test("image sent in B2 does not call Vision/OCR", async () => {
        await assertPhotoRetired("B2 Kitchen Log");
    });

    await test("image sent in B3 does not call Vision/OCR", async () => {
        await assertPhotoRetired("B3 Kitchen Log");
    });

    await test("image sent in LD Agent-Logtest does not call Vision/OCR", async () => {
        await assertPhotoRetired("LD Agent-Logtest");
    });

    await test("photo reply shows Option C instruction without runtime proof", async () => {
        const reply = await handler.handleImageMessage(makeImageMessage({ chatName: "B2 Kitchen Log" }), null);
        assert.strictEqual(reply, PHOTO_WORKFLOW_RETIRED_REPLY);
        assertNoTechnicalText(reply);
    });

    await test("live router rejects B2 photo before media download", async () => {
        let mediaDownloaded = false;
        let replyText = "";
        const msg = {
            from: "120363365547218966@g.us",
            body: "",
            id: { _serialized: "router-img-" + Date.now() },
            type: "image",
            hasMedia: true,
            fromMe: false,
            timestamp: Date.now(),
            getChat: async () => ({ name: "B2 Kitchen Log" }),
            downloadMedia: async () => {
                mediaDownloaded = true;
                throw new Error("downloadMedia should not run for pilot photos");
            },
            reply: async (text) => {
                replyText = text;
                return { id: { _serialized: "router-reply-" + Date.now() } };
            },
        };

        await clientManager._unifiedHandlerForTests(msg);
        assert.strictEqual(mediaDownloaded, false);
        assert.strictEqual(replyText, PHOTO_WORKFLOW_RETIRED_REPLY);
        assertNoTechnicalText(replyText);
    });

    console.log("\n[Option C Continuity]");

    await test("/agent still returns B1 The Rim checklist", async () => {
        const reply = await handler.handleTextMessage(makeTextMessage({
            body: "/agent",
            from: "12105550301@g.us",
            chatName: "B1 Kitchen Log",
        }), null);
        assert.ok(reply.includes("Store: The Rim"));
        assert.ok(reply.includes("Please enter 19 temperatures in order:"));
    });

    await test("/agent still returns B2 Stone Oak checklist", async () => {
        const reply = await handler.handleTextMessage(makeTextMessage({
            body: "/agent",
            from: "12105550302@g.us",
            chatName: "B2 Kitchen Log",
        }), null);
        assert.ok(reply.includes("Store: Stone Oak"));
        assert.ok(reply.includes("Please enter 19 temperatures in order:"));
    });

    await test("/agent still returns B3 Bandera checklist", async () => {
        const reply = await handler.handleTextMessage(makeTextMessage({
            body: "/agent",
            from: "12105550303@g.us",
            chatName: "B3 Kitchen Log",
        }), null);
        assert.ok(reply.includes("Store: Bandera"));
        assert.ok(reply.includes("Please enter 19 temperatures in order:"));
    });

    await test("numeric text newline/comma/space formats still work", async () => {
        for (const [idx, body] of [valid19, valid19Comma, valid19Space].entries()) {
            const reply = await handler.handleTextMessage(makeTextMessage({
                body,
                from: "1210555040" + idx + "@g.us",
                chatName: "B2 Kitchen Log",
            }), null);
            assert.ok(reply.includes("Store: Stone Oak"));
            assert.ok(reply.includes("19/19 values received"));
            assert.ok(reply.includes("1 = Confirm"));
            assert.ok(reply.includes("2 = Edit"));
            assert.ok(reply.includes("3 = Re-enter All"));
            assert.ok(reply.includes("4 = Cancel"));
        }
    });

    await test("confirm still saves and calls Google Sheet sync", async () => {
        const originalSync = gsheet.syncSubmission;
        let syncCalls = 0;
        gsheet.syncSubmission = async () => {
            syncCalls++;
            return { status: "OK" };
        };

        try {
            const phone = "12105550500@g.us";
            const session = handler.getSession(phone);
            session.pendingSubmission = null;
            session.waitingFor = null;

            const summary = await handler.handleTextMessage(makeTextMessage({
                body: valid19,
                from: phone,
                chatName: "B2 Kitchen Log",
            }), null);
            assert.ok(summary.includes("19/19 values received"));
            const subId = session.pendingSubmission.id;

            const confirm = await handler.handleTextMessage(makeTextMessage({
                body: "1",
                from: phone,
                chatName: "B2 Kitchen Log",
            }), null);
            assert.ok(confirm.includes("Record saved successfully"));
            await new Promise((resolve) => setTimeout(resolve, 25));

            const saved = db.getSubmission(subId);
            assert.strictEqual(saved.status, "CONFIRMED");
            assert.strictEqual(syncCalls, 1);
            assert.strictEqual(saved.sheetsync_status, "SYNCED");
            assert.strictEqual(saved.google_sheet_synced, 1);
        } finally {
            gsheet.syncSubmission = originalSync;
        }
    });

    console.log("\nResults: " + passed + " passed, " + failed + " failed");
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error("Test runner crashed:", err);
    process.exit(1);
});
