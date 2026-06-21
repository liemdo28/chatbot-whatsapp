const assert = require("assert");

process.env.LOG_LEVEL = "error";
process.env.SESSION_DATA_PATH = "./sessions-test";
process.env.FOOD_SAFETY_SUBMISSION_WINDOW_MS = "5";
process.env.FOOD_SAFETY_CONFIRM_REMINDER_MS = "600000";
process.env.FOOD_SAFETY_AUTO_CONFIRM_MS = "600000";

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await Promise.race([
            fn(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("test timeout")), 15000)),
        ]);
        passed++;
        console.log(`PASS ${name}`);
    } catch (err) {
        failed++;
        console.log(`FAIL ${name}`);
        console.log(`  ${err.stack || err.message}`);
    }
}

function buildFormText(prefix = "SO", store = "STONE OAK", mode = "10") {
    const labels = [
        "Walk-In Cooler (Produce)",
        "Walk-In Freezer",
        "Prep Area Cooler",
        "Bowl Warmer",
        "Ramen Reach-In Top",
        "Ramen Reach-In Below",
        "Line Freezer",
        "Seasoned Eggs",
        "Sliced Pork Hot",
        "Diced Pork Hot",
        "Tapas Reach-In Top",
        "Chicken Cold",
        "Pork Cold",
        "Tapas Reach-In Below",
        "Walk-In Produce Recheck",
        "Fryer Left",
        "Fryer Right",
        "Pasta Boiler Left",
        "Pasta Boiler Right",
    ];
    const ten = [30, -1, 35, 100, 40, 40, -1, 100, 101, 102, 39, 39, 39, 38, 40, 351, 352, 210, 210];
    const four = [31, 0, 36, 101, 41, 41, 0, 101, 102, 103, 40, 40, 40, 39, 41, 352, 353, 211, 211];
    const header = mode === "10"
        ? "ID ITEM TARGET RANGE 10:00 AM TEMPERATURE"
        : mode === "4"
            ? "ID ITEM TARGET RANGE 4:00 PM TEMPERATURE"
            : "ID ITEM TARGET RANGE 10:00 AM TEMPERATURE 4:00 PM TEMPERATURE";
    const lines = [
        `STORE: ${store}`,
        "FOOD SAFETY LINE CHECK",
        header,
    ];
    for (let i = 0; i < labels.length; i++) {
        const id = `${prefix}-${String(i + 1).padStart(2, "0")}`;
        const valuePart = mode === "10"
            ? `${ten[i]}`
            : mode === "4"
                ? `${four[i]}`
                : `${ten[i]} ${four[i]}`;
        lines.push(`${id} ${labels[i]} ${valuePart}`);
    }
    return lines.join("\n");
}

function makeImageMessage({ id, from = "b2@g.us", chatName = "B2 Kitchen Log", body = "image" } = {}) {
    return {
        from,
        id: { _serialized: id || `msg-${Date.now()}-${Math.random()}` },
        hasMedia: true,
        type: "image",
        timestamp: Date.now(),
        _chatName: chatName,
        async downloadMedia() {
            return {
                data: Buffer.from(body).toString("base64"),
                mimetype: "image/jpeg",
                mediaKey: id || body,
            };
        },
    };
}

