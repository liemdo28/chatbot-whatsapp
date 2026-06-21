# RUNTIME MODULE AUDIT

**Date:** 2026-06-20
**Purpose:** Audit all current image handlers and modules before hybrid vision architecture refactor.

---

## Image Pipeline Modules

| Module | File | Action | Notes |
|--------|------|--------|-------|
| `formImageRouter` | `src/formImageRouter.js` | **KEEP** | Single image entry point. Unified scope resolution, form detection, store routing. |
| `foodSafetyHandler` | `src/foodSafetyHandler.js` | **KEEP + MERGE** | Main orchestrator. Will be refactored to call new pipeline stages. |
| `clientManager` | `src/clientManager.js` | **KEEP** | WhatsApp connection, dedup, message dispatch. Already routes images through `handleImageMessage`. |
| `ocr.js` | `src/ocr.js` | **KEEP** | Tesseract OCR engine + form template parsing. Core OCR provider. |
| `paddleocr_bridge.js` | `paddleocr_bridge.js` | **KEEP** | PaddleOCR service bridge. Primary OCR for cell-level extraction. |
| `imageQualityGate` | `src/imageQualityGate.js` | **KEEP** | Image quality scoring + minimum size gate. Non-blocking quality assessment. |
| `foodSafetyDecisionEngine` | `src/foodSafetyDecisionEngine.js` | **KEEP + REFACTOR** | Decision engine. Needs Vision AI integration added. |
| `zeroRetakeReplyBuilder` | `src/zeroRetakeReplyBuilder.js` | **KEEP** | Smart confirmation reply builder. Already implements field-level confidence classification. |
| `crossFieldIntelligence` | `src/crossFieldIntelligence.js` | **KEEP** | Cross-field anomaly detection. Well-integrated into pipeline. |

## Memory / Prediction Modules

| Module | File | Action | Notes |
|--------|------|--------|-------|
| `handwriting/index.js` | `src/handwriting/index.js` | **KEEP** | Handwriting memory module entry point. |
| `handwriting/predictionEngine` | `src/handwriting/predictionEngine.js` | **KEEP** | OCR + memory prediction fusion. Core pipeline component. |
| `handwriting/memorySearch` | `src/handwriting/memorySearch.js` | **KEEP** | Memory search for historical confirmed values. |
| `handwriting/writerProfile` | `src/handwriting/writerProfile.js` | **KEEP** | Writer-specific profile and misread patterns. |
| `handwriting/conflictResolver` | `src/handwriting/conflictResolver.js` | **KEEP** | Runtime prediction audit recording. |
| `handwriting/cellCropStorage` | `src/handwriting/cellCropStorage.js` | **KEEP** | Cell crop image storage for handwriting training. |
| `handwriting/confirmedSamples` | `src/handwriting/confirmedSamples.js` | **KEEP** | Confirmed submission storage. |
| `handwriting/featureExtraction` | `src/handwriting/featureExtraction.js` | **KEEP** | Feature extraction for handwriting fingerprinting. |
| `handwriting/sampleImporter` | `src/handwriting/sampleImporter.js` | **KEEP** | Sample import for CEO ground truth. |
| `handwriting/api` | `src/handwriting/api.js` | **KEEP** | REST API for handwriting memory system. |

## Alert / Escalation Modules

| Module | File | Action | Notes |
|--------|------|--------|-------|
| `failureEscalationService` | `src/failureEscalationService.js` | **KEEP + REFACTOR** | Alert escalation. Has duplicate alert types (unsafe, low conf, manager). Will be consolidated into alert composer. |
| `managerAlertService` | `src/managerAlertService.js` | **KEEP** | WhatsApp alert delivery to management group. Core delivery mechanism. |
| `alertAuditLog` | `src/alertAuditLog.js` | **KEEP** | Alert dedup and audit trail. Prevents duplicate alerts per day. |

## Scheduler Modules

| Module | File | Action | Notes |
|--------|------|--------|-------|
| `missingSubmissionDetector` | `src/missingSubmissionDetector.js` | **KEEP** | Detects missing form submissions per store. |
| `missingSubmissionScheduler` | `src/missingSubmissionScheduler.js` | **KEEP** | Periodic scheduler for missing submission checks. Peer reminder system. |
| `submissionDueConfig` | `src/submissionDueConfig.js` | **KEEP** | Store group config and submission schedule. |

## Telemetry / Dashboard Modules

