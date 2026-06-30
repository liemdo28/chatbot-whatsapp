const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.LOG_LEVEL = "error";
process.env.GATEWAY_DB_PATH = path.join(__dirname, "..", "data", "gateway-agent-routing-test.db");
process.env.GOOGLE_SHEET_ID = "";
process.env.GOOGLE_SERVICE_ACCOUNT_PATH = "";

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

function makeRouterTextMessage({ id, from, chatName, body }) {
    const replies = [];
    const msg = {
        from,
        body,
        id: { _serialized: id },
        type: "chat",
        hasMedia: false,
        fromMe: false,
        timestamp: Date.now(),
        async getChat() {
            return { isGroup: true, name: chatName };
        },
        async reply(text) {
            replies.push(text);
            return { id: { _serialized: "reply-" + id + "-" + replies.length } };
        },
    };
    return { msg, replies };
}

function assertFoodSafetyOnlyReply(reply, expectedStoreText) {
    assert.ok(reply.includes(expectedStoreText), "Missing expected checklist store text: " + expectedStoreText);
    assert.ok(reply.includes("Please enter 19 temperatures in order:"));
    assert.ok(!reply.includes("Agent-Coding"));
    assert.ok(!reply.includes("Please include a message after /agent"));
    assert.ok(!reply.includes("RawWebsite"));
}

async function assertExactlyOneAgentReply(clientManager, cfg) {
    clientManager.resetDedupForTests();
    const { msg, replies } = makeRouterTextMessage({
        id: "agent-lock-" + cfg.name.replace(/\W+/g, "-"),
        from: cfg.from,
        chatName: cfg.name,
        body: "/agent",
    });

    await clientManager._unifiedHandlerForTests(msg);
    await clientManager._unifiedHandlerForTests(msg);

    assert.strictEqual(replies.length, 1, "Expected exactly one reply for duplicate /agent events");
    assertFoodSafetyOnlyReply(replies[0], cfg.expected);
}

async function main() {
    const db = require("../src/database");
    await db.getDb();
    const clientManager = require("../src/clientManager");

    console.log("\n[Food Safety /agent Routing Lockdown]");

    await test("/agent in B1 returns exactly one Food Safety reply", async () => {
        await assertExactlyOneAgentReply(clientManager, {
            name: "B1 Kitchen Log",
            from: "120363349425133238@g.us",
            expected: "Store: The Rim",
        });
    });

    await test("/agent in B2 returns exactly one Food Safety reply", async () => {
        await assertExactlyOneAgentReply(clientManager, {
            name: "B2 Kitchen Log",
            from: "120363365547218966@g.us",
            expected: "Store: Stone Oak",
        });
    });

    await test("/agent in B3 returns exactly one Food Safety reply", async () => {
        await assertExactlyOneAgentReply(clientManager, {
            name: "B3 Kitchen Log",
            from: "120363365820012393@g.us",
            expected: "Store: Bandera",
        });
    });

    await test("/agent in LD Agent-Logtest returns exactly one test checklist", async () => {
        await assertExactlyOneAgentReply(clientManager, {
            name: "LD Agent-Logtest",
            from: "120363426386364543@g.us",
            expected: "Store: Test Checklist (Stone Oak)",
        });
    });

    await test("Agent-Coding prompt is not invoked for Food Safety groups", async () => {
        clientManager.resetDedupForTests();
        const { msg, replies } = makeRouterTextMessage({
            id: "agent-coding-not-invoked",
            from: "120363349425133238@g.us",
            chatName: "B1 Kitchen Log",
            body: "/agent",
        });

        await clientManager._unifiedHandlerForTests(msg);
        assert.strictEqual(replies.length, 1);
        assert.ok(!replies[0].includes("Agent-Coding"));
        assert.ok(!replies[0].includes("Please include a message after /agent"));
    });

    await test("/agent run QA RawWebsite remains untouched outside Food Safety groups", async () => {
        clientManager.resetDedupForTests();
        const { msg, replies } = makeRouterTextMessage({
            id: "outside-agent-run",
            from: "120363000000000000@g.us",
            chatName: "Agent Coding QA",
            body: "/agent run QA RawWebsite",
        });

        await clientManager._unifiedHandlerForTests(msg);
        assert.strictEqual(replies.length, 0, "Food Safety router must not consume outside Agent-Coding command");
    });

    console.log("\nResults: " + passed + " passed, " + failed + " failed");
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error("Test runner crashed:", err);
    process.exit(1);
});
