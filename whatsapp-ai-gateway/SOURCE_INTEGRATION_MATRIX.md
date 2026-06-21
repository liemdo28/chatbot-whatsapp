# Source Integration Matrix

Audit date: 2026-06-20

Status legend: `CONNECTED`, `DISCONNECTED`, `BYPASS`, `DUPLICATE`, `LEGACY`

| Module | Exists | Imported by runtime | Called in live path | Produces output | Can send WhatsApp reply | Can write DB | Status |
|---|---:|---:|---:|---:|---:|---:|---|
| `formImageRouter.js` | yes | yes, `clientManager.js`, `foodSafetyHandler.js` | yes | group/store/form routing | no | router log only | CONNECTED |
| `foodSafetyHandler.js` | yes | yes, `clientManager.js`, `index.js` | yes | canonical processing, replies, trace | yes, final image reply/text command replies | yes, via `database.js` | CONNECTED |
| `imageQualityGate.js` | yes | yes, `foodSafetyHandler.js` | yes | size/quality decisions | no | no | CONNECTED |
| `paddleocr_bridge.js` | yes | dynamic, `foodSafetyHandler.getPaddleBridge()` | yes if service available | OCR cell extraction | no | no | CONNECTED |
| `handwriting/*` | yes | yes, `foodSafetyHandler.js`, `index.js` | yes | memory predictions and confirmed samples | no | yes, memory tables | CONNECTED |
| `writerProfile.js` | yes | yes, `foodSafetyHandler.js` | yes | writer profile metadata | no | yes, writer profile table | CONNECTED |
| `storeKnowledge.js` | yes | yes, `foodSafetyHandler.js`, `visionAiReviewer.js`, `foodSafetyDecisionEngine.js` | yes | critical-field/range rules | no | no | CONNECTED |
| `visionAiReviewer.js` | yes | yes, `foodSafetyHandler.js`, `foodSafetyDecisionEngine.js` | yes, may skip with reason | field review results | no | yes, `vision_review_log` | CONNECTED |
| `vision/providers/*` | yes | yes, via `visionAiReviewer.js` | yes, provider selected at runtime | OpenAI/disabled provider result | no | no | CONNECTED |
| `foodSafetyDecisionEngine.js` | yes | yes, `foodSafetyHandler.js` | yes after memory/vision | final suggested values + alert gates | no | no | CONNECTED |
| `foodSafetyAlertComposer.js` | yes | yes, `foodSafetyHandler.js` | yes | one consolidated alert payload | yes, via `managerAlertService` | alert audit via downstream | CONNECTED |
| `zeroRetakeReplyBuilder.js` | yes | yes, `foodSafetyHandler.js` | yes | final user confirmation reply text | indirect via `processBatch()` | no | CONNECTED |
| `livePilotMetrics.js` | yes | yes, `index.js`, `foodSafetyHandler.js` | yes | pilot submission/proof metrics | no | yes | CONNECTED |
| `managerAlertService.js` | yes | yes, `index.js`, `foodSafetyAlertComposer.js`, `missingSubmissionScheduler.js` | yes for allowed alert/reminder paths | management/source-group alerts | yes | yes, alert audit | CONNECTED |
| `missingSubmissionScheduler.js` | yes | yes, `index.js`, `foodSafetyHandler.confirmSubmission()` | yes | missing/peer reminders | yes, via `managerAlertService` | yes, alert audit | CONNECTED |
| `googleSheet.js` | yes | yes, `index.js`, `foodSafetyHandler.js` | yes on confirmation | sheet append or safe skip | no | updates external sheet only | CONNECTED |
| `failureEscalationService.js` | yes | yes, only `getStoreGroup` live | direct alert senders disabled by default | legacy alert payloads if env enabled | yes if explicitly enabled | yes via downstream | LEGACY |
| `/api/food-safety/submit` | yes | Express route | blocked | none | no | no | BYPASS blocked |
| `/api/food-safety/command` | yes | Express route | blocked by default | none unless env enabled | can reply if enabled | can confirm if enabled | BYPASS blocked |
| `/api/whatsapp/send` | yes | Express route | blocked by default | none unless env enabled | yes if enabled | message log if enabled | BYPASS blocked |

## Key Connection Changes Made

- Final Decision Engine now runs after vision review, not before it.
- Vision-fused values now have an explicit Decision Engine branch.
- Legacy direct escalation sends are disabled unless `FOOD_SAFETY_ENABLE_LEGACY_ESCALATION=true`.
- Dashboard and arbitrary send APIs are disabled unless explicit env flags are set.
- `trace_id` is persisted to `food_safety_submissions`.
- Confirmation updates final DB values before Google Sheet sync.

