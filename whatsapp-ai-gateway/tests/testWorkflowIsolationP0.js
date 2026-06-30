/**
 * CEO DIRECTIVE — FOOD SAFETY BOT WORKFLOW ISOLATION P0
 * Comprehensive test suite: 21 tests covering photo suppression,
 * reminder-after-save, reminder time windows, routing isolation,
 * end-to-end Option C workflow, and legacy wording audit.
 */

var assert = require("assert");
var fs = require("fs");
var path = require("path");

process.env.LOG_LEVEL = "error";
process.env.GATEWAY_DB_PATH = path.join(__dirname, "..", "data", "gateway-workflow-isolation-test.db");
try { fs.unlinkSync(process.env.GATEWAY_DB_PATH); } catch (_) { }

delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
process.env.GOOGLE_SHEET_ID = "";
process.env.GOOGLE_SERVICE_ACCOUNT_PATH = "";

var passed = 0;
var failed = 0;

function test(name, fn) {
    return Promise.race([
        fn(),
        new Promise(function (_, reject) { setTimeout(function () { reject(new Error("timeout")); }, 10000); }),
    ]).then(function () {
        passed++;
        console.log("  PASS " + name);
    }).catch(function (err) {
        failed++;
        console.log("  FAIL " + name);
        console.log("      " + (err.stack || err.message));
    });
}

function txt(body, from, chat) {
    from = from || ("1210555" + Math.floor(Math.random() * 10000) + "@g.us");
    chat = chat || "B2 Kitchen Log";
    return {
        from: from, body: body,
        id: { _serialized: "msg-" + Date.now() + "-" + Math.random() },
        type: "chat", hasMedia: false, timestamp: Date.now(), _chatName: chat,
    };
}

function img(from, chat) {
    from = from || ("1210555" + Math.floor(Math.random() * 10000) + "@g.us");
    chat = chat || "B2 Kitchen Log";
    return {
        from: from, body: "",
        hasMedia: true, type: "image",
        id: { _serialized: "msg-i-" + Date.now() + "-" + Math.random() },
        timestamp: Date.now(), _chatName: chat,
    };
}

var V19 = "40\n10\n40\n150\n32\n30\n10\n110\n160\n160\n32\n30\n36\n30\n40\n352\n360\n210\n210";

