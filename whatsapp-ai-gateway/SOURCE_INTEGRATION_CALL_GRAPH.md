# Source Integration Call Graph

Audit date: 2026-06-20

Verdict: `CONNECTED_PIPELINE_FAIL`

Reason: source is now materially more connected, but there is no accepted live LD Agent-Logtest image trace proving the full canonical path. The running gateway is connected and the LD Agent-Logtest group exists, but `/api/food-safety/pipeline-trace` returned no trace rows and the existing `TRACE_SUBMISSION_40.json` / `TRACE_SUBMISSION_44.json` files both record `pipeline_trace_recorded: false`.

## Live WhatsApp Image Call Graph

| Step | file | function | called_by | calls_next | active_in_live_runtime |
|---|---|---|---|---|---|
| Server boot | `src/index.js` | `start()` | Node entrypoint `src/index.js` | `clientManager.initializeClient()` | true |
| WhatsApp event binding | `src/clientManager.js` | `initializeClient()` | `src/index.js:start()` | `client.on("message")`, `client.on("message_create")` | true |
| Unified inbound handler | `src/clientManager.js` | `unifiedHandler(msg)` | WhatsApp `message` / `message_create` events | `getGroupScope()`, `handleImageMessage()` or `handleTextMessage()` | true |
| Group routing | `src/formImageRouter.js` | `getGroupScope()` | `clientManager.unifiedHandler()` | returns enabled/processing/store scope | true |
| Image handoff | `src/foodSafetyHandler.js` | `handleImageMessage()` | `clientManager.unifiedHandler()` | `addToBatch()` | true |
| Batch enqueue | `src/foodSafetyHandler.js` | `addToBatch()` | `handleImageMessage()` | `setTimeout(() => processBatch())` | true |
| Batch processor | `src/foodSafetyHandler.js` | `processBatch()` | timer from `addToBatch()` | `processSubmissionBatch()`, then `message.reply()` | true |
| Canonical pipeline start | `src/foodSafetyHandler.js` | `processSubmissionBatch()` | `processBatch()` | trace `IMAGE_RECEIVED`, `ROUTER_STARTED`, `GROUP_RESOLVED` | true |
| Image persistence | `src/foodSafetyHandler.js` | `saveMessageImage()` | `processSubmissionBatch()` | writes evidence image; returns path/hash | true |
| Form quick gate | `src/foodSafetyHandler.js` | `quickFormCheck()` | `processSubmissionBatch()` | `performImageOCR()`, `isFormLikely()`, `resolveStoreFromContext()` | true |
| Strict form classifier | `src/formImageRouter.js` | `isFormLikely()` | `quickFormCheck()` | returns form/non-form | true |
| Store resolver | `src/formImageRouter.js` | `resolveStoreFromContext()` | `quickFormCheck()` | returns store/template info | true |
| Store/group validation | `src/formImageRouter.js` | `validateStoreGroupMatch()` | `processSubmissionBatch()` | reject mismatched production group | true |
| Image size gate | `src/imageQualityGate.js` | `checkMinimumImageSize()` | `processSubmissionBatch()` | hard retake before OCR if too small | true |
| Image quality scoring | `src/imageQualityGate.js` | `evaluateImageQuality()` | `processSubmissionBatch()` | confidence adjustment, not direct retake | true |
| OCR service gate | `src/foodSafetyHandler.js` | `isPaddleOCRAvailable()` | `processSubmissionBatch()` / `fullFormOCR()` | `paddleocr_bridge.isServiceAvailable()` | true |
| Full OCR | `src/foodSafetyHandler.js` | `fullFormOCR()` | `processSubmissionBatch()` | Paddle extraction or review-only Tesseract fallback | true |
| Paddle OCR bridge | `paddleocr_bridge.js` | `extractFromImage()` | `fullFormOCR()` | returns template/cell items | true when service is available |
| Review-only OCR fallback | `src/ocr.js` | `performOCR()`, `parseTemperatures()` | `fullFormOCR()` | `manualRequired=true`, no direct final save | true fallback |
| Handwriting memory | `src/foodSafetyHandler.js` | `applyMemoryPredictions()` | `processSubmissionBatch()` | `handwriting.predictionEngine.predictFormValues()` | true |
| Writer profile | `src/handwriting/writerProfile.js` | `detectWriterFromSubmission()`, `getOrCreateWriterProfile()` | `processSubmissionBatch()` | writer profile trace output | true |
| Store knowledge | `src/storeKnowledge.js` | `getStoreKnowledge()`, `getFieldsRequiringVisionReview()` | `processSubmissionBatch()` / `visionAiReviewer` | critical field and bad OCR rules | true |
| Preliminary decision | `src/foodSafetyDecisionEngine.js` | `decideFormValues()` | `processSubmissionBatch()` | selects fields for vision review | true |
| Vision review selector | `src/visionAiReviewer.js` | `getFieldsNeedingVisionReview()` | `processSubmissionBatch()` | provider call or explicit skip reason | true |
| Vision provider | `src/vision/providers/index.js` | `getProvider()` | `visionAiReviewer.reviewFields()` | `disabledVision` or `openaiVision` | true, may skip by env |
| Vision reviewer | `src/visionAiReviewer.js` | `reviewFields()`, `fuseVisionResult()` | `processSubmissionBatch()` | final decision input | true when enabled/needed |
| Final decision engine | `src/foodSafetyDecisionEngine.js` | `decideFormValues()` | `processSubmissionBatch()` after vision | final suggested values and alert gates | true |
| Alert composer preview | `src/foodSafetyAlertComposer.js` | `composeAlertPayload()` | `processSubmissionBatch()` | canonical alert eligibility | true |
| Reply builder trace | `src/zeroRetakeReplyBuilder.js` | `buildSmartConfirmationMessage()` | `processSubmissionBatch()` | `REPLY_BUILDER_DONE` trace | true |
| DB pending write | `src/database.js` | `insertSubmission()` | `processSubmissionBatch()` | writes `food_safety_submissions` with `trace_id` | true |
| Sheet sync gate | `src/foodSafetyHandler.js` | trace-only pending gate | `processSubmissionBatch()` | `SHEET_SYNC_DONE=SKIPPED/PENDING_CONFIRMATION` | true |
| Management alert send | `src/foodSafetyAlertComposer.js` | `sendConsolidatedAlert()` | `processSubmissionBatch()` or `MANAGER` command | `managerAlertService.sendAlert()` | true if alert payload exists |
| Pilot metrics | `src/pilot/livePilotMetrics.js` | `recordPilotSubmission()`, `recordWriterMemoryProof()` | `processSubmissionBatch()` | `PILOT_METRIC_RECORDED` trace | true |
| Final image reply send | `src/foodSafetyHandler.js` | `processBatch()` | timer from image batch | `images[0].message.reply(reply)` | true |
| Confirmation final write | `src/foodSafetyHandler.js` | `confirmSubmission()` | `handleTextMessage(CONFIRM)` | `updateSubmissionOcr()`, memory save, sheet sync | true |
| Final DB update | `src/database.js` | `updateSubmissionOcr()` | `confirmSubmission()` | final parsed values + status | true |
| Confirmed sheet sync | `src/googleSheet.js` | `syncSubmission()` | `confirmSubmission()` | Google Sheets or safe skip | true |

## Non-Canonical / Blocked Paths

| path | file | status | evidence |
|---|---|---|---|
| Dashboard image submit | `src/index.js` `/api/food-safety/submit` | DISABLED | returns 403 |
| Dashboard command submit/confirm | `src/index.js` `/api/food-safety/command` | DISABLED by default | requires `FOOD_SAFETY_ALLOW_API_COMMANDS=true` |
| Manual arbitrary WhatsApp send | `src/index.js` `/api/whatsapp/send` | DISABLED by default | requires `ALLOW_MANUAL_WHATSAPP_SEND=true` |
| Legacy escalation service | `src/failureEscalationService.js` | DISABLED by default | requires `FOOD_SAFETY_ENABLE_LEGACY_ESCALATION=true` |
| Pending confirmation reminders | `src/foodSafetyHandler.js` | DISABLED by default | requires `FOOD_SAFETY_PENDING_REMINDERS_ENABLED=true` |
| Auto-confirm reply | `src/foodSafetyHandler.js` | DISABLED by default | requires `FOOD_SAFETY_AUTO_CONFIRM_ENABLED=true` |

