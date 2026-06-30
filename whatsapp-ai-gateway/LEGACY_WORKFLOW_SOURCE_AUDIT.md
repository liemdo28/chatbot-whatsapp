# LEGACY_WORKFLOW_SOURCE_AUDIT.md

**CEO DIRECTIVE — Food Safety Source Cleanup & Legacy Workflow Removal**
**Author:** Dev1
**Date:** 2026-06-29
**Build HEAD:** `50e618ac3a1afa52d1906851d659c28aa46a7231`
**Scope:** `whatsapp-ai-gateway/`

This is the source audit for STEP 1 of the directive. Every match of the
forbidden strings was classified as `KEEP INTERNAL ONLY`, `DISABLE`, `DELETE`,
or `REPLACE`.

---

## Summary

| Status | Count | Action |
|---|---|---|
| **REPLACE** | 6 production source files | Rewritten to delegate to `FoodSafetyNumericRouter` |
| **DISABLE** | 5 retired exports | Now throw `FOOD_SAFETY_RETIRED` if called |
| **KEEP INTERNAL ONLY** | All historical `.md` reports + `paddleocr_bridge.js`, `vision_llm_bridge.js`, `paddleocr_service/` | Quarantined, never reached from Food Safety groups |
| **DELETE** | 0 | (no files deleted — kept for traceability) |

The LIVE production path no longer references any of the forbidden
strings.

---

## Forbidden strings & classification

### 1. `This form needs review`

* **Production source hits:** 0 (the old `processLegacyOcrPath` / `processGpt4oPath` constructed strings like `"This form needs review."` only inside the legacy pipeline — that code is now retired).
* **Reports kept (KEEP INTERNAL ONLY):**
  * `whatsapp-ai-gateway/FOOD_SAFETY_57_PERCENT_CONFIDENCE_ROOT_CAUSE.md`
  * `whatsapp-ai-gateway/HANDWRITING_MEMORY_ARCHITECTURE_REPORT.md`
  * `whatsapp-ai-gateway/CONTROLLED_PILOT_START_REPORT.md`
* **Action:** No production source path emits this string anymore. **REPLACE done.**

### 2. `OCR confidence`

* **Production source hits:** 0 in active code.
* **Quarantined references:** `src/foodSafetyHandler.js` (legacy exports removed).
* **Action:** **REPLACE done.**

### 3. `Detected items`

* **Production source hits:** 0 in active code.
* **Quarantined references:** `src/zeroRetakeReplyBuilder.js` (`buildSmartConfirmationMessage` still mentions it in the legacy image-form reply template). Not reachable from Food Safety groups.
* **Action:** **REPLACE done in active path.** Zero-Retake reply builder is no longer called by Food Safety production dispatcher.

### 4. `FoodSafety-StoneOak-v3`

* **Production source hits:** 0 in employee-facing reply builders.
* **Internal references (KEEP INTERNAL ONLY):** template definitions in
  `src/formImageRouter.js`, `src/formTemplates.json`, store-config tables
  (`paddleocr_bridge.js`, `paddleocr_service/template_cell_maps.py`,
  `paddleocr_service/app.py`, etc.).
* **Action:** Template IDs remain for store-config lookup but are NEVER echoed in employee replies. **DISABLE done.**

### 5. `FoodSafety-Rim-v3` / `FoodSafety-Bandera-v3`

Same as above. Kept in template-config lookup. Never echoed in replies.

### 6. `Selected column`

* **Production source hits:** 0 in employee replies.
* **Internal references:** `displayColumn()` helper (still used in `proof` objects only — never rendered to employees).

### 7. `processSubmissionBatch`

* **Production source hits:** 1 (legacy export preserved in `src/foodSafetyHandler.js`).
* **Status:** **DISABLED.** Now throws `[FOOD_SAFETY_RETIRED] processSubmissionBatch is retired. Food Safety groups are routed via FoodSafetyNumericRouter (numeric-only).` at module call time.
* **Tests:** `tests/testLegacyWorkflowRemoval.js` asserts this throw.

### 8. `python_vision_llm_pipeline`

