var assert = require("assert");
var fs = require("fs");
var path = require("path");

process.env.LOG_LEVEL = "error";
process.env.GATEWAY_DB_PATH = path.join(__dirname, "..", "data", "gateway-reminder-scheduler-test.db");
process.env.FOOD_SAFETY_TIMEZONE = "America/Chicago";
try { fs.unlinkSync(process.env.GATEWAY_DB_PATH); } catch (_) { }

var OriginalDate = Date;

function mockDateClass(isoString) {
    function MockDate() {
        if (!(this instanceof MockDate)) {
            return new OriginalDate(isoString).toString();
        }
        if (arguments.length === 0) {
            return new OriginalDate(isoString);
        }
        return new OriginalDate(...arguments);
    }
    MockDate.now = function () { return new OriginalDate(isoString).getTime(); };
    MockDate.parse = OriginalDate.parse;
    MockDate.UTC = OriginalDate.UTC;
    MockDate.prototype = OriginalDate.prototype;
    return MockDate;
}

async function run() {
    var fixedIso = "2026-06-26T15:05:00.000Z"; // 10:05 AM America/Chicago
    var fixedDate = new OriginalDate(fixedIso);

    var db = require("../src/database");
    await db.getDb();

    var managerAlertService = require("../src/managerAlertService");
    var originalSendAlert = managerAlertService.sendAlert;
    managerAlertService.sendAlert = async function () {
        return { sent: true, sent_to_group: true };
    };

    delete require.cache[require.resolve("../src/missingSubmissionScheduler")];
    var scheduler = require("../src/missingSubmissionScheduler");
    var detector = require("../src/missingSubmissionDetector");

    global.Date = mockDateClass(fixedIso);

    try {
        var before = detector.detectMissingSubmissions(fixedDate);
        assert.strictEqual(before.length, 3, "Expected reminders for all 3 log groups before scheduler run");

        var firstRun = await scheduler.runCheck();
        assert.strictEqual(firstRun.missing, 3, "First scheduler run should process 3 reminders");

        var after = detector.detectMissingSubmissions(fixedDate);
        assert.strictEqual(after.length, 0, "Reminders should be deduped after scheduler run");

        var reminderRows = db.getRemindersSentToday("2026-06-26");
        assert.strictEqual(reminderRows.length, 3, "Expected 3 reminder log rows after scheduler run");

        console.log("PASS testReminderSchedulerDedup");
    } finally {
        global.Date = OriginalDate;
        managerAlertService.sendAlert = originalSendAlert;
    }
}

run().catch(function (err) {
    console.error("FAIL testReminderSchedulerDedup");
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
});
