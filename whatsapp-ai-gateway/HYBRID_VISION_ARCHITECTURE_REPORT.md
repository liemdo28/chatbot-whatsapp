# HYBRID VISION ARCHITECTURE REPORT

**Date:** 2026-06-20
**CTO Directive:** Food Safety Hybrid Vision Architecture Refactor
**Status:** IMPLEMENTATION COMPLETE

---

## Executive Summary

The Food Safety Bot has been refactored from an OCR-only architecture into a clean hybrid vision pipeline. The new architecture fuses OCR + Memory + Store Knowledge + Vision AI Reviewer + Decision Engine to understand form images more like a human would — with guardrails, memory, and confirmation flows.

---

## Final Runtime Pipeline

```
WhatsApp Image
→ Single Image Router (clientManager + formImageRouter)
  → Group Scope Resolver (B1/B2/B3 production groups only)
  → Form Classifier (isFoodSafetyForm check)
  → Template / Store Resolver (formImageRouter + storeKnowledge)
  → Image Quality Gate (imageQualityGate)
  → Template Alignment (PaddleOCR)
  → Cell Crop Extractor (paddleocr_service)
  → OCR Engine (PaddleOCR primary, Tesseract fallback)
  → Handwriting Memory (predictionEngine + writerProfile)
  → Store Knowledge Layer (NEW: storeKnowledge.js)
  → Vision AI Reviewer (NEW: visionAiReviewer.js) — selective, not always
  → Decision Engine (refactored foodSafetyDecisionEngine.js)
  → Single Reply Builder (zeroRetakeReplyBuilder.js)
  → Confirmation / EDIT / MANUAL / MANAGER Flow
  → Alert Composer (NEW: foodSafetyAlertComposer.js) — one alert max
  → Save DB / Google Sheet / Dashboard
```

---

## New Modules Created

| Module | File | Purpose |
|--------|------|---------|
| Store Knowledge Layer | `src/storeKnowledge.js` | Store-specific rules, critical fields, common bad OCR values |
| Vision AI Reviewer | `src/visionAiReviewer.js` | Vision AI as reviewer — selective, never auto-saves |
| Vision Provider | `src/vision/providers/index.js` | Provider abstraction |
| OpenAI Vision Provider | `src/vision/providers/openaiVision.js` | GPT-4o vision integration |
| Disabled Vision Provider | `src/vision/providers/disabledVision.js` | Fallback when vision disabled |
| Alert Composer | `src/foodSafetyAlertComposer.js` | One consolidated alert per submission |
| Hybrid Vision Tests | `tests/testHybridVision.js` | 11 test cases for all required scenarios |

---

## Key Architecture Decisions

### 1. Vision AI is a Reviewer, Not OCR
- Vision is called ONLY when needed (low confidence, memory conflict, common bad OCR, critical field out of range)
- Vision NEVER silently saves — it only informs the Decision Engine
- Vision confidence below 0.85 cannot override OCR
- Vision + memory agreement = VISION_MEMORY_AGREEMENT source with boosted confidence

### 2. One Image = One Reply
- Single entry point: `clientManager.unifiedHandler` → `foodSafetyHandler.handleImageMessage`
- Image dedup via message hash + timestamp
- Active processing lock prevents duplicate processing
- No separate image handlers anywhere in the codebase

### 3. Consolidated Alert System
- One alert per submission maximum
- Alert ONLY after final decision
- Alert ONLY for reliable values
- Raw OCR cannot trigger alert
- Low confidence cannot create unsafe alert
- Out-of-range + low confidence = review, not alert

### 4. Store Knowledge Layer
- Every field has: expected range, criticality, typical values, common bad OCR values
- Critical fields (fryers, boilers, hot holding, cold proteins) require vision review when uncertain
- Common bad OCR values: 138, 1, 7, 300, 56, 20, 22 — known misreads per field type

### 5. Decision Priority
```
MANAGER_CONFIRMED > MANUAL_CONFIRMED > CEO_CONFIRMED > VISION_OVERRIDE >
VISION_MEMORY_AGREEMENT > OCR_HIGH_CONFIDENCE > OCR_WITH_MEMORY_SUPPORT >
MEMORY_ASSISTED > HUMAN_REQUIRED > MISSING_VALUE > NEEDS_RETAKE
```

---

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `VISION_REVIEW_ENABLED` | false | Enable/disable vision review |
| `VISION_PROVIDER` | disabled | Provider: openai, disabled |
| `VISION_REVIEW_FIELDS` | critical_only | critical_only or all |
| `VISION_MAX_CALLS_PER_FORM` | 6 | Max vision calls per form |
| `VISION_TIMEOUT_MS` | 15000 | Vision API timeout |
| `VISION_CONFIDENCE_THRESHOLD` | 0.85 | Min vision confidence to override OCR |

---

## Database Tables

**Core tables (unchanged):** 15 tables
**New table:** `vision_review_log` — vision AI review audit trail per field
**Zero data destroyed** — no DROP statements, all old data preserved

---

## Acceptance Criteria Status

| Criteria | Status |
|----------|--------|
| Only one image pipeline exists | ✅ VERIFIED |
| Old duplicate handlers disabled | ✅ Single entry point |
| Vision reviewer exists behind provider abstraction | ✅ |
| Decision engine uses OCR + memory + store knowledge + vision | ✅ |
| Raw OCR cannot alert | ✅ |
| Blank cells do not become fake numbers | ✅ |
| Critical fields get vision review when uncertain | ✅ |
| One image = one reply | ✅ |
| Non-form image = silent | ✅ |
| Live WhatsApp validation passes | ⏳ Pending Phase 13 |

---

## Files Created This Refactor

```
RUNTIME_MODULE_AUDIT.md
DB_CLEANUP_PLAN.md
HYBRID_VISION_ARCHITECTURE_REPORT.md (this file)
DEPRECATED_MODULES.md
VISION_REVIEW_VALIDATION_REPORT.md
src/storeKnowledge.js
src/visionAiReviewer.js
src/foodSafetyAlertComposer.js
src/vision/providers/index.js
src/vision/providers/openaiVision.js
src/vision/providers/disabledVision.js
tests/testHybridVision.js
```

---

## Next Steps

1. **Phase 13 — Live Validation:** Test with real WhatsApp images
2. **Phase 14 — Acceptance Criteria:** Verify all criteria pass with live data
3. **Enable Vision:** Set `VISION_REVIEW_ENABLED=true` and `VISION_PROVIDER=openai` when ready
4. **Monitor:** Watch `vision_review_log` table for review quality
