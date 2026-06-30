# PHOTO PIPELINE LOCKDOWN REPORT

**Date:** 2026-06-25  
**P0 Fix:** Old Vision Pipeline Still Appears on Photo Messages  
**Status:** COMPLETE — 6/6 photo lockdown tests PASS

---

## Problem

Some photo messages in Food Safety groups still triggered:
- `foodSafetyHandler.processSubmissionBatch`
- `python_vision_llm_pipeline`
- `Vision did not complete`

Photo processing was retired for Option C pilot but the underlying code paths were not fully blocked.

## Root Cause

While `handleImageMessage()` in `foodSafetyHandler.js` correctly checked the pilot guard and returned the retired-photo reply, the fallback path `processSubmissionBatch()` had no pilot group guard. If `handleImageMessage` somehow failed to load or the guard check errored, the vision pipeline could still be reached.

## Fix Applied

**File:** `src/foodSafetyHandler.js`

Added a hard guard at the top of `processSubmissionBatch()`:

```javascript
// PHOTO LOCKDOWN: Hard guard — never process photos for Food Safety pilot groups
try {
    const pilotScope = getFoodSafetyPilotScope(message);
    if (isFoodSafetyPilotGroup(pilotScope)) {
        logger.info("[PHOTO_LOCKDOWN] processSubmissionBatch blocked for pilot group", {
            phone, chatName, role: pilotScope.role,
        });
        db.logMessage(phone, "in", "[photo blocked in processSubmissionBatch]", "image");
        db.logMessage(phone, "out", PHOTO_WORKFLOW_RETIRED_REPLY, "text");
        return PHOTO_WORKFLOW_RETIRED_REPLY;
    }
} catch (guardErr) {
    logger.warn("[PHOTO_LOCKDOWN] Guard check failed, defaulting to block", { error: guardErr.message });
    return PHOTO_WORKFLOW_RETIRED_REPLY;
}
```

### Defense Layers

```
Layer 1: clientManager.js → unifiedHandler()
  - Checks isFoodSafetyPilotGroup BEFORE calling handleImageMessage
  - Returns retired reply immediately

Layer 2: foodSafetyHandler.js → handleImageMessage()
  - Checks pilot guard and returns PHOTO_WORKFLOW_RETIRED_REPLY

Layer 3: foodSafetyHandler.js → processSubmissionBatch()
  - [NEW] Hard guard blocks Vision/OCR pipeline
  - Returns PHOTO_WORKFLOW_RETIRED_REPLY on any error
```

### Never Called for Pilot Groups

The following functions are now unreachable for B1/B2/B3/Logtest groups:
- ❌ `processGpt4oPath()` — Gemini/OpenAI Vision
- ❌ `processLegacyOcrPath()` — Tesseract/PaddleOCR
- ❌ `callVisionPrimary()` — Python Vision LLM Bridge
- ❌ `saveMessageImage()` — Image download
- ❌ `pipelineTrace.start()` — Runtime tracing

### Reply Message

```
Food Safety photo processing is no longer used for this pilot.
Please use the new workflow:
1. Type /agent
2. Enter the temperature readings as numbers
3. Review the summary
4. Reply 1 to confirm
Paper forms should still be completed and kept for records.
```

No technical terms. No runtime proof. No trace_id. No provider info.

## Tests

| Test | Description | Result |
|------|-------------|--------|
| PHOTO-12 | Photo in B1 Kitchen Log returns retired instruction | PASS |
| PHOTO-13 | Photo in B2 Kitchen Log returns retired instruction | PASS |
| PHOTO-14 | Photo in B3 Kitchen Log returns retired instruction | PASS |
| PHOTO-15 | Photo in LD Agent-Logtest returns retired instruction | PASS |
| PHOTO-16 | Photo does NOT call Vision/OCR | PASS |
| PHOTO-17 | Photo does NOT include runtime proof | PASS |

## Affected Groups

| Group | Store | Role | Photo Handling |
|-------|-------|------|----------------|
| B1 Kitchen Log | The Rim | production_log | Blocked → retired reply |
| B2 Kitchen Log | Stone Oak | production_log | Blocked → retired reply |
| B3 Kitchen Log | Bandera | production_log | Blocked → retired reply |
| LD Agent-Logtest | Test | logtest | Blocked → retired reply |
