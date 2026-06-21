# FOOD_SAFETY_MISSING_SUBMISSION_ALERT_REPORT.md
Generated: 2026-06-17T03:41:00Z

## Verdict: PASS

---

## What Was Built

### 6 New Files Created

1. **`src/submissionDueConfig.js`** — Store group config with expected submission times
   - Default config: Stone Oak with AM (11:00) and PM (16:00) line checks
   - 15-minute grace period per slot
   - `isValidFormSubmission()` — enforces valid status + OCR confidence > 20 + items present

2. **`src/missingSubmissionDetector.js`** — Detects missing submissions past deadline+grace
   - Checks all enabled store groups
   - Returns alert messages with store name, deadline, and status
   - `getSubmissionStatus()` — dashboard panel data

3. **`src/alertAuditLog.js`** — Audit trail with duplicate prevention
   - `missing_submission_alerts` DB table
   - `wasAlertSentToday()` — prevents duplicate alerts per store+label per day
   - Records all alert attempts (sent/suppressed)

4. **`src/managerAlertService.js`** — WhatsApp alert sender
   - Sends to group, manager phones, and admin phones
   - Respects `alert_targets` config per store group
   - Integrates with existing `clientManager`

5. **`src/missingSubmissionScheduler.js`** — Cron scheduler (60s interval)
   - `start()` / `stop()` / `runCheck()` / `getStatus()`
   - Non-blocking, re-entrant check cycles
   - Started automatically on gateway boot

6. **`tests/test_missing_submission.js`** — 20/20 tests PASSED

### 2 Files Modified

7. **`src/database.js`** — Added sync helper exports (`getAllSync`, `getOneSync`, `runSync`)
8. **`src/index.js`** — Added 5 API endpoints + scheduler auto-start

---

## Test Results (20/20 PASSED)

| Test | Result |
|------|--------|
| Test 1: Before deadline = no alert | PASS |
| Test 2: After deadline with valid form = no alert | PASS |
| Test 3: After deadline with no form = alert | PASS |
| Test 4: After deadline with unreadable image only = alert | PASS |
| Test 5: After deadline with evidence photo only = alert | PASS |
| Test 6: After deadline with cancelled submission = alert | PASS |
| Test 7: Duplicate alert prevention | PASS |
| Test 8: Manual override / mark received | PASS |
| Edge: Null submission | PASS |
| Edge: Undefined submission | PASS |
| Edge: Missing ocr_json | PASS |
| Edge: Invalid ocr_json | PASS |
| Edge: Empty items array | PASS |
| Edge: Minimal valid submission | PASS |
| Format: Store name in alert | PASS |
| Format: "missing" in alert | PASS |
| Format: Deadline time in alert | PASS |
| Format: Correct store_id | PASS |
| Format: Correct label | PASS |

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/missing-submissions/status` | GET | Dashboard panel data |
| `/api/missing-submissions/check` | POST | Manual trigger detection |
| `/api/missing-submissions/scheduler` | GET | Scheduler status |
| `/api/missing-submissions/scheduler/start` | POST | Start scheduler |
| `/api/missing-submissions/scheduler/stop` | POST | Stop scheduler |

---

## Missing Submission Config

```json
{
  "store_id": "stone_oak",
  "store_name": "Bakudan Stone Oak",
  "group_id": "stone-oak-safety",
  "expected_submissions": [
    { "label": "AM Line Check", "time": "11:00", "grace_minutes": 15 },
    { "label": "PM Line Check", "time": "16:00", "grace_minutes": 15 }
  ],
  "alert_targets": { "group": true, "manager": true, "admin": true }
}
```

---

## Sample Alert Message

```
⚠️ Food Safety form is missing.

Store: Bakudan Stone Oak
Expected submission: 11:00 AM
Status: No readable form received.

Please upload a clear photo of the completed Food Safety form.
```

---

## Validation Rules

A submission counts as received ONLY if:
- Image uploaded ✓
- OCR started ✓
- OCR produced readable form result (confidence > 20) ✓
- Submission linked to store ✓
- Status is CONFIRMED / MANAGER_REVIEW / SAVED ✓

Do NOT count:
- Unknown image (confidence < 20) ✗
- Evidence photo only (no OCR items) ✗
- Unreadable OCR (empty items) ✗
- Cancelled submission ✗
- PENDING status (not yet confirmed) ✗

---

## Known Limitations

1. WhatsApp group ID must be configured in `group_id` field
2. Manager/admin phone numbers must be populated in config
3. WhatsApp client must be CONNECTED for alerts to send
4. Default config is Stone Oak only — other stores need config added

---

## Files Changed

| File | Action |
|------|--------|
| `src/submissionDueConfig.js` | CREATED |
| `src/missingSubmissionDetector.js` | CREATED |
| `src/alertAuditLog.js` | CREATED |
| `src/managerAlertService.js` | CREATED |
| `src/missingSubmissionScheduler.js` | CREATED |
| `src/database.js` | MODIFIED (added sync exports) |
| `src/index.js` | MODIFIED (added API + scheduler startup) |
| `tests/test_missing_submission.js` | CREATED |

---

## CEO Approval Criteria

- [x] Bot alerts when no valid OCR-readable form is uploaded by due time
- [x] Evidence photos do not count as form submissions
- [x] Unreadable OCR does not count
- [x] Duplicate alerts are prevented
- [x] Dashboard shows missing submission status

**PASS**
