# FOOD SAFETY REMINDER SCHEDULE LOCKDOWN

**CEO DIRECTIVE — EFFECTIVE IMMEDIATELY**
**Date:** 2026-06-26
**Status:** LOCKED ✅

---

## Problem Statement

Food Safety reminders were being sent at wrong times — based on Vietnam server time (UTC+7) instead of store local time (America/Chicago, UTC-5/-6 CDT). Employees in San Antonio, TX were receiving reminders at 7:00 AM Vietnam time, which is 6:00 PM CDT — completely wrong.

---

## Approved Reminder Schedule

| Store | Store Code | Timezone |
|-------|-----------|----------|
| Bakudan The Rim | B1 | America/Chicago |
| Bakudan Stone Oak | B2 | America/Chicago |
| Bakudan Bandera | B3 | America/Chicago |

All stores operate in **San Antonio, Texas, USA** — timezone **America/Chicago**.

---

## Required Daily Submission Times

| Shift | Expected Submission Time | Reminder Window |
|-------|------------------------|----------------|
| AM Line Check | 10:00 AM CT | 10:30 AM – 11:00 AM CT |
| PM Line Check | 4:00 PM CT | 4:30 PM – 5:00 PM CT |

---

## Locked Reminder Logic

```
currentStoreTime = now converted to America/Chicago

if currentStoreTime is between 10:30 AM and 11:00 AM CT:
    check missing 10AM submission ONLY
else if currentStoreTime is between 4:30 PM and 5:00 PM CT:
    check missing 4PM submission ONLY
else:
    send NO missing submission reminders
```

---

## Hard Rules

| Rule | Description | Status |
|------|-------------|--------|
| Rule 1 | Do not use Vietnam time (Asia/Ho_Chi_Minh, server local time) | ✅ LOCKED |
| Rule 2 | Do not remind before the deadline | ✅ LOCKED |
| Rule 3 | Do not send both reminders at the same time | ✅ LOCKED |
| Rule 4 | Reminder must be per store, per date, per shift | ✅ LOCKED |
| Rule 5 | Confirmed submission cancels reminder | ✅ LOCKED |

---

## Reminder Text Format (Locked)

```
⚠️ Food Safety submission is missing.

Store: [Store Name] / [B1/B2/B3]
Expected submission: 10:00 AM / 4:00 PM
Status: No numeric temperature submission received.

Please type /agent and enter the 19 temperature readings.
Paper forms should still be completed and kept for records.
```

---

## Deduplication Key Format

```
store_code + business_date_America_Chicago + shift

Example: B2|2026-06-26|10AM
```

Once sent, the same reminder will NOT be sent again for the same store/date/shift.

---

## Files Modified

| File | Change |
|------|--------|
| `src/submissionDueConfig.js` | Added `STORE_TIMEZONE`, `nowInChicago()`, `getBusinessDateChicago()`, `getChicagoHourMinute()`, `buildDeadlineInChicago()`. All deadline calculations now use America/Chicago. |
| `src/missingSubmissionDetector.js` | Complete rewrite: CEO-LOCKED shift windows, only checks during valid reminder windows, per-store/date/shift dedup, confirmed submission cancellation. |
| `src/database.js` | Added `food_safety_reminder_log` table, `wasReminderSentToday()`, `markReminderSent()`, `getRemindersSentToday()`. |
| `tests/testFoodSafetyTimezoneLockdown.js` | 41 tests proving timezone correctness. |

---

## Test Results

**41 tests passed, 0 failed**

All tests verify:
- Vietnam morning time (7:00 AM) produces ZERO reminders
- 10:29 AM Chicago produces ZERO reminders  
- 10:30 AM–11:00 AM Chicago produces ONLY 10AM reminders
- 4:29 PM Chicago produces ZERO reminders
- 4:30 PM–5:00 PM Chicago produces ONLY 4PM reminders
- Night time produces ZERO reminders
- Business date uses Chicago timezone
- Shift windows are correctly defined

---

## Final Status

```
✅ REMINDER TIMEZONE LOCKED: America/Chicago
✅ REMINDER WINDOWS LOCKED: 10:30-11:00 AM CT, 4:30-5:00 PM CT
✅ 10AM REMINDER ONLY AFTER 10:30AM SAN ANTONIO
✅ 4PM REMINDER ONLY AFTER 4:30PM SAN ANTONIO
✅ NO VIETNAM-TIME REMINDERS
✅ NO DUPLICATE REMINDERS (dedup table + key)
✅ CONFIRMED SUBMISSION CANCELS REMINDER
✅ CONTROLLED PILOT SAFE
```
