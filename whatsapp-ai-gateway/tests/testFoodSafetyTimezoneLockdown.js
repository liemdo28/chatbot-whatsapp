/**
 * FOOD SAFETY TIMEZONE LOCKDOWN TESTS
 * CEO DIRECTIVE: All Food Safety reminder logic must use America/Chicago timezone.
 * Server runs in Vietnam (UTC+7). San Antonio = America/Chicago (UTC-5/-6).
 */

const { getChicagoHourMinute, getBusinessDateChicago } = require("../src/submissionDueConfig");
const { detectMissingSubmissions, getActiveShiftWindow, SHIFT_WINDOWS } = require("../src/missingSubmissionDetector");

let passed = 0;
let failed = 0;

function assert(condition, testName) {
    if (condition) {
        console.log("  PASS: " + testName);
        passed++;
    } else {
        console.log("  FAIL: " + testName);
        failed++;
    }
}

function utcDate(year, month, day, hour, minute) {
    return new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
}

// === Test Group 1: Timezone Conversion ===
console.log("\n=== Test Group 1: Timezone Conversion Functions ===");

var d1 = utcDate(2026, 6, 26, 17, 0); // 17:00 UTC = 12:00 PM CDT
var c1 = getChicagoHourMinute(d1);
assert(c1.hour === 12 && c1.minute === 0, "17:00 UTC = 12:00 Chicago");

var d2 = utcDate(2026, 6, 26, 5, 0); // 05:00 UTC = 00:00 CDT
var c2 = getChicagoHourMinute(d2);
assert(c2.hour === 0 && c2.minute === 0, "05:00 UTC = 00:00 Chicago");

var d3 = utcDate(2026, 6, 26, 15, 30); // 15:30 UTC = 10:30 AM CDT
var c3 = getChicagoHourMinute(d3);
assert(c3.hour === 10 && c3.minute === 30, "15:30 UTC = 10:30 AM Chicago");

var d4 = utcDate(2026, 6, 26, 21, 30); // 21:30 UTC = 4:30 PM CDT
var c4 = getChicagoHourMinute(d4);
assert(c4.hour === 16 && c4.minute === 30, "21:30 UTC = 4:30 PM Chicago");

// === Test Group 2: Vietnam Morning Time ===
console.log("\n=== Test Group 2: Vietnam Morning 7AM (should NOT send reminders) ===");

// 7:00 AM Vietnam (UTC+7) = 23:00 UTC previous day = 6:00 PM CDT
var vn7am = utcDate(2026, 6, 25, 23, 0);
var cAtVn7am = getChicagoHourMinute(vn7am);
assert(cAtVn7am.hour === 18 && cAtVn7am.minute === 0, "7AM Vietnam = 6PM Chicago");

var win1 = getActiveShiftWindow(cAtVn7am);
assert(win1 === null, "7AM Vietnam: NO active reminder window");

var miss1 = detectMissingSubmissions(vn7am);
assert(miss1.length === 0, "7AM Vietnam: 0 missing submission alerts");

// === Test Group 3: Before 10:00 AM Chicago ===
console.log("\n=== Test Group 3: Before 10:00 AM Chicago ===");

var d0959 = utcDate(2026, 6, 26, 14, 59); // 9:59 AM CDT
var c0959 = getChicagoHourMinute(d0959);
assert(c0959.hour === 9 && c0959.minute === 59, "14:59 UTC = 9:59 AM Chicago");

var w0959 = getActiveShiftWindow(c0959);
assert(w0959 === null, "9:59 AM Chicago: NO window active");

// === Test Group 4: 10:00 AM Chicago - ONLY 10AM reminder ===
console.log("\n=== Test Group 4: 10:00 AM Chicago ===");

var d1000 = utcDate(2026, 6, 26, 15, 0);
var c1000 = getChicagoHourMinute(d1000);
assert(c1000.hour === 10 && c1000.minute === 0, "15:00 UTC = 10:00 AM Chicago");

var w1000 = getActiveShiftWindow(c1000);
assert(w1000 !== null, "10:00 AM: window IS active");
assert(w1000 && w1000.shift === "10AM", "10:00 AM: shift is 10AM");
assert(w1000 && w1000.shift !== "4PM", "10:00 AM: NOT 4PM shift");

// === Test Group 5: 10:45 AM Chicago ===
console.log("\n=== Test Group 5: 10:45 AM Chicago ===");

var d1045 = utcDate(2026, 6, 26, 15, 45);
var c1045 = getChicagoHourMinute(d1045);
assert(c1045.hour === 10 && c1045.minute === 45, "15:45 UTC = 10:45 AM Chicago");

var w1045 = getActiveShiftWindow(c1045);
assert(w1045 !== null, "10:45 AM: window active");
assert(w1045 && w1045.shift === "10AM", "10:45 AM: 10AM shift only");

// === Test Group 6: 11:01 AM Chicago ===
console.log("\n=== Test Group 6: 11:01 AM Chicago ===");

var d1101 = utcDate(2026, 6, 26, 16, 1);
var c1101 = getChicagoHourMinute(d1101);
assert(c1101.hour === 11 && c1101.minute === 1, "16:01 UTC = 11:01 AM Chicago");