| Module | File | Action | Notes |
|--------|------|--------|-------|
| `pilot/livePilotMetrics` | `src/pilot/livePilotMetrics.js` | **KEEP + SIMPLIFY** | Pilot telemetry. Exposes too many internal metrics. Will simplify KPIs exposed to CEO. |
| `captureRateDashboard` | `src/captureRateDashboard.js` | **KEEP + MERGE** | Capture rate KPIs. Some overlap with pilot metrics. |
| `acceptanceCriteria` | `src/acceptanceCriteria.js` | **KEEP** | System-wide acceptance validation. Clean, focused. |

## New Modules (To Be Created)

| Module | File | Action | Notes |
|--------|------|--------|-------|
| `storeKnowledge` | `src/storeKnowledge.js` | **CREATE** | Store-specific rules, expected ranges, common OCR misreads, vision review flags. |
| `visionAiReviewer` | `src/visionAiReviewer.js` | **CREATE** | Vision AI reviewer layer. Uses AI only as reviewer, not primary OCR. |
| `vision/providers/*` | `src/vision/providers/` | **CREATE** | Vision provider abstraction (OpenAI, future local model, disabled mode). |
| `foodSafetyAlertComposer` | `src/foodSafetyAlertComposer.js` | **CREATE** | Consolidated alert composer. One management alert per submission maximum. |

## Supporting Modules (Keep As-Is)

| Module | File | Action | Notes |
|--------|------|--------|-------|
| `database` | `src/database.js` | **KEEP** | SQLite database layer. Tables will be audited in DB_CLEANUP_PLAN. |
| `logger` | `src/logger.js` | **KEEP** | Logging utility. |
| `language` | `src/language.js` | **KEEP** | Bilingual (ES/EN) message templates. |
| `googleSheet` | `src/googleSheet.js` | **KEEP** | Google Sheets sync (safe-failure). |
| `formTemplates.json` | `src/formTemplates.json` | **KEEP** | B1/B2/B3 form template definitions. |

## Summary

- **KEEP as-is:** 25 modules
- **KEEP + REFACTOR:** 3 modules (foodSafetyHandler, foodSafetyDecisionEngine, failureEscalationService)
- **KEEP + SIMPLIFY:** 1 module (livePilotMetrics)
- **KEEP + MERGE:** 2 modules (foodSafetyHandler, captureRateDashboard)
- **CREATE:** 4 new modules (storeKnowledge, visionAiReviewer, vision provider abstraction, alertComposer)
- **DEPRECATE:** 0 (no unused dead modules found — all modules are actively wired)
- **DELETE:** 0 (nothing to delete until migration is complete)

---

## Pipeline Flow (Current → Target)

### Current Pipeline
```
WhatsApp Image
→ clientManager.unifiedHandler (dedup)
→ foodSafetyHandler.handleImageMessage (batch)
→ processSubmissionBatch:
  → formImageRouter.getGroupScope (scope check)
  → formImageRouter.isFormLikely (quick OCR check)
  → formImageRouter.resolveStoreFromContext (store routing)
  → imageQualityGate.checkMinimumImageSize (size gate)
  → imageQualityGate.evaluateImageQuality (quality score)
  → fullFormOCR (PaddleOCR or Tesseract fallback)
  → applyMemoryPredictions (handwriting memory)
  → writerProfile.detectWriterFromSubmission (writer detection)
  → foodSafetyDecisionEngine.decideFormValues (decision)
  → crossFieldIntelligence.analyzeCrossField (cross-field check)
  → zeroRetakeReplyBuilder.buildSmartConfirmationMessage (reply)
  → captureRate.recordCaptureAttempt (telemetry)
  → pilot.recordPilotSubmission (pilot telemetry)
```

### Target Pipeline (Post-Refactor)
```
WhatsApp Image
→ Single Image Router (clientManager + formImageRouter)
→ Group Scope Resolver (formImageRouter)
→ Form Classifier (ocr.isLikelyFoodSafetyForm)
→ Template / Store Resolver (formImageRouter + storeKnowledge)
→ Image Quality Gate (imageQualityGate)
→ Template Alignment (PaddleOCR cell alignment)
→ Cell Crop Extractor (paddleocr_service)
→ OCR Engine (PaddleOCR primary, Tesseract fallback)
→ Handwriting Memory (predictionEngine)
→ Store Knowledge Layer (NEW: storeKnowledge)
→ Vision AI Reviewer (NEW: visionAiReviewer) — only when needed
→ Decision Engine (refactored foodSafetyDecisionEngine)
→ Single Reply Builder (zeroRetakeReplyBuilder)
→ Confirmation / Edit / Manual / Manager Flow
→ Alert Composer (NEW: foodSafetyAlertComposer) — one alert max
→ Save DB / Google Sheet / Dashboard
```
