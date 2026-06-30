# LEGACY_IMAGE_PIPELINE_REMOVAL_REPORT.md

**CEO DIRECTIVE — Food Safety Source Cleanup & Legacy Workflow Removal**
**Author:** Dev1
**Date:** 2026-06-29
**Build HEAD:** `50e618ac3a1afa52d1906851d659c28aa46a7231`

This is the STEP 2 / STEP 5 removal report. The legacy OCR/Vision image
pipeline is no longer reachable from Food Safety production groups.

---

## Hard rule

For `B1 Kitchen Log`, `B2 Kitchen Log`, `B3 Kitchen Log`, and
`LD Agent-Logtest`:

> **Images must never enter OCR/Vision form extraction.**

If an image is received:

* **Preferred:** silent ignore (no reply at all).
* **Acceptable:** once per user per shift, send the short instruction:
  > Photos are not used for this pilot. Please type /agent and enter the numbers.

The bot NEVER replies with:

* `This form needs review`
* `OCR confidence`
* `Detected items`
* `Vision did not complete`
* `Runtime proof`

---

## What was removed

The full image pipeline — `processSubmissionBatch()` →
`processGpt4oPath()` → `callVisionPrimary()` → `vision_llm_bridge` →
`openaiVision.extractForm()` — has been retired.

### Specific code paths retired

| Path | Status |
|---|---|
| `foodSafetyHandler.processSubmissionBatch` | RETIRED — throws `FOOD_SAFETY_RETIRED` |
| `foodSafetyHandler.processLegacyOcrPath` | RETIRED — throws `FOOD_SAFETY_RETIRED` |
| `foodSafetyHandler.processGpt4oPath` | RETIRED — throws `FOOD_SAFETY_RETIRED` |
| `foodSafetyHandler.callVisionPrimary` | RETIRED — throws `FOOD_SAFETY_RETIRED` |
| `foodSafetyHandler.performImageOCR` | RETIRED — throws `FOOD_SAFETY_RETIRED` |
| `vision_llm_bridge.extractWithVisionLLM` | Not called from any active code path |
| `paddleocr_bridge.extractFromImage` | Not called from any active code path |
| `openaiVision.extractForm` | Not called from any active code path |
| `visionAiReviewer.reviewFields` | Not called from any active code path |
| `imageQualityGate.checkMinimumImageSize` | Not called from any active code path |
| `zeroRetakeReplyBuilder.buildSmartConfirmationMessage` | Not called from any active code path |
| `foodSafetyDecisionEngine.decideFormValues` | Not called from any active code path |
| `foodSafetyAlertComposer.composeAlertPayload` | Not called from any active code path |

### Old reply builders removed

The following reply messages can no longer be produced in Food Safety
production groups:

| Old reply text | Source that produced it | Status |
|---|---|---|
| `This form needs review.` | `processLegacyOcrPath` | RETIRED |
| `OCR confidence: NN%` | `processLegacyOcrPath`, `processGpt4oPath` | RETIRED |
| `Detected items:` | `zeroRetakeReplyBuilder.buildSmartConfirmationMessage` | RETIRED |
| `Reply: RETAKE / EDIT / MANAGER / CANCEL` | `zeroRetakeReplyBuilder` | RETIRED |
| `Runtime proof:` | `appendProof` | RETIRED |
| `Food Safety runtime blocked this image because Vision did not complete.` | `processGpt4oPath` | RETIRED |
| `Selected column: 4PM` | `displayColumn` | RETIRED |
| `FoodSafety-StoneOak-v3` template id echoed | never in production but previously in `proof` | REMOVED from reply |
| `processSubmissionBatch` traces | `pipelineTrace` | RETIRED from active path |

---

## What is enforced for image messages now

```text
inbound image in B1/B2/B3/LD Agent-Logtest
        │
        ▼
clientManager.unifiedHandler
        │
        ▼
isFoodSafetyPilotGroup(scope) → YES
        │
        ▼
FoodSafetyNumericRouter.handleFoodSafetyMessage(msg, client)
        │
        ▼
handleImage(msg)
        │
        ├─ FIRST in shift  → db.logMessage + return short instruction (photo_instruction)
        │                    ("Photos are not used for this pilot. Please type /agent and enter the numbers.")
        │
        └─ SUBSEQUENT     → silent ignore (return null)
```

**No call to:**
* `paddleocr_bridge`
* `vision_llm_bridge`
* `openaiVision`
* `performOCR` / Tesseract
* `processSubmissionBatch`
* `processLegacyOcrPath`
* `processGpt4oPath`
* `callVisionPrimary`

**No reply containing:**
* `This form needs review`
* `OCR confidence`
* `Detected items`
* `Vision did not complete`
* `Runtime proof`
* `FoodSafety-StoneOak-v3`
* `processSubmissionBatch`

---

## Test evidence

`tests/testLegacyWorkflowRemoval.js` asserts all of the above:

```
Group A — Image handler MUST NOT return any legacy string
  ✓ Image in B1 Kitchen Log → no forbidden string in reply
  ✓ Image in B2 Kitchen Log → no forbidden string in reply
  ✓ Image in B3 Kitchen Log → no forbidden string in reply
  ✓ Image in LD Agent-Logtest → no forbidden string in reply

Group B — FoodSafetyNumericRouter returns clean replies
  ✓ NumericRouter.handleFoodSafetyMessage(image) in B1 Kitchen Log → no forbidden string
  ✓ NumericRouter.handleFoodSafetyMessage(image) in B2 Kitchen Log → no forbidden string
  ✓ NumericRouter.handleFoodSafetyMessage(image) in B3 Kitchen Log → no forbidden string
  ✓ NumericRouter.handleFoodSafetyMessage(image) in LD Agent-Logtest → no forbidden string

Group D — Retired exports MUST throw FOOD_SAFETY_RETIRED
  ✓ processSubmissionBatch throws FOOD_SAFETY_RETIRED
  ✓ processLegacyOcrPath throws FOOD_SAFETY_RETIRED
  ✓ processGpt4oPath throws FOOD_SAFETY_RETIRED
  ✓ callVisionPrimary throws FOOD_SAFETY_RETIRED
  ✓ performImageOCR throws FOOD_SAFETY_RETIRED
```

```
RESULT: 26 passed, 0 failed
```

---

## File guards

`src/foodSafetyHandler.js` keeps the legacy exports only so that historical
test files and tooling can still `require()` the module without crashing.
Every one of those exports now throws at call time:

```js
const processSubmissionBatch = _retired(
    "processSubmissionBatch is retired. Food Safety groups are routed via FoodSafetyNumericRouter (numeric-only)."
);
```

This makes accidental reachability **impossible**, not just unlikely.

---

**Status:** ✅ LEGACY IMAGE PIPELINE REMOVED FROM PRODUCTION.