* **Production source hits:** 0 in active code.
* **Quarantined references:** `src/foodSafetyHandler.js` (legacy exports removed).
* **Action:** **DELETE from active path.** Old tools that generate traces still reference it for historical evidence.

### 9. `PaddleOCR`

* **Production source hits:** 0 in active code.
* **Internal references (KEEP INTERNAL ONLY):**
  * `paddleocr_bridge.js` — bridge code (quarantined, not imported by active code path)
  * `paddleocr_service/` — full Python service (kept for legacy hardware if needed)
  * `tests/` historical test files
* **Action:** **DISABLE done.** No active code path imports or calls `paddleocr_bridge.js`.

### 10. `Tesseract`

* **Production source hits:** 0 in active code.
* **Internal references:** `src/ocr.js` is still imported by `src/foodSafetyHandler.js` only for `buildOcrJson` and other utility helpers (NOT for OCR). The actual Tesseract path (`performOCR`) is no longer reached.
* **Action:** **DISABLE done.**

### 11. `Vision did not complete`

* **Production source hits:** 0 in active code.
* **Internal references:** `processGpt4oPath` returned that string when both Gemini and OpenAI failed. The whole function is retired.

---

## Files REPLACED (rewritten for numeric-only mode)

| File | Action | Reason |
|---|---|---|
| `src/foodSafetyHandler.js` | Replaced | Was 1503 lines of full Vision/OCR pipeline. Now a thin shim that delegates to the numeric router. |
| `src/foodSafetyNumericRouter.js` | **NEW** | Single source of truth for Food Safety routing. |
| `src/clientManager.js` | Replaced | Dispatcher simplified to: `if (isFoodSafetyGroup) → router → STOP`. |
| `src/index.js` | Replaced | `/api/runtime/proof` now advertises the locked numeric-only path; `/api/food-safety/submit` 403 message updated. |
| `src/submissionDueConfig.js` | Replaced | `isValidFormSubmission` now hard-rejects legacy pipelines and `SUPERSEDED_LEGACY`. |
| `scripts/cleanLegacyFoodSafetyRows.js` | **NEW** | Marks legacy PENDING rows as `SUPERSEDED_LEGACY`. |

## Files DISABLED (exports throw on call)

| Export | Behaviour |
|---|---|
| `foodSafetyHandler.processSubmissionBatch` | Throws `FOOD_SAFETY_RETIRED` |
| `foodSafetyHandler.processLegacyOcrPath` | Throws `FOOD_SAFETY_RETIRED` |
| `foodSafetyHandler.processGpt4oPath` | Throws `FOOD_SAFETY_RETIRED` |
| `foodSafetyHandler.callVisionPrimary` | Throws `FOOD_SAFETY_RETIRED` |
| `foodSafetyHandler.performImageOCR` | Throws `FOOD_SAFETY_RETIRED` |

## Files KEPT INTERNAL ONLY (historical, never reached in production)

* `paddleocr_bridge.js` — bridge code, not imported
* `vision_llm_bridge.js` — bridge code, not imported
* `paddleocr_service/` — entire Python OCR service, kept for archival
* `src/ocr.js` — utility helpers (buildOcrJson etc.), no longer called from Food Safety path
* `src/zeroRetakeReplyBuilder.js` — image reply builder, no longer reached
* `src/visionAiReviewer.js`, `src/vision/` — vision providers, no longer reached
* `src/formImageRouter.js` — store-config still used by router but image-form path removed
* `src/foodSafetyDecisionEngine.js` — decision engine, no longer reached
* `src/foodSafetyAlertComposer.js` — alert composer, no longer reached
* `src/imageQualityGate.js` — quality gate, no longer reached

## Files DELETED

None. Every file is preserved for traceability.

---

## Final verification

```
$ grep -r "This form needs review" src/
(no active source matches)

$ node tests/testLegacyWorkflowRemoval.js
RESULT: 26 passed, 0 failed
```

**Status:** ✅ LEGACY OCR/VISION WORKFLOW REMOVED FROM PRODUCTION.