async function main() {
    const db = require("../src/database");
    await db.getDb();
    require("../src/handwriting").initHandwritingTables();

    const router = require("../src/formImageRouter");
    const {
        parseTemperatures,
        FORM_TEMPLATES,
    } = require("../src/ocr");
    const { predictSingleField, SOURCES } = require("../src/handwriting/predictionEngine");
    const handler = require("../src/foodSafetyHandler");
    const scheduler = require("../src/missingSubmissionScheduler");

    await test("Stone Oak template is v3 with SO-01..SO-19", () => {
        const tmpl = FORM_TEMPLATES.StoneOak;
        assert.strictEqual(tmpl.template_id, "FoodSafety-StoneOak-v3");
        assert.strictEqual(tmpl.items.length, 19);
        assert.strictEqual(tmpl.items[9].id, "SO-10");
        assert.strictEqual(tmpl.items[9].label, "Diced Pork Hot");
        assert.deepStrictEqual(tmpl.items[9].safeRange, { min: 95, max: 105 });
        assert.strictEqual(tmpl.items[18].id, "SO-19");
    });

    await test("Group scope allows only log/test groups and blocks management inbound processing", () => {
        assert.strictEqual(router.getGroupScope({ chatName: "B1 Kitchen Log" }).storeInfo.storeCode, "B1");
        assert.strictEqual(router.getGroupScope({ chatName: "B2 Kitchen Log" }).storeInfo.storeCode, "B2");
        assert.strictEqual(router.getGroupScope({ chatName: "B3 Kitchen Log" }).storeInfo.storeCode, "B3");
        assert.strictEqual(router.getGroupScope({ chatName: "LD Agent-Logtest" }).processingEnabled, true);
        assert.strictEqual(router.getGroupScope({ chatName: "Bakudan Management Team" }).processingEnabled, false);
        assert.strictEqual(router.getGroupScope({ chatName: "Random Kitchen Chat" }).enabled, false);
    });

    await test("LD Agent-Logtest routes by form header", () => {
        assert.strictEqual(router.resolveStoreFromContext("LD Agent-Logtest", buildFormText("RIM", "THE RIM")).storeCode, "B1");
        assert.strictEqual(router.resolveStoreFromContext("LD Agent-Logtest", buildFormText("SO", "STONE OAK")).storeCode, "B2");
        assert.strictEqual(router.resolveStoreFromContext("LD Agent-Logtest", buildFormText("BAN", "BANDERA")).storeCode, "B3");
    });

    await test("Strict form gate rejects thermometer and food/product text", () => {
        assert.strictEqual(router.isFormLikely("Cooper NSF thermometer reads 40 F"), false);
        assert.strictEqual(router.isFormLikely("black tray with eggs and pork product label"), false);
        assert.strictEqual(parseTemperatures("Cooper thermometer 40 F", { context: { chatName: "B2 Kitchen Log" } }).isForm, false);
    });

    await test("Column auto-selection follows 10AM/4PM rules", () => {
        const only10 = parseTemperatures(buildFormText("SO", "STONE OAK", "10"), { context: { chatName: "B2 Kitchen Log" } });
        const only4 = parseTemperatures(buildFormText("SO", "STONE OAK", "4"), { context: { chatName: "B2 Kitchen Log" } });
        const both = parseTemperatures(buildFormText("SO", "STONE OAK", "both"), { context: { chatName: "B2 Kitchen Log" } });
        assert.strictEqual(only10.selected_column, "10:00");
        assert.strictEqual(only4.selected_column, "16:00");
        assert.strictEqual(both.selected_column, "16:00");
    });

    await test("Prediction overrides impossible OCR with in-range memory", () => {
        const prediction = predictSingleField({
            ocrValue: 4,
            ocrItemConfidence: 40,
            ocrOverallConfidence: 40,
            fieldRange: { min: 95, max: 105 },
            fieldId: "SO-10",
            bestMatch: { confirmed_value: 100, similarity_score: 0.86 },
            memoryMatchCount: 5,
            item: {},
        });
        assert.strictEqual(prediction.final_suggested_value, 100);
        assert.strictEqual(prediction.prediction_source, SOURCES.MEMORY_ASSISTED);
        assert.strictEqual(prediction.needs_confirmation, true);
        assert.strictEqual(prediction.alert_allowed, false);
    });

    await test("Fryer OCR 138 is blocked and memory-assisted before alert", () => {
        const prediction = predictSingleField({
            ocrValue: 138,
            ocrItemConfidence: 48,
            ocrOverallConfidence: 48,
            fieldRange: { min: 350, max: 360 },
            fieldId: "BAN-16",
            bestMatch: { confirmed_value: 353, similarity_score: 0.86 },
            memoryMatchCount: 5,
            item: {},
        });
        assert.strictEqual(prediction.final_suggested_value, 353);
        assert.strictEqual(prediction.prediction_source, SOURCES.MEMORY_ASSISTED);
        assert.strictEqual(prediction.alert_allowed, false);
        assert.ok(prediction.alert_block_reason);
    });

    await test("Non-form image batch is silent", async () => {
        handler.resetProcessingCachesForTests();
        handler.setPaddleBridgeForTests({ isServiceAvailable: async () => false });
        handler.setOcrProcessorForTests(async () => ({ rawText: "Cooper thermometer reads 40 F", confidence: 91 }));
        const reply = await handler.processSubmissionBatch([
            { message: makeImageMessage({ id: "thermo", body: "thermo" }), client: null },
        ]);
        assert.strictEqual(reply, null);
    });

    await test("Form plus supporting image produces one confirmation/manual reply", async () => {
        handler.resetProcessingCachesForTests();
        handler.setPaddleBridgeForTests({ isServiceAvailable: async () => false });
        let calls = 0;
        handler.setOcrProcessorForTests(async () => {
            calls++;
            return calls === 1
                ? { rawText: buildFormText("SO", "STONE OAK", "10"), confidence: 90 }
                : { rawText: "egg product photo", confidence: 92 };
        });
        const reply = await handler.processSubmissionBatch([
            { message: makeImageMessage({ id: "form-one", body: "form" }), client: null },
            { message: makeImageMessage({ id: "evidence-one", body: "egg" }), client: null },
        ]);
        assert.ok(reply);
        assert.ok(reply.includes("MANUAL"));
        assert.ok(reply.includes("CONFIRM"));
        assert.ok(reply.includes("SO-01 Walk-In Cooler"));
    });

    await test("Manual 19-value entry maps SO-01..SO-19 then CONFIRM saves", async () => {
        const phone = "b2@g.us";
        const values = "30,0,35,100,40,40,0,100,101,102,39,39,39,38,40,351,352,210,210";
        const manualReply = await handler.handleTextMessage({ from: phone, body: `MANUAL\n${values}` }, null);
        assert.ok(manualReply.includes("SO-01"));
        assert.ok(manualReply.includes("SO-19"));
        const confirmReply = await handler.handleTextMessage({ from: phone, body: "CONFIRM" }, null);
        assert.ok(confirmReply.includes("guardado") || confirmReply.includes("saved"));
        const latest = db.getSubmissions({ store_name: "Stone Oak", limit: 1 })[0];
        assert.strictEqual(latest.status, "CONFIRMED");
    });

    function seedPending(phone) {
        handler.sessions[phone] = {
            language: "ES",
            pendingSubmission: {
                id: 999999,
                parsed: {
                    items: FORM_TEMPLATES.StoneOak.items.map((item, index) => ({
                        index: index + 1,
                        id: item.id,
                        field_id: item.id,
                        label: item.label,
                        detectedValue: 40,
                        value: 40,
                        unit: item.unit,
                        safeRange: item.safeRange,
                        status: "SAFE",
                        isSafe: true,
                    })),
                    issues: [],
                    selected_column: "10:00",
                    template_id: "FoodSafety-StoneOak-v3",
                    store_name: "Stone Oak",
                },
                storeName: "Stone Oak",
                storeCode: "B2",
                ocrConfidence: 95,
                manualRequired: false,
            },
            waitingFor: "action",
            storeCode: "B2",
        };
    }

    await test("Confirm/Edit/Retake/Manager/Cancel/Help commands work", async () => {
        const help = await handler.handleTextMessage({ from: "cmd-help@g.us", body: "HELP" }, null);
        assert.ok(help.includes("CONFIRM"));

        seedPending("cmd-edit@g.us");
        const editId = await handler.handleTextMessage({ from: "cmd-edit@g.us", body: "EDIT SO-01 41" }, null);
        assert.ok(editId.includes("SO-01"));
        const editIndex = await handler.handleTextMessage({ from: "cmd-edit@g.us", body: "EDIT 1 40" }, null);
        assert.ok(editIndex.includes("SO-01"));

        seedPending("cmd-retake@g.us");
        const retake = await handler.handleTextMessage({ from: "cmd-retake@g.us", body: "RETAKE" }, null);
        assert.ok(retake.includes("foto") || retake.includes("photo"));
        assert.strictEqual(handler.sessions["cmd-retake@g.us"].pendingSubmission, null);

        seedPending("cmd-manager@g.us");
        const manager = await handler.handleTextMessage({ from: "cmd-manager@g.us", body: "MANAGER" }, null);
        assert.ok(manager.toLowerCase().includes("manager"));
        assert.strictEqual(handler.sessions["cmd-manager@g.us"].pendingSubmission, null);

        seedPending("cmd-cancel@g.us");
        const cancel = await handler.handleTextMessage({ from: "cmd-cancel@g.us", body: "CANCEL" }, null);
        assert.ok(cancel.includes("cancel"));
        assert.strictEqual(handler.sessions["cmd-cancel@g.us"].pendingSubmission, null);
    });

    await test("Peer missing submission detector identifies other two stores", async () => {
        const result = await scheduler.runPeerMissingCheck("B2", new Date("2026-06-19T18:00:00Z"));
        assert.ok(result.missing >= 2);
    });

    console.log(`\n${passed}/${passed + failed} passed`);
    if (failed) process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
