# Database Validation Report

Generated: 2026-06-25 05:29:35 PDT

## Result

Database validation for live submissions: BLOCKED.

Reason: production database is reachable and schema is present, but there are zero food safety submissions after deployment.

## Production Database

Path: `C:\Ld-project\whatsapp-ai-gateway\data\gateway.db`

| Check | Result | Evidence |
| --- | --- | --- |
| DB file reachable | PASS | SQLite database opened successfully |
| Food safety table present | PASS | `food_safety_submissions` exists |
| Retry queue table present | PASS | `google_sheet_retry_queue` exists |
| Current submission count | OBSERVED | `0` |
| Current confirmed submission count | OBSERVED | `0` |
| Current retry queue count | OBSERVED | `0` |

## Required Field Validation

No confirmed production submissions exist to validate these required fields:

| Field | Status |
| --- | --- |
| submission id | BLOCKED |
| store | BLOCKED |
| timestamp | BLOCKED |
| raw_values | BLOCKED |
| mapped_values | BLOCKED |
| validation_result | BLOCKED |
| editor_history | BLOCKED |
| confirmation status | BLOCKED |

## Integrity Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Duplicate IDs | PASS | No duplicate IDs found; table is empty |
| Orphan core rows | PASS | No rows with missing core fields found; table is empty |
| Failed Sheet sync rows | PASS | No rows with `sheetsync_status='FAILED'`; table is empty |
| Failed inserts | BLOCKED | Cannot validate live insert behavior because no live submission was made |

## Schema Evidence

The production table includes the required numeric workflow columns:

- `id`
- `store_name`
- `created_at`
- `raw_values`
- `mapped_values`
- `validation_result`
- `editor_history`
- `status`
- `sheetsync_status`
- `sheetsync_attempts`
- `sheetsync_last_error`
- `sheetsync_last_attempt`

Note: the database uses `id` as the submission identifier. The retry queue column is named `submission_id` and references `food_safety_submissions.id`.

## Controlled Non-Live Evidence

The deterministic workflow test passed:

- Command: `node tests\testNumericTextWorkflow.js`
- Result: 58 passed, 0 failed
- Coverage includes DB save after `1 = Confirm`, edit history update, re-enter, cancel, duplicate pending behavior, and no OCR/Vision/API-key dependency.

This does not replace live production DB validation.

