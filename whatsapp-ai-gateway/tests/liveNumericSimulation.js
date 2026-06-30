/* Live numeric workflow simulation — no API keys required. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.LOG_LEVEL = "error";
process.env.GATEWAY_DB_PATH = path.join(__dirname, "..", "data", "gateway-live-sim.db");
try { fs.unlinkSync(process.env.GATEWAY_DB_PATH); } catch (_) { /* fresh */ }

delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_SHEET_ID;
delete process.env.GOOGLE_SERVICE_ACCOUNT_PATH;

const valid19 = [33, -2, 35, 110, 40, 40, -3, 100, 101, 102, 39, 35, 35, 38, 40, 352, 353, 210, 211];
const validText = valid19.join("\n");

function mk({ body, from, chatName }) {
    return {
        from,
        body,
        id: { _serialized: `msg-${Date.now()}-${Math.random()}` },
        type: "chat",
        timestamp: Date.now(),
        _chatName: chatName,
    };
}

async function runScenario(name, chatName, expectedStore) {
    const phone = `${Date.now()}-${Math.floor(Math.random() * 10000)}@g.us`;
    const handler = require("../src/foodSafetyHandler");
    const s = handler.getSession(phone);
    s.pendingSubmission = null;
    s.waitingFor = null;

    const results = { name, store: expectedStore, chatName, steps: [] };

    // Send 19 values
    const r1 = await handler.handleTextMessage(mk({ body: validText, from: phone, chatName }), null);
    results.steps.push({ step: "send values", reply: r1 });
    results.summary = r1;
    results.hasStore = r1 && r1.includes(`Store: ${expectedStore}`);
    results.has19 = r1 && r1.includes("19/19 values received");
    results.hasReplyOptions = r1 && r1.includes("1 = Confirm") && r1.includes("2 = Edit") && r1.includes("3 = Re-enter") && r1.includes("4 = Cancel");

    // Edit flow
    const r2 = await handler.handleTextMessage(mk({ body: "2", from: phone, chatName }), null);
    results.steps.push({ step: "reply 2 (edit prompt)", reply: r2 });
    results.editPrompt = r2;

    const r3 = await handler.handleTextMessage(mk({ body: "EDIT 4 165", from: phone, chatName }), null);
    results.steps.push({ step: "EDIT 4 165", reply: r3 });

    // Test edit by ID
    const r3b = await handler.handleTextMessage(mk({ body: "EDIT RIM-04 165", from: phone, chatName }), null);
    results.steps.push({ step: "EDIT RIM-04 165", reply: r3b });

    // Confirm
    const r4 = await handler.handleTextMessage(mk({ body: "1", from: phone, chatName }), null);
    results.steps.push({ step: "confirm", reply: r4 });
    results.confirmedReply = r4;

    const db = require("../src/database");
    const subId = s.pendingSubmission ? s.pendingSubmission.id : null;
    if (!subId) {
        // Get latest sub for this phone
        const subs = db.getSubmissions({ limit: 1 });
        results.recordedSub = subs[0];
    }

    return results;
}

async function runReenterScenario(chatName) {
    const phone = `${Date.now()}-reenter-${Math.floor(Math.random() * 10000)}@g.us`;
    const handler = require("../src/foodSafetyHandler");
    const s = handler.getSession(phone);
    s.pendingSubmission = null;
    s.waitingFor = null;
    const db = require("../src/database");

    const r1 = await handler.handleTextMessage(mk({ body: validText, from: phone, chatName }), null);
    const subId = s.pendingSubmission.id;
    const beforeCount = db.getSubmissions({ limit: 100 }).filter(x => x.id === subId).length;

    const r2 = await handler.handleTextMessage(mk({ body: "3", from: phone, chatName }), null);
    const r3 = await handler.handleTextMessage(mk({ body: validText, from: phone, chatName }), null);

    return {
        firstSubmit: r1,
        reenterReply: r2,
        newSubmit: r3,
        newSubId: s.pendingSubmission ? s.pendingSubmission.id : null,
        oldSubId: subId,
        oldStatus: db.getSubmission(subId).status,
    };
}

async function runCancelScenario(chatName) {
    const phone = `${Date.now()}-cancel-${Math.floor(Math.random() * 10000)}@g.us`;
    const handler = require("../src/foodSafetyHandler");
    const s = handler.getSession(phone);
    s.pendingSubmission = null;
    s.waitingFor = null;
    const db = require("../src/database");

    const r1 = await handler.handleTextMessage(mk({ body: validText, from: phone, chatName }), null);
    const subId = s.pendingSubmission.id;
    const r2 = await handler.handleTextMessage(mk({ body: "4", from: phone, chatName }), null);
    return {
        firstSubmit: r1,
        cancelReply: r2,
        subId,
        status: db.getSubmission(subId).status,
        pendingAfter: s.pendingSubmission,
        waitingAfter: s.waitingFor,
    };
}