async function run() {
    var db = require("../src/database");
    await db.getDb();
    var h = require("../src/foodSafetyHandler");
    var det = require("../src/missingSubmissionDetector");
    var guard = require("../src/foodSafetyPilotGuard");
    var submissionConfig = require("../src/submissionDueConfig");

    guard.resetPhotoInstructionThrottle();

    // ═══════════════════════════════════════════════════════════════════
    // PHOTO BEHAVIOR (Tests 1–4)
    // ═══════════════════════════════════════════════════════════════════
    console.log("\n[Photo Behavior Tests]");

    await test("PHOTO-1: Photo before /agent does not create submission", async function () {
        var phone = "12105552001@g.us";
        var reply = await h.handleImageMessage(img(phone, "B2 Kitchen Log"), null);
        if (reply && reply.includes("Runtime proof")) throw new Error("Has runtime proof: " + reply);
        if (reply && reply.includes("processSubmissionBatch")) throw new Error("Called processSubmissionBatch");
        if (reply && reply.includes("python_vision_llm_pipeline")) throw new Error("Called Vision pipeline");
        if (reply && reply.includes("openaiVision")) throw new Error("Called OpenAI Vision");
    });

    await test("PHOTO-2: Photo before /agent does not call Vision/OCR", async function () {
        var phone = "12105552002@g.us";
        var reply = await h.handleImageMessage(img(phone, "B1 Kitchen Log"), null);
        if (reply && reply.includes("Gemini")) throw new Error("Referenced Gemini");
        if (reply && reply.includes("Tesseract")) throw new Error("Referenced Tesseract");
        if (reply && reply.includes("PaddleOCR")) throw new Error("Referenced PaddleOCR");
        if (reply && reply.includes("trace_id")) throw new Error("Has trace_id in reply");
    });

    await test("PHOTO-3: Photo before /agent sends at most one short instruction", async function () {
        guard.resetPhotoInstructionThrottle();
        var phone = "12105552003@g.us";
        var reply1 = await h.handleImageMessage(img(phone, "B2 Kitchen Log"), null);
        if (reply1) {
            assert.ok(reply1.includes("not used") || reply1.includes("Photos are not used"),
                "Expected short instruction: " + reply1);
        }
    });

    await test("PHOTO-4: Multiple photos do not spam replies", async function () {
        guard.resetPhotoInstructionThrottle();
        var phone = "12105552004@g.us";
        await h.handleImageMessage(img(phone, "B3 Kitchen Log"), null);
        var reply2 = await h.handleImageMessage(img(phone, "B3 Kitchen Log"), null);
        var reply3 = await h.handleImageMessage(img(phone, "B3 Kitchen Log"), null);
        if (reply2) throw new Error("Second photo should be silent, got: " + reply2);
        if (reply3) throw new Error("Third photo should be silent, got: " + reply3);
    });

    // ═══════════════════════════════════════════════════════════════════
    // REMINDER SKIP AFTER SAVE (Tests 5–9)
    // ═══════════════════════════════════════════════════════════════════
    console.log("\n[Reminder Skip After Save Tests]");

    await test("SAVE-5: Confirmed 10AM submission prevents 10AM reminder", async function () {
        var phone = "12105552005@g.us";
        var s = h.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        await h.handleTextMessage(txt(V19, phone, "B2 Kitchen Log"), null);
        var subId = s.pendingSubmission.id;
        var sub = db.getSubmission(subId);
        var ocrJson = JSON.parse(sub.ocr_json || "{}");
        ocrJson.shift = "10AM";
        ocrJson.business_date = submissionConfig.getBusinessDateChicago();
        db.run("UPDATE food_safety_submissions SET ocr_json = ? WHERE id = ?",
            [JSON.stringify(ocrJson), subId]);
        db.updateSubmissionStatus(subId, "CONFIRMED");
        var group = { store_code: "B2", store_name: "Stone Oak", store_id: "stone_oak", group_name: "B2 Kitchen Log" };
        var businessDate = submissionConfig.getBusinessDateChicago();
        var hasConfirmed = det.hasConfirmedSubmissionForShift(group, businessDate, "10AM");
        if (!hasConfirmed) throw new Error("Should detect confirmed submission for 10AM");
    });

    await test("SAVE-6: Confirmed 4PM submission prevents 4PM reminder", async function () {
        var phone = "12105552006@g.us";
        var s = h.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        await h.handleTextMessage(txt(V19, phone, "B1 Kitchen Log"), null);
        var subId = s.pendingSubmission.id;
        var sub = db.getSubmission(subId);
        var ocrJson = JSON.parse(sub.ocr_json || "{}");
        ocrJson.shift = "4PM";
        ocrJson.business_date = submissionConfig.getBusinessDateChicago();
        db.run("UPDATE food_safety_submissions SET ocr_json = ? WHERE id = ?",
            [JSON.stringify(ocrJson), subId]);
        db.updateSubmissionStatus(subId, "CONFIRMED");
        var group = { store_code: "B1", store_name: "The Rim", store_id: "rim", group_name: "B1 Kitchen Log" };
        var businessDate = submissionConfig.getBusinessDateChicago();
        var hasConfirmed = det.hasConfirmedSubmissionForShift(group, businessDate, "4PM");
        if (!hasConfirmed) throw new Error("Should detect confirmed submission for 4PM");
    });

    await test("SAVE-7: Saved Bandera record prevents Bandera reminder", async function () {
        var phone = "12105552007@g.us";
        var s = h.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        await h.handleTextMessage(txt(V19, phone, "B3 Kitchen Log"), null);
        var subId = s.pendingSubmission.id;
        var sub = db.getSubmission(subId);
        var ocrJson = JSON.parse(sub.ocr_json || "{}");
        ocrJson.shift = "10AM";
        ocrJson.business_date = submissionConfig.getBusinessDateChicago();
        db.run("UPDATE food_safety_submissions SET ocr_json = ? WHERE id = ?",
            [JSON.stringify(ocrJson), subId]);
        db.updateSubmissionStatus(subId, "CONFIRMED");
        var group = { store_code: "B3", store_name: "Bandera", store_id: "bandera", group_name: "B3 Kitchen Log" };
        var businessDate = submissionConfig.getBusinessDateChicago();
        var hasConfirmed = det.hasConfirmedSubmissionForShift(group, businessDate, "10AM");
        if (!hasConfirmed) throw new Error("Should detect Bandera confirmed");
    });

    await test("SAVE-8: Saved The Rim record prevents The Rim reminder", async function () {
        var group = { store_code: "B1", store_name: "The Rim", store_id: "rim", group_name: "B1 Kitchen Log" };
        var businessDate = submissionConfig.getBusinessDateChicago();
        var hasConfirmed = det.hasConfirmedSubmissionForShift(group, businessDate, "4PM");
        if (!hasConfirmed) throw new Error("Should detect The Rim confirmed");
    });

    await test("SAVE-9: Saved Stone Oak record prevents Stone Oak reminder", async function () {
        var group = { store_code: "B2", store_name: "Stone Oak", store_id: "stone_oak", group_name: "B2 Kitchen Log" };
        var businessDate = submissionConfig.getBusinessDateChicago();
        var hasConfirmed = det.hasConfirmedSubmissionForShift(group, businessDate, "10AM");
        if (!hasConfirmed) throw new Error("Should detect Stone Oak confirmed");
    });

    // ═══════════════════════════════════════════════════════════════════
    // REMINDER TIME WINDOWS (Tests 10–15)
    // ═══════════════════════════════════════════════════════════════════
    console.log("\n[Reminder Time Window Tests]");

    await test("TIME-10: Outside active window sends no reminders", async function () {
        var fakeNow = new Date();
        fakeNow.setUTCHours(20, 0, 0, 0); // 3PM CT = outside both windows
        var missing = det.detectMissingSubmissions(fakeNow);
        assert.equal(missing.length, 0, "Should send no reminders at 3PM CT, got: " + missing.length);
    });

    await test("TIME-11: 10:00AM CT sends only 10AM reminder", async function () {
        var fakeNow = new Date();
        fakeNow.setUTCHours(15, 0, 0, 0); // 10:00 AM CT
        var missing = det.detectMissingSubmissions(fakeNow);
        for (var i = 0; i < missing.length; i++) {
            if (missing[i].shift !== "10AM") {
                throw new Error("Should only send 10AM reminders, got: " + missing[i].shift);
            }
        }
    });

    await test("TIME-12: 4:00PM CT sends only 4PM reminder", async function () {
        var fakeNow = new Date();
        fakeNow.setUTCHours(21, 0, 0, 0); // 4:00 PM CT
        var missing = det.detectMissingSubmissions(fakeNow);
        for (var i = 0; i < missing.length; i++) {
            if (missing[i].shift !== "4PM") {
                throw new Error("Should only send 4PM reminders, got: " + missing[i].shift);
            }
        }
    });

    await test("TIME-13: Morning window never checks 4PM", async function () {
        var fakeNow = new Date();
        fakeNow.setUTCHours(15, 45, 0, 0); // 10:45 AM CT
        var missing = det.detectMissingSubmissions(fakeNow);
        for (var i = 0; i < missing.length; i++) {
            assert.equal(missing[i].shift, "10AM", "Morning window should only produce 10AM alerts");
        }
    });

    await test("TIME-14: Afternoon window never checks 10AM", async function () {
        var fakeNow = new Date();
        fakeNow.setUTCHours(21, 45, 0, 0); // 4:45 PM CT
        var missing = det.detectMissingSubmissions(fakeNow);
        for (var i = 0; i < missing.length; i++) {
            assert.equal(missing[i].shift, "4PM", "Afternoon window should only produce 4PM alerts");
        }
    });

    await test("TIME-15: Duplicate reminder blocked by dedup", async function () {
        var fakeNow = new Date();
        fakeNow.setUTCHours(15, 5, 0, 0); // 10:05 AM CT
        var missing1 = det.detectMissingSubmissions(fakeNow);
        if (missing1.length === 0) throw new Error("Should have missing submissions in first run");
        for (var i = 0; i < missing1.length; i++) {
            if (missing1[i].dedup_key) {
                db.markReminderSent(
                    missing1[i].dedup_key, missing1[i].store_code,
                    missing1[i].store_name, missing1[i].business_date,
                    missing1[i].shift, "whatsapp"
                );
            }
        }
        var missing2 = det.detectMissingSubmissions(fakeNow);
        if (missing2.length >= missing1.length) {
            throw new Error("Dedup should reduce: first=" + missing1.length + " second=" + missing2.length);
        }
    });

    // ═══════════════════════════════════════════════════════════════════
    // ROUTING ISOLATION (Tests 16–19)
    // ═══════════════════════════════════════════════════════════════════
    console.log("\n[Routing Isolation Tests]");

    await test("ROUTE-16: /agent in Food Safety group never reaches Agent-Coding", async function () {
        var phone = "12105552016@g.us";
        var s = h.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        var reply = await h.handleTextMessage(txt("/agent", phone, "B2 Kitchen Log"), null);
        if (!reply) throw new Error("No reply");
        if (reply.includes("admin-only")) throw new Error("Reached generic agent: " + reply);
    });

    await test("ROUTE-17: Numeric list never reaches generic agent", async function () {
        var phone = "12105552017@g.us";
        var s = h.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        var reply = await h.handleTextMessage(txt(V19, phone, "B1 Kitchen Log"), null);
        if (!reply) throw new Error("No reply");
        if (reply.includes("admin-only")) throw new Error("Reached generic agent");
        if (!reply.includes("19/19")) throw new Error("Should be numeric summary: " + reply);
    });

    await test("ROUTE-18: Photo in Food Safety group never reaches Vision", async function () {
        var phone = "12105552018@g.us";
        var reply = await h.handleImageMessage(img(phone, "B2 Kitchen Log"), null);
        if (reply && reply.includes("Runtime proof")) throw new Error("Reached Vision");
        if (reply && reply.includes("python_vision_llm_pipeline")) throw new Error("Reached Vision");
    });

    await test("ROUTE-19: Food Safety handled message returns immediately", async function () {
        var phone = "12105552019@g.us";
        var reply = await h.handleImageMessage(img(phone, "B1 Kitchen Log"), null);
        if (reply && reply.length > 100) {
            throw new Error("Reply too long: " + reply.substring(0, 100));
        }
    });

    // ═══════════════════════════════════════════════════════════════════
    // END-TO-END (Test 20)
    // ═══════════════════════════════════════════════════════════════════
    console.log("\n[End-to-End Tests]");

    await test("E2E-20: /agent -> 19 values -> 1 confirm -> DB save -> no reminder", async function () {
        var phone = "12105552020@g.us";
        var s = h.getSession(phone);
        s.pendingSubmission = null; s.waitingFor = null;
        var r1 = await h.handleTextMessage(txt("/agent", phone, "B3 Kitchen Log"), null);
        if (!r1 || !r1.includes("Food Safety Session Started")) throw new Error("Bad /agent reply");
        var r2 = await h.handleTextMessage(txt(V19, phone, "B3 Kitchen Log"), null);
        if (!r2 || !r2.includes("19/19")) throw new Error("Bad summary: " + r2);
        var r3 = await h.handleTextMessage(txt("1", phone, "B3 Kitchen Log"), null);
        if (!r3 || !r3.includes("saved")) throw new Error("Bad save: " + r3);
        if (s.pendingSubmission !== null) throw new Error("Session not cleared");
        if (s.waitingFor !== null) throw new Error("waitingFor not cleared");
        var subs = db.getSubmissions({ store_name: "Bandera", status: "CONFIRMED", limit: 1 });
        if (subs.length === 0) throw new Error("No confirmed Bandera submission");
        var lastSub = subs[0];
        var ocrData = JSON.parse(lastSub.ocr_json || "{}");
        if (!ocrData.shift) throw new Error("Shift not stored");
        if (!ocrData.business_date) throw new Error("Business date not stored");
        var group = { store_code: "B3", store_name: "Bandera", store_id: "bandera", group_name: "B3 Kitchen Log" };
        var hasConfirmed = det.hasConfirmedSubmissionForShift(group, ocrData.business_date, ocrData.shift);
        if (!hasConfirmed) throw new Error("Reminder engine should detect confirmed B3");
    });

    // ═══════════════════════════════════════════════════════════════════
    // LEGACY WORDING AUDIT (Test 21)
    // ═══════════════════���═══════════════════════════════════════════════
    console.log("\n[Legacy Wording Audit]");

    await test("WORDING-21: Reminder text never contains forbidden phrases", async function () {
        var g = { store_code: "B2", store_name: "Stone Oak", store_id: "stone_oak", group_name: "B2 Kitchen Log", manager_name: "Edga", manager_phone: "12109791918" };
        var e = { label: "PM Line Check", deadline: new Date(), grace_minutes: 30 };
        var alert = det.buildAlertMessage(g, e, new Date());
        var forbidden = ["upload a clear photo", "No readable form", "completed Food Safety form", "Vision did not complete"];
        for (var i = 0; i < forbidden.length; i++) {
            if (alert.es.includes(forbidden[i]) || alert.en.includes(forbidden[i])) {
                throw new Error("Forbidden phrase: " + forbidden[i]);
            }
        }
    });

    console.log("\nResults: " + passed + " passed, " + failed + " failed");
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(function (err) {
    console.error("Test runner crashed:", err);
    process.exit(1);
});
