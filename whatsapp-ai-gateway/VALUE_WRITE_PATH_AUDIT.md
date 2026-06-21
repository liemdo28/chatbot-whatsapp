# Value Write Path Audit

Audit date: 2026-06-20

Rule: no final value may be saved unless it passed OCR -> Memory -> Store Knowledge -> Vision if needed -> Decision Engine -> Confirmation / safe rule.

| file | function | source of value | passes through Decision Engine? | passes through Vision/Memory/Store Knowledge? | allowed? |
|---|---|---|---:|---:|---|
| `src/database.js` | `insertSubmission()` | `processSubmissionBatch()` parsed items | yes, after final decision pass | yes, vision executed or skipped with reason | yes, pending record only |
| `src/foodSafetyHandler.js` | `processSubmissionBatch()` -> `db.insertSubmission()` | OCR/Paddle or fallback + memory + vision + decision | yes | yes | yes, status `PENDING` |
| `src/foodSafetyHandler.js` | `confirmSubmission()` -> `db.updateSubmissionOcr()` | confirmed/edit/manual pending submission | yes, from prior image pipeline | yes, from prior image pipeline | yes, final write |
| `src/googleSheet.js` | `syncSubmission()` | confirmed `sub.parsed.items` | yes, prior pipeline | yes, prior pipeline | yes, only after confirmation; pending sync is skipped |
| `src/foodSafetyHandler.js` | `handleManualEntry()` -> `db.insertEdit()` | manual command values | not immediately final | prior pending pipeline exists | yes, audit/edit log only |
| `src/foodSafetyHandler.js` | `handleEdit()` -> `db.insertEdit()` | edit command value | not immediately final | prior pending pipeline exists | yes, audit/edit log only |
| `src/handwriting/confirmedSamples.js` | `saveConfirmedSubmission()` | confirmed submission values | yes, prior pipeline | yes | yes, memory training after confirm |
| `src/handwriting/cellCropStorage.js` | `saveSubmissionCrops()` | confirmed submission crops/values | yes, prior pipeline | yes | yes, memory training after confirm |
| `src/handwriting/conflictResolver.js` | `recordRuntimePredictionAudit()` | predicted/final suggested values | yes | yes | yes, audit table only |
| `src/pilot/livePilotMetrics.js` | `recordPilotSubmission()` | submission metrics | yes | yes | yes, telemetry only |
| `src/pilot/livePilotMetrics.js` | `recordWriterMemoryProof()` | field-level prediction proof | yes | yes | yes, telemetry only |
| `src/index.js` | `/api/food-safety/submit` old dashboard write | uploaded image -> `parseTemperatures()` | no | no | no, disabled |
| `src/index.js` | `/api/food-safety/command` | API command could confirm pending values | prior pipeline only if pending exists | prior pipeline only if pending exists | disabled by default |
| `src/tools/*` | import/validation scripts | ground truth/test fixtures | no | no | TEST_ONLY |

## Findings

- The known bypass `/api/food-safety/submit -> parseTemperatures() -> insertSubmission()` is blocked with HTTP 403.
- `confirmSubmission()` now updates final `detected_items`, `ocr_json`, confidence, and status before sheet sync.
- Google Sheet sync is explicitly skipped for pending submissions and traced as `SHEET_SYNC_DONE=SKIPPED/PENDING_CONFIRMATION`.
- The Tesseract fallback remains connected but is review-only: it sets `manualRequired=true` and still passes through memory, store knowledge, vision skip/review, and the Decision Engine before any pending DB write.