async function runDuplicateScenario(chatName) {
    const phone = `${Date.now()}-dup-${Math.floor(Math.random() * 10000)}@g.us`;
    const handler = require("../src/foodSafetyHandler");
    const s = handler.getSession(phone);
    s.pendingSubmission = null;
    s.waitingFor = null;
    const db = require("../src/database");

    const r1 = await handler.handleTextMessage(mk({ body: validText, from: phone, chatName }), null);
    const firstId = s.pendingSubmission.id;
    const r2 = await handler.handleTextMessage(mk({ body: validText, from: phone, chatName }), null);
    const secondId = s.pendingSubmission ? s.pendingSubmission.id : null;

    return {
        first: r1,
        second: r2,
        firstId,
        secondId,
        sameId: firstId === secondId,
    };
}

async function runInvalidCountScenario(chatName) {
    const phone = `${Date.now()}-inv-${Math.floor(Math.random() * 10000)}@g.us`;
    const handler = require("../src/foodSafetyHandler");
    const s = handler.getSession(phone);
    s.pendingSubmission = null;
    s.waitingFor = null;
    const db = require("../src/database");

    // 18 values (one less)
    const r1 = await handler.handleTextMessage(mk({ body: valid19.slice(0, 18).join("\n"), from: phone, chatName }), null);
    const subsBefore = db.getSubmissions({ limit: 100 }).length;

    // 21 values (two more)
    const r2 = await handler.handleTextMessage(mk({ body: [...valid19, 99, 100].join("\n"), from: phone, chatName }), null);
    const subsAfter = db.getSubmissions({ limit: 100 }).length;

    return { missing: r1, extra: r2, subsBefore, subsAfter };
}

(async () => {
    const db = require("../src/database");
    await db.getDb();

    console.log("═══════════════════════════════════════════════════════════");
    console.log("LIVE NUMERIC WORKFLOW SIMULATION — EVIDENCE COLLECTION");
    console.log("═══════════════════════════════════════════════════════════\n");

    console.log("─ B1 The Rim ──────────────────────────────────────────");
    const b1 = await runScenario("B1 The Rim — Full Flow", "B1 Kitchen Log", "The Rim");
    console.log("Has store 'The Rim':", b1.hasStore);
    console.log("Has 19/19:", b1.has19);
    console.log("Has 1/2/3/4 reply options:", b1.hasReplyOptions);
    console.log("Edit prompt excerpt:", (b1.editPrompt || "").slice(0, 120));
    console.log("Confirm reply excerpt:", (b1.confirmedReply || "").slice(0, 120));

    console.log("\n─ B2 Stone Oak ────────────────────────────────────────");
    const b2 = await runScenario("B2 Stone Oak — Full Flow", "B2 Kitchen Log", "Stone Oak");
    console.log("Has store 'Stone Oak':", b2.hasStore);
    console.log("Has 19/19:", b2.has19);
    console.log("Has 1/2/3/4 reply options:", b2.hasReplyOptions);

    console.log("\n─ B3 Bandera ──────────────────────────────────────────");
    const b3 = await runScenario("B3 Bandera — Full Flow", "B3 Kitchen Log", "Bandera");
    console.log("Has store 'Bandera':", b3.hasStore);
    console.log("Has 19/19:", b3.has19);
    console.log("Has 1/2/3/4 reply options:", b3.hasReplyOptions);

    console.log("\n─ Re-enter Flow (B2) ──────────────────────────────────");
    const reenter = await runReenterScenario("B2 Kitchen Log");
    console.log("Reply to '3':", JSON.stringify(reenter.reenterReply));
    console.log("New submission created:", !!reenter.newSubId);
    console.log("Old sub status after re-enter:", reenter.oldStatus);

    console.log("\n─ Cancel Flow (B2) ────────────────────────────────────");
    const cancel = await runCancelScenario("B2 Kitchen Log");
    console.log("Reply to '4':", JSON.stringify(cancel.cancelReply));
    console.log("Sub status:", cancel.status);
    console.log("pendingAfter:", cancel.pendingAfter);

    console.log("\n─ Duplicate Protection (B2) ───────────────────────────");
    const dup = await runDuplicateScenario("B2 Kitchen Log");
    console.log("First reply excerpt:", (dup.first || "").slice(0, 80));
    console.log("Second reply excerpt:", (dup.second || "").slice(0, 120));
    console.log("Same submission id:", dup.sameId);

    console.log("\n─ Invalid Count (B2) ──────────────────────────────────");
    const inv = await runInvalidCountScenario("B2 Kitchen Log");
    console.log("Missing reply excerpt:", (inv.missing || "").slice(0, 120));
    console.log("Extra reply excerpt:", (inv.extra || "").slice(0, 120));
    console.log("Submissions before/after invalid attempt:", inv.subsBefore, "/", inv.subsAfter);

    console.log("\n─ /agent Command Test (B2) ────────────────────────────");
    const phone9 = `${Date.now()}-agent-${Math.floor(Math.random() * 10000)}@g.us`;
    const handler = require("../src/foodSafetyHandler");
    const s9 = handler.getSession(phone9);
    s9.pendingSubmission = null;
    s9.waitingFor = null;
    const agentReply = await handler.handleTextMessage(mk({ body: "/agent", from: phone9, chatName: "B2 Kitchen Log" }), null);
    console.log("/agent reply:", JSON.stringify(agentReply));

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("SIMULATION COMPLETE");
    console.log("═══════════════════════════════════════════════════════════");
    process.exit(0);
})().catch(err => {
    console.error("Simulation failed:", err);
    process.exit(1);
});
