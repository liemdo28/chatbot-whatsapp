# WhatsApp Reply Sender Audit

Audit date: 2026-06-20

Allowed sender classes:

1. Final user reply from Decision/Reply Builder
2. One consolidated management alert from Alert Composer
3. Missing submission reminder

| file | function | purpose | can send to group? | is final reply? | is alert? | is legacy? | allowed? |
|---|---|---|---:|---:|---:|---:|---|
| `src/foodSafetyHandler.js` | `processBatch()` | Sends the image-processing confirmation reply built by `zeroRetakeReplyBuilder` | yes | yes | no | no | yes |
| `src/clientManager.js` | `unifiedHandler()` image branch `msg.reply(reply)` | Would send if `handleImageMessage()` returned text; current image handler returns `null` | yes | potential | no | duplicate guard | no if reactivated |
| `src/clientManager.js` | `unifiedHandler()` text branch `msg.reply(reply)` | Sends text command responses such as help/confirm/edit/cancel | yes | sometimes confirmation response | no | no | limited; not an image-value bypass |
| `src/clientManager.js` | `sendMessage()` / `client.sendMessage()` | Generic send helper used by alert service | yes | no | downstream dependent | no | only through allowed services |
| `src/managerAlertService.js` | `sendChatMessage()` | Sends management/source-group alert messages | yes | no | yes | no | yes when called by Alert Composer or Missing Scheduler |
| `src/foodSafetyAlertComposer.js` | `sendConsolidatedAlert()` | Sends one consolidated management alert | yes | no | yes | no | yes |
| `src/missingSubmissionScheduler.js` | `runCheck()` / `runPeerMissingCheck()` | Sends missing submission reminders | yes | no | reminder | no | yes |
| `src/foodSafetyHandler.js` | `schedulePendingFollowups()` reminder timer | Pending confirmation reminder | yes | no | no | extra sender | disabled by default |
| `src/foodSafetyHandler.js` | `schedulePendingFollowups()` auto-confirm timer | Auto-confirm saved reply | yes | yes | no | extra sender | disabled by default |
| `src/failureEscalationService.js` | `escalateUnsafeTemperature()` | Legacy direct unsafe alert | yes | no | yes | yes | disabled by default |
| `src/failureEscalationService.js` | `escalateLowConfidence()` | Legacy direct low-confidence alert | yes | no | yes | yes | disabled by default |
| `src/failureEscalationService.js` | `escalateMissingForm()` | Legacy direct missing-form alert | yes | no | yes | yes | disabled by default |
| `src/failureEscalationService.js` | `escalateOCRFailure()` | Legacy direct OCR-failure alert | yes | no | yes | yes | disabled by default |
| `src/failureEscalationService.js` | `autoEscalateV2()` | Legacy consolidated-ish review alert | yes | no | yes | yes | disabled by default |
| `src/index.js` | `/api/whatsapp/send` | Arbitrary manual WhatsApp send | yes | arbitrary | arbitrary | bypass | disabled by default |

## Result

The live image path now has one active final user sender: `foodSafetyHandler.processBatch()`.

The live management alert path now routes through `foodSafetyAlertComposer.sendConsolidatedAlert()` and `managerAlertService`.

Missing submission reminders remain allowed through `missingSubmissionScheduler`.

Remaining non-canonical senders are either disabled by default or limited to non-image text command responses.

