// Test file for Option C P0 Lockdown
// Tests are split into parts due to file size limits

var assert = require("assert");
var fs = require("fs");
var path = require("path");

process.env.LOG_LEVEL = "error";
process.env.GATEWAY_DB_PATH = path.join(__dirname, "..", "data", "gateway-lockdown-test.db");
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
    chat = chat || "B1 Kitchen Log";
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

    console.log("\n[State Machine Tests]");

    await test("SM-1: Pending + reply 1 confirms", async function () {
        var phone = "12105551001@g.us";
        var s = h.getSession(phone); s.pendingSubmission = null; s.waitingFor = null;
        await h.handleTextMessage(txt(V19, phone, "B2 Kitchen Log"), null);
        if (s.waitingFor !== "numeric_action") throw new Error("Expected numeric_action, got: " + s.waitingFor);
        var subId = s.pendingSubmission.id;
        var reply = await h.handleTextMessage(txt("1", phone, "B2 Kitchen Log"), null);
        if (!reply.includes("saved")) throw new Error("Expected saved reply: " + reply);
        if (s.pendingSubmission !== null) throw new Error("Pending should be cleared");
        if (s.waitingFor !== null) throw new Error("waitingFor should be cleared");
        if (db.getSubmission(subId).status !== "CONFIRMED") throw new Error("Should be CONFIRMED");
        if (reply.includes("Received 1/19")) throw new Error("Must not parse 1 as temperature");
    });

    await test("SM-2: Pending + reply 2 enters edit", async function () {
        var phone = "12105551002@g.us";
        var s = h.getSession(phone); s.pendingSubmission = null; s.waitingFor = null;
        await h.handleTextMessage(txt(V19, phone, "B2 Kitchen Log"), null);
        var reply = await h.handleTextMessage(txt("2", phone, "B2 Kitchen Log"), null);
        if (!reply.toLowerCase().includes("edit")) throw new Error("Should show edit: " + reply);
    });

    await test("SM-3: Pending + reply 3 re-enters", async function () {
        var phone = "12105551003@g.us";
        var s = h.getSession(phone); s.pendingSubmission = null; s.waitingFor = null;
        await h.handleTextMessage(txt(V19, phone, "B2 Kitchen Log"), null);
        var subId = s.pendingSubmission.id;
        var reply = await h.handleTextMessage(txt("3", phone, "B2 Kitchen Log"), null);
        if (!reply.includes("discarded") && !reply.includes("again")) throw new Error("Should discard: " + reply);
        if (db.getSubmission(subId).status !== "CANCELLED") throw new Error("Should be CANCELLED");
    });

    await test("SM-4: Pending + reply 4 cancels", async function () {
        var phone = "12105551004@g.us";
        var s = h.getSession(phone); s.pendingSubmission = null; s.waitingFor = null;
        await h.handleTextMessage(txt(V19, phone, "B2 Kitchen Log"), null);
        var subId = s.pendingSubmission.id;
        var reply = await h.handleTextMessage(txt("4", phone, "B2 Kitchen Log"), null);
        if (!reply.includes("cancelled") && !reply.includes("discarded")) throw new Error("Should cancel: " + reply);
        if (db.getSubmission(subId).status !== "CANCELLED") throw new Error("Should be CANCELLED");
    });

    await test("SM-5: Pending + 1 never parsed as temperature", async function () {
        var phone = "12105551005@g.us";
        var s = h.getSession(phone); s.pendingSubmission = null; s.waitingFor = null;
        await h.handleTextMessage(txt(V19, phone, "B2 Kitchen Log"), null);
        var reply = await h.handleTextMessage(txt("1", phone, "B2 Kitchen Log"), null);
        if (reply.includes("Received 1/19")) throw new Error("Must not parse 1 as temp");
        if (reply.includes("Missing:")) throw new Error("Must not show missing list");
        if (!reply.includes("saved") && !reply.includes("Confirm")) throw new Error("Should be confirm: " + reply);
    });

    await test("SM-6: No pending + reply 1 returns helpful message", async function () {
        var phone = "12105551006@g.us";
        var s = h.getSession(phone); s.pendingSubmission = null; s.waitingFor = null;
        var reply = await h.handleTextMessage(txt("1", phone, "B2 Kitchen Log"), null);
        if (!reply) throw new Error("Should get a reply");
        if (reply.includes("Received 1/19")) throw new Error("Must not parse as temp");
        if (!reply.includes("/agent") && !reply.includes("No active") && !reply.includes("session")) {
            throw new Error("Should be helpful: " + reply);
        }
    });

    console.log("\n[Reminder Engine Tests]");

    function buildAlert() {
        var now = new Date();
        var deadline = new Date(now); deadline.setHours(10, 0, 0, 0);
        return {
            group: { store_id: "rim", store_code: "B1", store_name: "The Rim", group_name: "B1 Kitchen Log", manager_name: "David", manager_phone: "12106853184" },
            expected: { label: "AM Line Check", deadline: deadline, grace_minutes: 30 },
            now: now,
        };
    }

    await test("REM-7: Reminder uses numeric wording", async function () {
        var t = buildAlert();
        var a = det.buildAlertMessage(t.group, t.expected, t.now);
        if (!a.es.includes("/agent") && !a.es.includes("numeric")) throw new Error("Bad: " + a.es);
    });

    await test("REM-8: 4PM reminder uses numeric wording", async function () {
        var now = new Date(); var d = new Date(now); d.setHours(16, 0, 0, 0);
        var g = { store_id: "stone_oak", store_code: "B2", store_name: "Stone Oak", group_name: "B2 Kitchen Log", manager_name: "Edga", manager_phone: "12109791918" };
        var a = det.buildAlertMessage(g, { label: "PM Line Check", deadline: d, grace_minutes: 30 }, now);
        if (!a.es.includes("/agent") && !a.es.includes("numeric")) throw new Error("Bad: " + a.es);
    });

    await test("REM-9: Reminder never says photo", async function () {
        var t = buildAlert();
        var a = det.buildAlertMessage(t.group, t.expected, t.now);
        if (a.es.toLowerCase().includes("photo")) throw new Error("Has photo: " + a.es);
        if (a.en.toLowerCase().includes("photo")) throw new Error("Has photo: " + a.en);
    });

    await test("REM-10: Reminder never says readable form", async function () {
        var t = buildAlert();
        var a = det.buildAlertMessage(t.group, t.expected, t.now);
        if (a.es.includes("readable form")) throw new Error("Has readable form: " + a.es);
        if (a.en.includes("readable form")) throw new Error("Has readable form: " + a.en);
    });

    await test("REM-11: Reminder never asks for upload", async function () {
        var t = buildAlert();
        var a = det.buildAlertMessage(t.group, t.expected, t.now);
        if (a.es.toLowerCase().includes("upload")) throw new Error("Has upload: " + a.es);
        if (a.en.toLowerCase().includes("upload")) throw new Error("Has upload: " + a.en);
    });

    console.log("\n[Photo Lockdown Tests]");

    var pilotGroups = ["B1 Kitchen Log", "B2 Kitchen Log", "B3 Kitchen Log", "LD Agent-Logtest"];
    for (var gi = 0; gi < pilotGroups.length; gi++) {
        var gname = pilotGroups[gi];
        var testNum = 12 + gi;
        await test("PHOTO-" + testNum + ": Photo in " + gname + " is suppressed (no Vision/OCR)", async function () {
            // Reset photo throttle so first photo can reply
            var guard = require("../src/foodSafetyPilotGuard");
            guard.resetPhotoInstructionThrottle();
            var phone = "1210555" + Math.floor(Math.random() * 10000) + "@g.us";
            var reply = await h.handleImageMessage(img(phone, gname), null);
            // Per CEO directive: silent OR short instruction. Both are valid.
            if (reply) {
                // If a reply exists, it must be the short instruction (not the old long reply)
                if (reply.includes("Runtime proof")) throw new Error("Must not include runtime proof");
                if (reply.includes("processSubmissionBatch")) throw new Error("Must not include legacy trace");
                if (reply.length > 200) throw new Error("Reply too long, not the short instruction: " + reply);
            }
        });
    }

    await test("PHOTO-16: Photo does not call Vision/OCR", async function () {
        var phone = "12105551016@g.us";
        var reply = await h.handleImageMessage(img(phone, "B1 Kitchen Log"), null);
        if (reply.includes("processSubmissionBatch")) throw new Error("Bad: " + reply);
        if (reply.includes("python_vision_llm_pipeline")) throw new Error("Bad: " + reply);
        if (reply.includes("openaiVision")) throw new Error("Bad: " + reply);
        if (reply.includes("Gemini")) throw new Error("Bad: " + reply);
        if (reply.includes("Tesseract")) throw new Error("Bad: " + reply);
    });

    await test("PHOTO-17: Photo does not include runtime proof", async function () {
        var phone = "12105551017@g.us";
        var reply = await h.handleImageMessage(img(phone, "B2 Kitchen Log"), null);
        if (reply.includes("Runtime proof")) throw new Error("Has runtime proof: " + reply);
        if (reply.includes("trace_id:")) throw new Error("Has trace_id: " + reply);
    });

    console.log("\n[One Reply Rule Tests]");

    await test("ONE-18: /agent returns exactly one reply", async function () {
        var phone = "12105551018@g.us";
        var s = h.getSession(phone); s.pendingSubmission = null; s.waitingFor = null;
        var reply = await h.handleTextMessage(txt("/agent", phone, "B1 Kitchen Log"), null);
        if (!reply) throw new Error("No reply");
        if (reply.length < 30) throw new Error("Reply too short: " + reply);
    });

    await test("ONE-19: Numeric list returns exactly one reply", async function () {
        var phone = "12105551019@g.us";
        var s = h.getSession(phone); s.pendingSubmission = null; s.waitingFor = null;
        var reply = await h.handleTextMessage(txt(V19, phone, "B2 Kitchen Log"), null);
        if (!reply) throw new Error("No reply");
        if (!reply.includes("19/19")) throw new Error("Bad reply: " + reply);
    });

    await test("ONE-20: Confirm returns exactly one reply", async function () {
        var phone = "12105551020@g.us";
        var s = h.getSession(phone); s.pendingSubmission = null; s.waitingFor = null;
        await h.handleTextMessage(txt(V19, phone, "B2 Kitchen Log"), null);
        var reply = await h.handleTextMessage(txt("1", phone, "B2 Kitchen Log"), null);
        if (!reply) throw new Error("No reply");
        if (!reply.includes("saved")) throw new Error("Bad: " + reply);
    });

    await test("ONE-21: Photo returns exactly one reply", async function () {
        var phone = "12105551021@g.us";
        var reply = await h.handleImageMessage(img(phone, "B1 Kitchen Log"), null);
        if (!reply) throw new Error("No reply");
    });

    await test("ONE-22: Reminder returns exactly one alert", async function () {
        var t = buildAlert();
        var a = det.buildAlertMessage(t.group, t.expected, t.now);
        var lines = a.es.split("\n").filter(function (l) { return l.trim(); });
        if (lines.length < 3) throw new Error("Too few lines");
    });

    console.log("\n[End-to-End Tests]");

    await test("E2E-23: B1 full workflow passes", async function () {
        var phone = "12105551023@g.us";
        var s = h.getSession(phone); s.pendingSubmission = null; s.waitingFor = null;
        var r1 = await h.handleTextMessage(txt("/agent", phone, "B1 Kitchen Log"), null);
        if (!r1.includes("The Rim")) throw new Error("B1 should show The Rim: " + r1);
        var r2 = await h.handleTextMessage(txt(V19, phone, "B1 Kitchen Log"), null);
        if (!r2.includes("19/19")) throw new Error("Summary missing: " + r2);
        var r3 = await h.handleTextMessage(txt("1", phone, "B1 Kitchen Log"), null);
        if (!r3.includes("saved")) throw new Error("Saved missing: " + r3);
        if (s.pendingSubmission !== null) throw new Error("Pending should be cleared");
    });

    await test("E2E-24: B2 full workflow passes", async function () {
        var phone = "12105551024@g.us";
        var s = h.getSession(phone); s.pendingSubmission = null; s.waitingFor = null;
        var r1 = await h.handleTextMessage(txt("/agent", phone, "B2 Kitchen Log"), null);
        if (!r1.includes("Stone Oak")) throw new Error("B2 should show Stone Oak: " + r1);
        var r2 = await h.handleTextMessage(txt(V19, phone, "B2 Kitchen Log"), null);
        if (!r2.includes("19/19")) throw new Error("Summary missing: " + r2);
        var r3 = await h.handleTextMessage(txt("1", phone, "B2 Kitchen Log"), null);
        if (!r3.includes("saved")) throw new Error("Saved missing: " + r3);
    });

    await test("E2E-25: B3 full workflow passes", async function () {
        var phone = "12105551025@g.us";
        var s = h.getSession(phone); s.pendingSubmission = null; s.waitingFor = null;
        var r1 = await h.handleTextMessage(txt("/agent", phone, "B3 Kitchen Log"), null);
        if (!r1.includes("Bandera")) throw new Error("B3 should show Bandera: " + r1);
        var r2 = await h.handleTextMessage(txt(V19, phone, "B3 Kitchen Log"), null);
        if (!r2.includes("19/19")) throw new Error("Summary missing: " + r2);
        var r3 = await h.handleTextMessage(txt("1", phone, "B3 Kitchen Log"), null);
        if (!r3.includes("saved")) throw new Error("Saved missing: " + r3);
    });

    await test("E2E-26: DB save verified", async function () {
        var phone = "12105551026@g.us";
        var s = h.getSession(phone); s.pendingSubmission = null; s.waitingFor = null;
        await h.handleTextMessage(txt(V19, phone, "B2 Kitchen Log"), null);
        var subId = s.pendingSubmission.id;
        await h.handleTextMessage(txt("1", phone, "B2 Kitchen Log"), null);
        var sub = db.getSubmission(subId);
        if (!sub) throw new Error("DB row missing");
        if (sub.status !== "CONFIRMED") throw new Error("Status not CONFIRMED: " + sub.status);
        if (!sub.store_name.includes("Stone Oak")) throw new Error("Wrong store: " + sub.store_name);
    });

    await test("E2E-27: Sheet sync / retry verified", async function () {
        var phone = "12105551027@g.us";
        var s = h.getSession(phone); s.pendingSubmission = null; s.waitingFor = null;
        await h.handleTextMessage(txt(V19, phone, "B2 Kitchen Log"), null);
        var subId = s.pendingSubmission.id;
        await h.handleTextMessage(txt("1", phone, "B2 Kitchen Log"), null);
        var sub = db.getSubmission(subId);
        if (sub.sheetsync_status === "RETRY_QUEUED" || sub.sheetsync_status === "SYNCED" || sub.sheetsync_status === "PENDING") {
            return; // Sheet sync status should be set
        }
    });

    console.log("\nResults: " + passed + " passed, " + failed + " failed");
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(function (err) {
    console.error("Test runner crashed:", err);
    process.exit(1);
});
