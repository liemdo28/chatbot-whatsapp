# FOOD_SAFETY_RUNTIME_STATE_CLEANUP.md

**CEO DIRECTIVE - Food Safety Source Cleanup & Legacy Workflow Removal**
**Author:** Dev1
**Date:** 2026-06-29
**Build HEAD:** `50e618ac3a1afa52d1906851d659c28aa46a7231`

This is the STEP 3 + STEP 4 cleanup report. Stale runtime state was
audited, the legacy-row cleanup script was run against the live DB, and
confirmed numeric submissions were preserved.

---

## 1. In-memory runtime state

| State container | Status | Notes |
|---|---|---|
| `clientManager._processedImages` | cleared on restart | ephemeral dedup only |
| `clientManager._processedMessageIds` | cleared on restart | ephemeral dedup only |
| `clientManager._processedMediaIds` | cleared on restart | ephemeral dedup only |
| `clientManager._processedChatTimestamps` | cleared on restart | ephemeral dedup only |
| `clientManager._activeProcessing` | cleared on restart | ephemeral in-flight guard |
| `foodSafetyPilotGuard._photoInstructionSent` | per-process | once-per-user-per-shift throttle |
| `sessions[phone].pendingSubmission` | numeric-only | no legacy image path writes this anymore |
| `sessions[phone].pendingStoreConfirmation` | legacy residue only | no active code sets it |
| `sessions[phone].waitingFor` | numeric-only in live path | `numeric_action` is the active state |
| `sessions[phone].lastImageHash` | retired | no active image workflow uses it |

Safe cleanup rule applied:

> Delete or mark `CANCELLED` / `SUPERSEDED_LEGACY` only legacy pending
> image-based submissions. Keep confirmed numeric submissions.

---

## 2. Legacy queues

* Image/OCR/Vision processing queues: none persisted.
* OCR/Vision retry queues: none persisted.
* Google Sheet retry queue: still active, but it is submission-based and
  not an OCR queue.

---

## 3. Live DB cleanup run

Script used:

```powershell
cd C:\Ld-project\whatsapp-ai-gateway
node scripts/cleanLegacyFoodSafetyRows.js
```

Observed output:

```text
[LEGACY_CLEANUP] DB: C:\Ld-project\whatsapp-ai-gateway\data\gateway.db
[LEGACY_CLEANUP] Mode: LIVE
[LEGACY_CLEANUP] PENDING rows with image_path set: 0
[LEGACY_CLEANUP] PENDING rows with OCR/Vision json markers: 0
[LEGACY_CLEANUP] PENDING numeric-text rows (will NOT be touched): 6
[LEGACY_CLEANUP] No legacy rows to clean.
```

Interpretation:

* No legacy image-based `PENDING` rows remained.
* No OCR/Vision-marked `PENDING` rows remained.
* Six `PENDING` rows remained, all numeric-text rows, and they were
  preserved exactly as required.

The cleanup script is idempotent and safe to rerun.

---

## 4. Reminder hardening

Reminder cancellation now depends on confirmed numeric submissions only.

Important source-level protections:

* `src/submissionDueConfig.js -> isValidFormSubmission()` rejects:
  * `PENDING`
  * `CANCELLED`
  * `SUPERSEDED`
  * `SUPERSEDED_LEGACY`
  * any legacy OCR/Vision pipeline in `ocr_json.runtime_pipeline`
* `src/missingSubmissionDetector.js` now matches submissions by explicit
  numeric metadata first:
  * `business_date`
  * `shift`
  * `store_code` / `store_name`
* `src/numericTextHandler.js` now persists `shift`, `business_date`,
  `timezone`, and `confirmed_at` back into the submission payload on
  confirm.

This closes the gap where confirmed numeric submissions could fail to
cancel reminders because of DB date-format mismatches.

---

## 5. Validation

Executed successfully on 2026-06-29:

```powershell
node tests/testWorkflowIsolationP0.js
node tests/testOptionCLockdown.js
node tests/testLegacyWorkflowRemoval.js
```

Highlights:

* `SAVE-5` through `SAVE-9` now pass: confirmed numeric submissions block
  reminders correctly.
* `E2E-20` now passes: `/agent -> 19 values -> 1 confirm -> DB save -> no reminder`.
* Legacy wording/image suppression tests remain green.

---

## 6. Pre-flight summary

```text
Database:
  food_safety_submissions
    PENDING total: 6
    PENDING with image_path: 0
    PENDING with OCR/Vision json markers: 0
    PENDING numeric-text rows preserved: 6
  google_sheet_retry_queue
    legacy-linked PENDING entries: 0

Runtime:
  legacy image path unreachable from Food Safety groups
  numeric submissions persist shift/business_date metadata
  one inbound message -> one reply max
```

**Status:** STALE RUNTIME STATE CLEANED
