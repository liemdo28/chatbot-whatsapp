# SHIFT AND TIMEZONE VALIDATION REPORT
## CEO Directive — P0 Timezone Lock
### Date: 2026-06-28

---

## Requirements

1. All Food Safety time calculations use `America/Chicago` timezone
2. No Vietnam-time reminders
3. No server-local-time assumptions
4. 10AM reminder only sent 10:30–11:00 AM Chicago
5. 4PM reminder only sent 4:30–5:00 PM Chicago
6. Each reminder window only checks its own shift
7. Reminder dedup: store_code + business_date + shift

---

## Implementation

### Timezone Functions (submissionDueConfig.js)

- `STORE_TIMEZONE = "America/Chicago"` — single constant
- `nowInChicago()` — Date object in Chicago local
- `getBusinessDateChicago(date)` — YYYY-MM-DD string
- `getChicagoHourMinute(date)` — { hour, minute } object

### Shift Detection (numericTextHandler.js)

On confirm (reply "1"):
1. Get `getChicagoHourMinute()`
2. `hour < 14 ? "10AM" : "4PM"`
3. Store in `ocr_json.shift`, `ocr_json.business_date`, `ocr_json.timezone`

### Reminder Windows (missingSubmissionDetector.js)

```javascript
const SHIFT_WINDOWS = [
    { shift: "10AM", windowStart: {hour:10,minute:30}, windowEnd: {hour:11,minute:0} },
    { shift: "4PM",  windowStart: {hour:16,minute:30}, windowEnd: {hour:17,minute:0} },
];
```

`getActiveShiftWindow(nowChic)` returns null outside windows → no reminders sent.

### Shift Matching in findSubmissionsForShift()

Priority 1: Explicit `ocr_json.shift === shift` match
Priority 2: Timestamp-based Chicago local time window match

---

## Test Coverage (41 timezone tests)

| Group | Tests | Status |
|-------|-------|--------|
| UTC to Chicago conversion | 4 | PASS |
| Vietnam morning 7AM (no reminder) | 2 | PASS |
| Before 10:30 AM CT (no window) | 2 | PASS |
| 10:30 AM CT (10AM window active) | 4 | PASS |
| 10:45 AM CT (10AM only) | 3 | PASS |
| 11:01 AM CT (window closed) | 2 | PASS |
| Before 4:30 PM CT (no window) | 2 | PASS |
| 4:30 PM CT (4PM window active) | 4 | PASS |
| 4:45 PM CT (4PM only) | 3 | PASS |
| 5:01 PM CT (window closed) | 2 | PASS |
| Night time Chicago (no reminder) | 2 | PASS |
| Business date crossing | 3 | PASS |
| Shift window definitions | 8 | PASS |

**Total: 41 passed, 0 failed**

---

## Forbidden Patterns Verified

- [x] No Vietnam-time reminders at 7AM Vietnam
- [x] No reminders before 10:30 AM CT
- [x] No reminders between 11:01 AM and 4:29 PM CT
- [x] No reminders after 5:00 PM CT
- [x] Morning window never checks 4PM shift
- [x] Afternoon window never checks 10AM shift

---

## Status

```
SHIFT/TIMEZONE LOCKED
AMERICA/CHICAGO ONLY
```
