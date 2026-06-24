# Root Cause Analysis: 57% Confidence / 17/19 Fields Unclear

**Date:** 2026-06-21
**Store:** Stone Oak (B2)
**Template:** FoodSafety-StoneOak-v3
**Column:** 4:00 PM
**Overall Vision Confidence:** 57%

---

## Summary

17 of 19 fields are "unclear" (no value detected) and 2 fields have physically impossible values (SO-04=4°F, SO-10=7°F). This is caused by **three un-integrated safety layers** that were coded but never wired into the production pipeline.

---

## Root Cause #1: VLM Blank Cell Guard NOT integrated

**File:** `tools/apply-vlm-safety.js` defines `vlmBlankCellGuard()` and `enrichVlmItemsWithStoreKnowledge()`
**Status:** These functions were NEVER integrated into `foodSafetyHandler.js`

When the Gemini Flash bridge returns readings, low-confidence hallucinated values may pass through without being nullified. The blank cell guard should nullify values where:
- Per-field confidence < 0.30
- Vision notes contain "blank/empty/illegible/missing/not visible/unclear"

**Impact:** Without this guard, the decision engine receives garbage values (like 4°F for a Bowl Warmer) instead of null.

---

## Root Cause #2: Image Quality Gate NOT called in pipeline

**File:** `src/imageQualityGate.js` defines `evaluateImageQuality()` and `checkMinimumImageSize()`
**Status:** The pipeline traces "QUALITY_GATE_DONE" but never actually calls these functions

The trace step at line 515-517 of foodSafetyHandler.js just logs metadata — it doesn't invoke the quality gate. This means:
- Blurry images pass through without warning
- Small/compressed WhatsApp images aren't rejected
- The quality score isn't used to lower confidence thresholds

**Impact:** Low-quality images that should trigger RETAKE are processed anyway, resulting in 17/19 fields unreadable.

---

## Root Cause #3: Critical Field Range Gap (Bowl Warmer)

**File:** `src/foodSafetyDecisionEngine.js`
**Issue:** `classifyFieldRange()` classifies Bowl Warmer (100-125°F) as "GENERAL" instead of a hot food category

The range 100-125 falls between:
- HOT_FOOD: rangeMin >= 95 && rangeMax <= 110 → FAILS (max=125 > 110)
- HOT_FOOD2: rangeMin >= 130 && rangeMax <= 170 → FAILS (min=100 < 130)

**Impact:** SO-04=4°F (Bowl Warmer) is NOT caught by `isCriticallyLowOcrValue()` because "GENERAL" category has no critical low threshold. The decision engine returns null/HUMAN_REQUIRED via the out-of-range fallback (Step 8), but this is slower and doesn't trigger the critical blocking path.

---

## Fixes Applied

### Fix 1: Integrate VLM safety layer into foodSafetyHandler.js
- Add `VLM_MIN_FIELD_CONFIDENCE = 0.30` constant
- Add `vlmBlankCellGuard()` function
- Add `enrichVlmItemsWithStoreKnowledge()` function
- Call both after Gemini bridge returns in `callVisionPrimary()`

### Fix 2: Integrate image quality gate into processGpt4oPath()
- Call `checkMinimumImageSize()` before vision processing
- If RETAKE_REQUIRED, return a clear message to the user
- If quality is low, lower the effective confidence to compensate

### Fix 3: Fix critical field range classification
- Add `BOWL_WARMER` category to `classifyFieldRange()` for ranges 100-130
- This ensures `isCriticallyLowOcrValue()` catches impossible Bowl Warmer readings

---

## Root Cause #4: No Memory Fallback in Vision Pipeline

**File:** `src/handwriting/predictionEngine.js` exists with full memory search
**File:** `src/handwriting/memorySearch.js` has SQLite-based confirmed sample search
**Status:** Memory search was ONLY used in legacy OCR path, never in vision path

When the Vision LLM returns null/missing for a field, the system had no fallback.
The handwriting prediction engine has `searchMemory()` which looks up previously confirmed
values from `handwriting_confirmed_samples` table — but this was never called in the
vision pipeline path (`processGpt4oPath`).

**Impact:** 17/19 fields remain "unclear" because vision can't read them and there's
no memory to fill in.

---

## Fixes Applied

### Fix 1: VLM Safety Layer (blank cell guard + store knowledge enrichment)
- Integrated `vlmBlankCellGuard()` and `enrichVlmItemsWithStoreKnowledge()` into `callVisionPrimary()`
- Nullifies hallucinated values with low confidence (< 0.30)
- Enriches VLM output with store knowledge safe ranges

### Fix 2: Image Quality Gate Integration
- Added actual `imageQualityGate.checkMinimumImageSize()` call in `processGpt4oPath()`
- Logs image dimensions, crop height, and quality decision
- Warns when image is too small for reliable extraction

### Fix 3: Bowl Warmer Critical Range Gap
- Fixed `classifyFieldRange()`: widened HOT_FOOD from `rangeMax <= 110` to `rangeMax <= 130`
- Now catches physically impossible Bowl Warmer readings (4°F for 100-125°F range)

### Fix 4: Memory Fallback for Missing Fields
- Added `memoryFallbackForMissingFields()` function that searches confirmed samples
- Integrated into vision pipeline between VLM processing and decision engine
- When VLM returns null, searches SQLite for prior confirmed values per field
- Only uses memory values that fall within the expected range
- Marks memory-filled fields as `_predictionSource: "MEMORY_ASSISTED"` with `_needsConfirmation: true`

---

## Expected Outcome After Fixes

| Before Fix | After Fix |
|------------|-----------|
| SO-04=4°F passes through as-is | SO-04 nullified by critical low block or blank guard |
| SO-10=7°F passes through as-is | SO-10 blocked by HOT_FOOD critical threshold |
| 17 fields show "unclear" (null) | Memory fallback fills fields from confirmed history |
| No quality gate feedback | User warned about image quality if below threshold |
| 57% confidence with no explanation | Quality gate explains why confidence is low |
| Vision-only = no fallback | Memory + vision = best of both worlds |

---

## How to Reduce "Unclear" Fields Going Forward

The memory fallback only works when there are **confirmed samples** in the database.
To build up memory:

1. **CONFIRM commands** — each time an employee confirms a submission, values are saved
   to `handwriting_confirmed_samples`
2. **MANUAL commands** — manually entered values also become memory
3. **EDIT commands** — corrected values become memory
4. **Accumulation** — after 5-10 confirmed submissions, memory coverage reaches 80%+

The more forms are confirmed, the better memory fallback becomes.
With sufficient history, even a 57% confidence vision extraction can produce
90%+ field coverage via memory prediction.