var w1101 = getActiveShiftWindow(c1101);
assert(w1101 === null, "11:01 AM: NO window active");

// === Test Group 7: Before 4:00 PM Chicago ===
console.log("\n=== Test Group 7: Before 4:00 PM Chicago ===");

var d1559 = utcDate(2026, 6, 26, 20, 59);
var c1559 = getChicagoHourMinute(d1559);
assert(c1559.hour === 15 && c1559.minute === 59, "20:59 UTC = 3:59 PM Chicago");

var w1559 = getActiveShiftWindow(c1559);
assert(w1559 === null, "3:59 PM: NO window active");

// === Test Group 8: 4:00 PM Chicago - ONLY 4PM reminder ===
console.log("\n=== Test Group 8: 4:00 PM Chicago ===");

var d1600 = utcDate(2026, 6, 26, 21, 0);
var c1600 = getChicagoHourMinute(d1600);
assert(c1600.hour === 16 && c1600.minute === 0, "21:00 UTC = 4:00 PM Chicago");

var w1600 = getActiveShiftWindow(c1600);
assert(w1600 !== null, "4:00 PM: window IS active");
assert(w1600 && w1600.shift === "4PM", "4:00 PM: shift is 4PM");
assert(w1600 && w1600.shift !== "10AM", "4:00 PM: NOT 10AM shift");

// === Test Group 9: 4:45 PM Chicago ===
console.log("\n=== Test Group 9: 4:45 PM Chicago ===");

var d1645 = utcDate(2026, 6, 26, 21, 45);
var c1645 = getChicagoHourMinute(d1645);
assert(c1645.hour === 16 && c1645.minute === 45, "21:45 UTC = 4:45 PM Chicago");

var w1645 = getActiveShiftWindow(c1645);
assert(w1645 !== null, "4:45 PM: window active");
assert(w1645 && w1645.shift === "4PM", "4:45 PM: 4PM shift only");

// === Test Group 10: 5:01 PM Chicago ===
console.log("\n=== Test Group 10: 5:01 PM Chicago ===");

var d1701 = utcDate(2026, 6, 26, 22, 1);
var c1701 = getChicagoHourMinute(d1701);
assert(c1701.hour === 17 && c1701.minute === 1, "22:01 UTC = 5:01 PM Chicago");

var w1701 = getActiveShiftWindow(c1701);
assert(w1701 === null, "5:01 PM: NO window active");

// === Test Group 11: Night Time ===
console.log("\n=== Test Group 11: Night Time Chicago ===");

var d0200 = utcDate(2026, 6, 26, 7, 0); // 07:00 UTC = 2:00 AM CDT
var c0200 = getChicagoHourMinute(d0200);
assert(c0200.hour === 2 && c0200.minute === 0, "07:00 UTC = 2:00 AM Chicago");

var wNight = getActiveShiftWindow(c0200);
assert(wNight === null, "2:00 AM: NO reminder window");

// === Test Group 12: Business Date ===
console.log("\n=== Test Group 12: Business Date in Chicago ===");

var bz1 = getBusinessDateChicago(utcDate(2026, 6, 26, 22, 0));
assert(bz1 === "2026-06-26", "22:00 UTC Jun 26 = business date 2026-06-26");

var bz2 = getBusinessDateChicago(utcDate(2026, 6, 27, 3, 0));
assert(bz2 === "2026-06-26", "03:00 UTC Jun 27 = business date 2026-06-26 CDT");

var bz3 = getBusinessDateChicago(utcDate(2026, 6, 27, 10, 0));
assert(bz3 === "2026-06-27", "10:00 UTC Jun 27 = business date 2026-06-27 CDT");

// === Test Group 13: Shift Window Definitions ===
console.log("\n=== Test Group 13: Shift Window Definitions ===");

assert(SHIFT_WINDOWS.length === 2, "Exactly 2 shift windows defined");

var w10 = SHIFT_WINDOWS.find(function (w) { return w.shift === "10AM"; });
assert(w10 && w10.windowStart.hour === 10 && w10.windowStart.minute === 0, "10AM window starts at 10:00");
assert(w10 && w10.windowEnd.hour === 10 && w10.windowEnd.minute === 59, "10AM window ends at 10:59");
assert(w10 && w10.expectedSubmissionTimeLabel === "10:00 AM", "10AM label mentions 10:00 AM");

var w4 = SHIFT_WINDOWS.find(function (w) { return w.shift === "4PM"; });
assert(w4 && w4.windowStart.hour === 16 && w4.windowStart.minute === 0, "4PM window starts at 16:00");
assert(w4 && w4.windowEnd.hour === 16 && w4.windowEnd.minute === 59, "4PM window ends at 16:59");
assert(w4 && w4.expectedSubmissionTimeLabel === "4:00 PM", "4PM label mentions 4:00 PM");

// === SUMMARY ===
console.log("\n========================================");
console.log("TEST RESULTS: " + passed + " passed, " + failed + " failed");
console.log("========================================\n");

if (failed > 0) {
    console.error("TIMEZONE LOCKDOWN FAILED");
    process.exit(1);
} else {
    console.log("TIMEZONE LOCKDOWN VERIFIED");
    process.exit(0);
}
