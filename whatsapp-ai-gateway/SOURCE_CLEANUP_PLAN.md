# Source Cleanup Plan

Audit date: 2026-06-20

Do not delete data. This plan classifies source and runtime paths only.

| Item | Classification | Rationale | Action |
|---|---|---|---|
| `src/clientManager.js` | KEEP | Owns WhatsApp connection and inbound handler | Keep; ensure image branch never sends if `handleImageMessage()` returns `null` |
| `src/foodSafetyHandler.js` | KEEP | Canonical food-safety image and confirmation pipeline | Keep; split later into smaller pipeline stage modules |
| `src/formImageRouter.js` | KEEP | Single source of group/store/form routing | Keep |
| `src/imageQualityGate.js` | KEEP | Required pre-OCR gate | Keep |
| `paddleocr_bridge.js` | KEEP | Preferred OCR bridge | Keep |
| `src/ocr.js` Tesseract fallback | MERGE | Still needed for quick form detection/fallback, but must stay review-only | Rename/document as fallback OCR and prevent direct final writes |
| `src/handwriting/*` | KEEP | Runtime memory and confirmed sample store | Keep |
| `src/handwriting/api.js` | TEST_ONLY | Admin/API surface for memory, not canonical WhatsApp pipeline | Gate or document as admin-only |
| `src/handwriting/writerProfile.js` | KEEP | Runtime writer profile step | Keep |
| `src/storeKnowledge.js` | KEEP | Store-specific safety rules | Keep |
| `src/visionAiReviewer.js` | KEEP | Runtime vision reviewer/skip-reason layer | Keep |
| `src/vision/providers/*` | KEEP | Provider abstraction | Keep |
| `src/foodSafetyDecisionEngine.js` | KEEP | Final value and alert gate authority | Keep |
| `src/foodSafetyAlertComposer.js` | KEEP | Canonical management alert composer | Keep |
| `src/zeroRetakeReplyBuilder.js` | KEEP | Canonical user reply builder | Keep |
| `src/pilot/livePilotMetrics.js` | KEEP | Pilot metrics and proof | Keep |
| `src/managerAlertService.js` | KEEP | Low-level transport for allowed alerts/reminders | Keep; only call from composer/scheduler |
| `src/missingSubmissionScheduler.js` | KEEP | Allowed missing reminder path | Keep |
| `src/googleSheet.js` | KEEP | Confirmed sheet sync | Keep; add DB sync-status update later |
| `src/failureEscalationService.js` | DISABLE | Legacy direct alert sender path | Disabled by default; later delete or merge `getStoreGroup()` into config |
| `/api/food-safety/submit` | DISABLE | Known dashboard parse/write bypass | Keep blocked |
| `/api/food-safety/command` | DISABLE | Can confirm through API if enabled | Keep blocked unless test/admin env explicitly set |
| `/api/whatsapp/send` | DISABLE | Arbitrary WhatsApp send bypass | Keep blocked unless admin env explicitly set |
| `src/tools/*` | TEST_ONLY | Imports/probes/gate checks | Move under explicit tools/test namespace |
| Root report markdown files | MERGE | Many historical reports obscure current source truth | Consolidate into `docs/archive/` index |
| `TRACE_SUBMISSION_*.json` old artifacts | MERGE | Useful evidence but not accepted trace proof | Move to archived evidence folder after current proof is generated |

## Next Cleanup Sequence

1. Capture one real LD Agent-Logtest image with `HYBRID_TRACE_ENABLED=true` and `HYBRID_TRACE_GROUPS` including the group id/name.
2. If the trace passes, archive old `TRACE_SUBMISSION_*.json` files that lack `pipeline_trace_recorded`.
3. Split `foodSafetyHandler.js` into `pipelineStages/` only after live proof is captured.
4. Delete or quarantine `failureEscalationService.js` direct senders after verifying no external import uses them.
5. Add CI checks that fail on new `msg.reply`, `client.sendMessage`, `insertSubmission`, or `syncSubmission` call sites outside the allowlist.

