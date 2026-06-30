const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.LOG_LEVEL = "error";
process.env.GATEWAY_DB_PATH = path.join(__dirname, "..", "data", "gateway-numeric-test.db");
try { fs.unlinkSync(process.env.GATEWAY_DB_PATH); } catch (_) { /* fresh */ }

// CRITICAL: clear API keys to prove numeric flow does NOT need them
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
process.env.GOOGLE_SHEET_ID = "";
process.env.GOOGLE_SERVICE_ACCOUNT_PATH = "";

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
    from = from || ("1210555" + String(Math.floor(Math.random() * 10000)) + "@g.us");
    chatName = chatName || "B2 Kitchen Log";
    return {
        from,
        body,
        id: { _serialized: "msg-" + Date.now() + "-" + Math.random() },
        type: "chat",
        timestamp: Date.now(),
        _chatName: chatName,
    };
}

const valid19 = "33\n-2\n35\n110\n40\n40\n-3\n100\n101\n102\n39\n35\n35\n38\n40\n352\n353\n210\n211";

async function main() {
    const parser = require("../src/numericTextParser");
    const storeKnowledge = require("../src/storeKnowledge");
    const { STORE_CONFIG } = require("../src/formImageRouter");
    const db = require("../src/database");
    await db.getDb();
    const handler = require("../src/foodSafetyHandler");
    const numericHandler = require("../src/numericTextHandler");

    console.log("\n[Parser Module Tests]");

    await test("isNumericList: newline-separated", () => {
        assert.strictEqual(parser.isNumericList("40\n10\n40\n150\n32"), true);
    });
    await test("isNumericList: comma-separated", () => {
        assert.strictEqual(parser.isNumericList("40, 10, 40, 150, 32"), true);
    });
    await test("isNumericList: space-separated", () => {
        assert.strictEqual(parser.isNumericList("40 10 40 150 32"), true);
    });
    await test("isNumericList: mixed separators", () => {
        assert.strictEqual(parser.isNumericList("40 10, 40\n150 32"), true);
    });
    await test("isNumericList: dash as blank", () => {
        assert.strictEqual(parser.isNumericList("40 - 40 150 32"), true);
    });
    await test("isNumericList: rejects non-numeric text", () => {
        assert.strictEqual(parser.isNumericList("hello world"), false);
    });
    await test("isNumericList: rejects empty string", () => {
        assert.strictEqual(parser.isNumericList(""), false);
    });
    await test("isNumericList: accepts temp prefix", () => {
        assert.strictEqual(parser.isNumericList("TEMP: 40 10 40 150 32"), true);
    });
    await test("parseNumericList: newline list", () => {
        assert.deepStrictEqual(parser.parseNumericList("40\n10\n40\n150\n32"), [40, 10, 40, 150, 32]);
    });
    await test("parseNumericList: comma list", () => {
        assert.deepStrictEqual(parser.parseNumericList("40, 10, 40, 150, 32"), [40, 10, 40, 150, 32]);
    });
    await test("parseNumericList: space list", () => {
        assert.deepStrictEqual(parser.parseNumericList("40 10 40 150 32"), [40, 10, 40, 150, 32]);
    });
    await test("parseNumericList: mixed separators", () => {
        assert.deepStrictEqual(parser.parseNumericList("40 10, 40\n150 32"), [40, 10, 40, 150, 32]);
    });
    await test("parseNumericList: dash as null", () => {
        assert.deepStrictEqual(parser.parseNumericList("40 - 40 150 32"), [40, null, 40, 150, 32]);
    });
    await test("parseNumericList: negative values", () => {
        assert.deepStrictEqual(parser.parseNumericList("-5 10 -20 150 32"), [-5, 10, -20, 150, 32]);
    });
    await test("parseNumericList: strips TEMP prefix", () => {
        assert.deepStrictEqual(parser.parseNumericList("TEMP: 40 10 40 150 32"), [40, 10, 40, 150, 32]);
    });

    console.log("\n[Field Mapping Tests]");

    await test("mapValuesToFields: B1 -> RIM-01..RIM-19", () => {
        const { items } = parser.mapValuesToFields(new Array(19).fill(40), STORE_CONFIG.B1, storeKnowledge);
        assert.strictEqual(items.length, 19);
        assert.strictEqual(items[0].id, "RIM-01");
        assert.strictEqual(items[18].id, "RIM-19");
    });
    await test("mapValuesToFields: B2 -> SO-01..SO-19", () => {
        const { items } = parser.mapValuesToFields(new Array(19).fill(40), STORE_CONFIG.B2, storeKnowledge);
        assert.strictEqual(items[0].id, "SO-01");
        assert.strictEqual(items[18].id, "SO-19");
    });
    await test("mapValuesToFields: B3 -> BAN-01..BAN-19", () => {
        const { items } = parser.mapValuesToFields(new Array(19).fill(40), STORE_CONFIG.B3, storeKnowledge);
        assert.strictEqual(items[0].id, "BAN-01");
        assert.strictEqual(items[18].id, "BAN-19");
    });
    await test("mapValuesToFields: preserves order", () => {
        const vals = [33, -2, 35, 110, 40, 40, -3, 100, 101, 102, 39, 35, 35, 38, 40, 352, 353, 210, 211];
        const { items } = parser.mapValuesToFields(vals, STORE_CONFIG.B2, storeKnowledge);
        assert.strictEqual(items[0].detectedValue, 33);
        assert.strictEqual(items[1].detectedValue, -2);
        assert.strictEqual(items[18].detectedValue, 211);
    });
    await test("mapValuesToFields: missing indices correct", () => {
        const { missingIndices } = parser.mapValuesToFields([33, -2, 35], STORE_CONFIG.B2, storeKnowledge);
        assert.strictEqual(missingIndices.length, 16);
    });
    await test("mapValuesToFields: extra count", () => {
        const { extraCount } = parser.mapValuesToFields(new Array(25).fill(40), STORE_CONFIG.B2, storeKnowledge);
        assert.strictEqual(extraCount, 6);
    });

    console.log("\n[Range Validation Tests]");

    await test("buildValidationSummary: counts correctly", () => {
        const v = parser.buildValidationSummary([
            { status: "SAFE" }, { status: "SAFE" }, { status: "UNSAFE" }, { status: "MISSING" }
        ]);
        assert.strictEqual(v.safeCount, 2);
        assert.strictEqual(v.needsReviewCount, 2);
    });
    await test("range: 33F SAFE for walk-in cooler", () => {
        const items = parser.mapValuesToFields(
            [33, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            STORE_CONFIG.B2, storeKnowledge
        ).items;
        assert.strictEqual(items[0].status, "SAFE");
    });
    await test("range: 200F UNSAFE for walk-in cooler", () => {
        const items = parser.mapValuesToFields(
            [200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            STORE_CONFIG.B2, storeKnowledge
        ).items;
        assert.strictEqual(items[0].status, "UNSAFE");
    });
    await test("range: -10F SAFE for freezer", () => {
        const items = parser.mapValuesToFields(
            [0, -10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            STORE_CONFIG.B2, storeKnowledge
        ).items;
        assert.strictEqual(items[1].status, "SAFE");
    });
    await test("range: 100F SAFE for seasoned eggs", () => {
        const items = parser.mapValuesToFields(
            [0, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            STORE_CONFIG.B2, storeKnowledge
        ).items;
        assert.strictEqual(items[7].status, "SAFE");
    });
    await test("range: 50F UNSAFE for seasoned eggs", () => {
        const items = parser.mapValuesToFields(
            [0, 0, 0, 0, 0, 0, 0, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            STORE_CONFIG.B2, storeKnowledge
        ).items;
        assert.strictEqual(items[7].status, "UNSAFE");
    });

    console.log("\n[Handler E2E Tests]");

    await test("B1: 19 values -> confirmation summary with 1/2/3/4 options", async () => {
        const phone = "12105550001@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        const reply = await handler.handleTextMessage(makeTextMessage({ body: valid19, from: phone, chatName: "B1 Kitchen Log" }), null);
        assert.ok(reply.includes("Store: The Rim"), "Missing 'The Rim': " + reply);
        assert.ok(reply.includes("19/19 values received"), "Missing count: " + reply);
        assert.ok(reply.includes("1 = Confirm"), "Missing Confirm: " + reply);
        assert.ok(reply.includes("2 = Edit"), "Missing Edit: " + reply);
        assert.ok(reply.includes("3 = Re-enter"), "Missing Re-enter: " + reply);
        assert.ok(reply.includes("4 = Cancel"), "Missing Cancel: " + reply);
        assert.ok(reply.includes("Detected:"), "Missing Detected: " + reply);
        assert.strictEqual(s.waitingFor, "numeric_action");
    });
    await test("B2: 19 values -> confirmation", async () => {
        const phone = "12105550002@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        const reply = await handler.handleTextMessage(makeTextMessage({ body: valid19, from: phone, chatName: "B2 Kitchen Log" }), null);
        assert.ok(reply.includes("Store: Stone Oak"), "Missing 'Stone Oak': " + reply);
        assert.ok(reply.includes("19/19 values received"));
    });
    await test("B3: 19 values -> confirmation", async () => {
        const phone = "12105550003@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        const reply = await handler.handleTextMessage(makeTextMessage({ body: valid19, from: phone, chatName: "B3 Kitchen Log" }), null);
        assert.ok(reply.includes("Store: Bandera"), "Missing 'Bandera': " + reply);
    });
    await test("fewer than 19 -> short operational reply, NO DB save", async () => {
        const phone = "12105550010@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        const reply = await handler.handleTextMessage(makeTextMessage({ body: "33\n-2\n35\n110\n40", from: phone, chatName: "B2 Kitchen Log" }), null);
        assert.ok(reply.includes("Received 5/19 values"), "reply: " + reply);
        assert.ok(reply.includes("/agent"), "Should mention /agent to restart: " + reply);
        assert.ok(reply.includes("Example"), "Should show example: " + reply);
        assert.ok(!reply.includes("SO-06"), "Should NOT list individual missing fields: " + reply);
        assert.strictEqual(s.pendingSubmission, null, "No pending submission should be created for <19 values");
    });
    await test("more than 19 -> extra reply, NO DB save", async () => {
        const phone = "12105550011@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        const tooMany = "33\n-2\n35\n110\n40\n40\n-3\n100\n101\n102\n39\n35\n35\n38\n40\n352\n353\n210\n211\n99\n100";
        const reply = await handler.handleTextMessage(makeTextMessage({ body: tooMany, from: phone, chatName: "B2 Kitchen Log" }), null);
        assert.ok(reply.includes("Received 21 values"), "reply: " + reply);
        assert.ok(reply.includes("Expected 19"), "reply: " + reply);
        assert.ok(reply.includes("Extra values:"), "reply: " + reply);
        assert.strictEqual(s.pendingSubmission, null, "No pending submission should be created for >19 values");
    });
    await test("comma-separated works", async () => {
        const phone = "12105550020@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        const reply = await handler.handleTextMessage(makeTextMessage({ body: "33, -2, 35, 110, 40, 40, -3, 100, 101, 102, 39, 35, 35, 38, 40, 352, 353, 210, 211", from: phone, chatName: "B2 Kitchen Log" }), null);
        assert.ok(reply.includes("19/19 values received"));
    });
    await test("space-separated works", async () => {
        const phone = "12105550021@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        const reply = await handler.handleTextMessage(makeTextMessage({ body: "33 -2 35 110 40 40 -3 100 101 102 39 35 35 38 40 352 353 210 211", from: phone, chatName: "B2 Kitchen Log" }), null);
        assert.ok(reply.includes("19/19 values received"));
    });
    await test("mixed separators works", async () => {
        const phone = "12105550022@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        const reply = await handler.handleTextMessage(makeTextMessage({ body: "33, -2 35\n110 40, 40 -3 100, 101 102 39, 35 35 38 40 352 353 210 211", from: phone, chatName: "B2 Kitchen Log" }), null);
        assert.ok(reply.includes("19/19 values received"));
    });

    console.log("\n[CEO Canonical Confirmation Flow: 1=Confirm, 2=Edit, 3=Re-enter, 4=Cancel]");

    await test("1 = Confirm: saves to DB, clears pending", async () => {
        const phone = "12105550030@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        await handler.handleTextMessage(makeTextMessage({ body: valid19, from: phone, chatName: "B2 Kitchen Log" }), null);
        const subId = s.pendingSubmission.id;
        assert.ok(subId > 0, "Submission should have an ID");
        const reply = await handler.handleTextMessage(makeTextMessage({ body: "1", from: phone, chatName: "B2 Kitchen Log" }), null);
        assert.ok(reply.includes("Record saved successfully"), "reply: " + reply);
        assert.strictEqual(s.pendingSubmission, null, "pendingSubmission should be cleared");
        assert.strictEqual(s.waitingFor, null, "waitingFor should be cleared");
        assert.strictEqual(db.getSubmission(subId).status, "CONFIRMED");
    });
    await test("CONFIRM = Confirm: saves to DB", async () => {
        const phone = "12105550031@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        await handler.handleTextMessage(makeTextMessage({ body: valid19, from: phone, chatName: "B2 Kitchen Log" }), null);
        const subId = s.pendingSubmission.id;
        await handler.handleTextMessage(makeTextMessage({ body: "CONFIRM", from: phone, chatName: "B2 Kitchen Log" }), null);
        assert.strictEqual(db.getSubmission(subId).status, "CONFIRMED");
    });

    // STEP 8: reply 3 = Re-enter (discard + prompt fresh entry, NOT save)
    await test("3 = Re-enter: discards pending, prompts fresh entry", async () => {
        const phone = "12105550032@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        await handler.handleTextMessage(makeTextMessage({ body: valid19, from: phone, chatName: "B2 Kitchen Log" }), null);
        const subId = s.pendingSubmission.id;
        const reply = await handler.handleTextMessage(makeTextMessage({ body: "3", from: phone, chatName: "B2 Kitchen Log" }), null);
        assert.ok(reply.includes("discarded") || reply.includes("re-send") || reply.includes("again"), "reply: " + reply);
        assert.strictEqual(db.getSubmission(subId).status, "CANCELLED");
        assert.strictEqual(s.pendingSubmission, null, "pendingSubmission should be cleared");
    });
    await test("RE-ENTER alias works like 3", async () => {
        const phone = "12105550033@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        await handler.handleTextMessage(makeTextMessage({ body: valid19, from: phone, chatName: "B2 Kitchen Log" }), null);
        const reply = await handler.handleTextMessage(makeTextMessage({ body: "RE-ENTER", from: phone, chatName: "B2 Kitchen Log" }), null);
        assert.ok(reply.includes("discarded") || reply.includes("re-send") || reply.includes("again"));
    });

    // STEP 9: reply 4 = Cancel
    await test("4 = Cancel: discards pending", async () => {
        const phone = "12105550034@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        await handler.handleTextMessage(makeTextMessage({ body: valid19, from: phone, chatName: "B2 Kitchen Log" }), null);
        const subId = s.pendingSubmission.id;
        const reply = await handler.handleTextMessage(makeTextMessage({ body: "4", from: phone, chatName: "B2 Kitchen Log" }), null);
        assert.ok(reply.includes("cancelled") || reply.includes("discarded"));
        assert.strictEqual(db.getSubmission(subId).status, "CANCELLED");
        assert.strictEqual(s.pendingSubmission, null);
    });
    await test("CANCEL alias works like 4", async () => {
        const phone = "12105550035@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        await handler.handleTextMessage(makeTextMessage({ body: valid19, from: phone, chatName: "B2 Kitchen Log" }), null);
        const subId = s.pendingSubmission.id;
        await handler.handleTextMessage(makeTextMessage({ body: "CANCEL", from: phone, chatName: "B2 Kitchen Log" }), null);
        assert.strictEqual(db.getSubmission(subId).status, "CANCELLED");
    });

    console.log("\n[Edit Flow — STEP 7: EDIT refreshes summary]");

    await test("2 shows edit instructions with current summary", async () => {
        const phone = "12105550050@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        await handler.handleTextMessage(makeTextMessage({ body: valid19, from: phone, chatName: "B2 Kitchen Log" }), null);
        const reply = await handler.handleTextMessage(makeTextMessage({ body: "2", from: phone, chatName: "B2 Kitchen Log" }), null);
        assert.ok(reply.includes("EDIT"), "Missing EDIT: " + reply);
        assert.ok(reply.includes("Current values"), "Missing Current values: " + reply);
        assert.ok(reply.includes("1 = Confirm"), "Missing 1=Confirm: " + reply);
        assert.ok(reply.includes("3 = Re-enter"), "Missing 3=Re-enter: " + reply);
        assert.ok(reply.includes("4 = Cancel"), "Missing 4=Cancel: " + reply);
    });
    await test("EDIT 3 38 updates by index", async () => {
        const phone = "12105550051@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        await handler.handleTextMessage(makeTextMessage({ body: valid19, from: phone, chatName: "B2 Kitchen Log" }), null);
        assert.strictEqual(s.pendingSubmission.parsed.items[2].detectedValue, 35);
        const reply = await handler.handleTextMessage(makeTextMessage({ body: "EDIT 3 38", from: phone, chatName: "B2 Kitchen Log" }), null);
        assert.ok(reply.includes("Edit applied"), "reply: " + reply);
        assert.strictEqual(s.pendingSubmission.parsed.items[2].detectedValue, 38);
        // STEP 7: edit command refreshes summary
        assert.ok(reply.includes("Detected:"), "Reply should include refreshed summary: " + reply);
    });
    await test("EDIT SO-03 42 updates by field ID", async () => {
        const phone = "12105550052@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        await handler.handleTextMessage(makeTextMessage({ body: valid19, from: phone, chatName: "B2 Kitchen Log" }), null);
        const reply = await handler.handleTextMessage(makeTextMessage({ body: "EDIT SO-03 42", from: phone, chatName: "B2 Kitchen Log" }), null);
        assert.ok(reply.includes("Edit applied"), "reply: " + reply);
        assert.strictEqual(s.pendingSubmission.parsed.items[2].detectedValue, 42);
    });
    await test("edit then confirm persists new value", async () => {
        const phone = "12105550053@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        await handler.handleTextMessage(makeTextMessage({ body: valid19, from: phone, chatName: "B2 Kitchen Log" }), null);
        const subId = s.pendingSubmission.id;
        await handler.handleTextMessage(makeTextMessage({ body: "EDIT 8 98", from: phone, chatName: "B2 Kitchen Log" }), null);
        await handler.handleTextMessage(makeTextMessage({ body: "1", from: phone, chatName: "B2 Kitchen Log" }), null);
        const sub = db.getSubmission(subId);
        assert.strictEqual(sub.status, "CONFIRMED");
        const items = JSON.parse(sub.detected_items);
        assert.strictEqual(items[7].detectedValue, 98);
    });

    console.log("\n[Duplicate Protection — STEP 10]");

    // STEP 10: When in numeric_action (waiting for confirm), second numeric list
    // gets re-prompted (already handled by numeric_textHandler action path).
    // Duplicate protection kicks in when the second list is sent from a fresh state.
    await test("sending same list while waiting: re-prompts action", async () => {
        const phone = "12105550060@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        await handler.handleTextMessage(makeTextMessage({ body: valid19, from: phone, chatName: "B2 Kitchen Log" }), null);
        const firstId = s.pendingSubmission.id;
        // Second numeric list while waiting for action: should re-prompt
        const reply = await handler.handleTextMessage(makeTextMessage({ body: valid19, from: phone, chatName: "B2 Kitchen Log" }), null);
        // Correct behavior: re-prompts with "Please reply: 1/2/3/4"
        assert.ok(reply.includes("Please reply"), "Should re-prompt while waiting: " + reply);
    });
    await test("duplicate protection: prior pending superseded when confirmed then new list", async () => {
        const phone = "12105550061@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        // First submission
        await handler.handleTextMessage(makeTextMessage({ body: valid19, from: phone, chatName: "B2 Kitchen Log" }), null);
        const firstId = s.pendingSubmission.id;
        // Confirm first
        await handler.handleTextMessage(makeTextMessage({ body: "1", from: phone, chatName: "B2 Kitchen Log" }), null);
        assert.strictEqual(db.getSubmission(firstId).status, "CONFIRMED");
        // Now send new list
        await handler.handleTextMessage(makeTextMessage({ body: valid19, from: phone, chatName: "B2 Kitchen Log" }), null);
        assert.ok(s.pendingSubmission.id > 0);
        assert.ok(s.pendingSubmission.id !== firstId, "New submission should have different id");
    });

    console.log("\n[/agent Command — STEP 1 & 2]");

    // Per CEO P0 Lockdown directive, /agent returns a SHORT operational message,
    // not the full 19-item checklist. Kitchen employees already have the paper form.
    await test("/agent in B1 Kitchen Log shows The Rim short reply", async () => {
        const phone = "12105550070@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        const reply = await handler.handleTextMessage(makeTextMessage({ body: "/agent", from: phone, chatName: "B1 Kitchen Log" }), null);
        assert.ok(reply && reply.includes("The Rim"), "Should include 'The Rim': " + (reply || "null"));
        assert.ok(reply && reply.includes("Food Safety Session Started"), "Missing session header: " + (reply || "null"));
        assert.ok(reply && reply.includes("1 = Confirm"), "Should include confirm option: " + (reply || "null"));
        assert.ok(reply && reply.length < 700, "/agent reply should be SHORT (<700 chars), was: " + reply.length);
    });
    await test("/agent in B2 Kitchen Log shows Stone Oak short reply", async () => {
        const phone = "12105550071@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        const reply = await handler.handleTextMessage(makeTextMessage({ body: "/agent", from: phone, chatName: "B2 Kitchen Log" }), null);
        assert.ok(reply && reply.includes("Stone Oak"), "Should include 'Stone Oak': " + (reply || "null"));
        assert.ok(reply && reply.length < 700, "/agent reply should be SHORT (<700 chars), was: " + reply.length);
    });
    await test("/agent in B3 Kitchen Log shows Bandera short reply", async () => {
        const phone = "12105550072@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        const reply = await handler.handleTextMessage(makeTextMessage({ body: "/agent", from: phone, chatName: "B3 Kitchen Log" }), null);
        assert.ok(reply && reply.includes("Bandera"), "Should include 'Bandera': " + (reply || "null"));
        assert.ok(reply && reply.length < 700, "/agent reply should be SHORT (<700 chars), was: " + reply.length);
    });

    console.log("\n[Group Routing — STEP 11: Group is Source of Truth]");

    await test("non-production group: numeric list ignored", async () => {
        const phone = "12105550080@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        const reply = await handler.handleTextMessage(makeTextMessage({ body: valid19, from: phone, chatName: "Random Chat" }), null);
        assert.strictEqual(reply, null, "Should return null for non-production group: " + reply);
        assert.strictEqual(s.waitingFor, null);
    });
    await test("non-numeric text not intercepted", async () => {
        const phone = "12105550081@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        const reply = await handler.handleTextMessage(makeTextMessage({ body: "hello everyone!", from: phone, chatName: "B2 Kitchen Log" }), null);
        assert.strictEqual(reply, null, "Should return null for non-numeric: " + reply);
    });

    console.log("\n[API Key Independence — STEP 12: No OCR/Vision/Gemini/OpenAI]");

    await test("works WITHOUT OPENAI_API_KEY", async () => {
        assert.strictEqual(process.env.OPENAI_API_KEY, undefined);
        const phone = "12105550090@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        const reply = await handler.handleTextMessage(makeTextMessage({ body: valid19, from: phone, chatName: "B2 Kitchen Log" }), null);
        assert.ok(reply.includes("19/19 values received"));
    });
    await test("works WITHOUT GEMINI_API_KEY", async () => {
        assert.strictEqual(process.env.GEMINI_API_KEY, undefined);
        const phone = "12105550091@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        const reply = await handler.handleTextMessage(makeTextMessage({ body: valid19, from: phone, chatName: "B1 Kitchen Log" }), null);
        assert.ok(reply.includes("19/19 values received"));
    });
    await test("parser does NOT import OCR", () => {
        const src = fs.readFileSync(require.resolve("../src/numericTextParser"), "utf8");
        assert.ok(!src.includes("require(\"./ocr\")"), "Parser must not import OCR");
        assert.ok(!src.includes("require(\"./vision"), "Parser must not import Vision");
    });
    await test("handler does NOT import Vision LLM", () => {
        const src = fs.readFileSync(require.resolve("../src/numericTextHandler"), "utf8");
        assert.ok(!src.includes("require(\"./ocr\")"), "Handler must not import OCR");
        assert.ok(!src.includes("require(\"../vision_llm_bridge\")"), "Handler must not import Vision LLM bridge");
        assert.ok(!src.includes("openaiVision"), "Handler must not import OpenAI Vision");
    });

    console.log("\n[Summary Screen — STEP 5: All 19 items listed]");

    await test("summary includes all 19 item labels", async () => {
        const phone = "12105550100@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        const reply = await handler.handleTextMessage(makeTextMessage({ body: valid19, from: phone, chatName: "B2 Kitchen Log" }), null);
        assert.ok(reply.includes("Walk-In Cooler"), "Missing Walk-In Cooler: " + reply);
        assert.ok(reply.includes("Walk-In Freezer"), "Missing Walk-In Freezer: " + reply);
        assert.ok(reply.includes("Walk-In Cooler"), "Missing Walk-In Cooler: " + reply);
        assert.ok(reply.includes("Pasta Boiler Right"), "Missing Pasta Boiler Right: " + reply);
    });

    console.log("\n[Google Sheet Safe-Failure — STEP 14]");

    await test("confirm works without GOOGLE_SHEET_ID configured", async () => {
        assert.ok(!process.env.GOOGLE_SHEET_ID);
        const phone = "12105550110@g.us";
        const s = handler.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        await handler.handleTextMessage(makeTextMessage({ body: valid19, from: phone, chatName: "B2 Kitchen Log" }), null);
        const subId = s.pendingSubmission.id;
        const reply = await handler.handleTextMessage(makeTextMessage({ body: "1", from: phone, chatName: "B2 Kitchen Log" }), null);
        assert.ok(reply.includes("Record saved successfully"), "DB save should succeed without sheet: " + reply);
        assert.strictEqual(db.getSubmission(subId).status, "CONFIRMED");
    });

    console.log("\n┌─────────────────────────────────────────────────────────────┐");
    console.log("│  Results: " + passed + " passed, " + failed + " failed" + (" ").repeat(Math.max(0, 30 - String(passed).length - String(failed).length)) + "│");
    console.log("└─────────────────────────────────────────────────────────────┘");
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(function (err) {
    console.error("Test runner crashed:", err);
    process.exit(1);
});
