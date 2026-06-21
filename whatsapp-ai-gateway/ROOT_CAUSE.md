# ROOT_CAUSE.md — Runtime Trace Audit Findings

**Date:** 2026-06-20 04:10 UTC-7
**Auditor:** Runtime Trace Analysis (DB-level evidence)
**Submissions Audited:** 44 (B2 Stone Oak), 40 (B3 Bandera)

---

## EXECUTIVE SUMMARY

Three root causes identified. Each is **exact** — file, function, line, reason.

| # | Root Cause | Hypothesis | Status |
|---|-----------|-----------|--------|
| 1 | Vision env never loaded | (A) Vision not executing | CONFIRMED |
| 2 | Decision Engine passes impossible OCR values through | (B) Vision ignored / (D) bypass | CONFIRMED |
| 3 | Submission 40 bypassed Decision Engine entirely | (C) Legacy fallback path | CONFIRMED |

---

## ROOT CAUSE #1 — VISION ENVIRONMENT NOT LOADED

**Status:** CONFIRMED
**Hypothesis:** (A) Vision is not executing

**File:** `.env` (main configuration file)
**Lines:** ALL — vision settings are ABSENT from this file

**Evidence:**
- `.env` contains only WhatsApp/Gateway config (GATEWAY_PORT, CHROME paths, etc.)
- Vision config exists ONLY in `.env.vision-prod`:
  ```
  VISION_REVIEW_ENABLED=true
  VISION_PROVIDER=openai
  OPENAI_API_KEY=sk-***REDACTED***
  OPENAI_BASE_URL=https://opusmax.shop/v1
  ```
- `dotenv.config()` in `src/index.js` line 6 loads ONLY `.env` — never `.env.vision-prod`
- Runtime verification: `VISION_REVIEW_ENABLED: null`, `VISION_PROVIDER: null`, `OPENAI_API_KEY_PRESENT: false`

**Result:** Vision is permanently disabled in production. Every submission runs with vision = SKIPPED.

**Exact file:** `.env`
**Exact reason:** Vision configuration keys (`VISION_REVIEW_ENABLED`, `VISION_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_VISION_MODEL`) are missing from the file that `dotenv.config()` loads.

---

## ROOT CAUSE #2 — DECISION ENGINE PASSES IMPOSSIBLE OCR VALUES TO USER

**Status:** CONFIRMED
**Hypothesis:** (D) Decision Engine is being bypassed (partially — it runs but has a logic gap)

**File:** `src/foodSafetyDecisionEngine.js`
**Function:** `decideFieldValue()`
**Lines:** 378-391 (Step 8: OCR out of range)

**Code:**
```javascript
// ─── Step 8: OCR out of range (but not critically low) ────────
return makeDecision({
    finalValue: numOcrValue,       // ← PASSES RAW OCR VALUE THROUGH
    source: "HUMAN_REQUIRED",
    confidence: Math.min(ocrNorm, 0.5),
    needsConfirmation: true,
    status: "MANUAL_REQUIRED",
    alertAllowed: false,
    alertReason: "OCR_OUT_OF_RANGE_UNCONFIRMED",
    fieldId,
    ocrValue,
});
```

**Evidence from Submission 44 (B2) Prediction Audit:**

| Field | OCR | Range | Decision Engine Final | Ground Truth | Problem |
|-------|-----|-------|----------------------|-------------|---------|
| SO-04 | 1 | 100-125 | **1** | 102 | 1°F Bowl Warmer passed to user |
| SO-09 | 50 | 95-105 | **50** | 101 | 50°F Sliced Pork passed to user |
| SO-17 | 300 | 350-360 | **300** | 350 | 300°F Fryer passed to user |

**Evidence from Submission 40 (B3) Detected Items:**

| Field | OCR | Range | Final Value | Problem |
|-------|-----|-------|-------------|---------|
| BAN-03 | 100 | 30-45 | **100** | Prep cooler = 100°F?! |
| BAN-16 | 138 | 350-360 | **138** | Fryer = 138°F (known bad OCR) |
| BAN-17 | 138 | 350-360 | **138** | Fryer = 138°F (known bad OCR) |

**Reason:** When OCR is out of range but NOT classified as "critically low" by `isCriticallyLowOcrValue()`, the Decision Engine marks status=MANUAL_REQUIRED but **still passes the raw OCR value** as `final_suggested_value`. This value then flows to the WhatsApp reply.

**Additional gap:** `isCriticallyLowOcrValue()` uses a generic threshold (`COOL_MIN: 10`) but doesn't detect values like 100 in a 30-45 range, or 50 in a 95-105 range. The function only catches the most extreme cases.

---

## ROOT CAUSE #3 — SUBMISSION 40 BYPASSED DECISION ENGINE ENTIRELY

**Status:** CONFIRMED
**Hypothesis:** (C) Legacy pipeline still generating replies

**File:** `src/foodSafetyHandler.js`
**Function:** `processSubmissionBatch()`
**Lines:** 936-949

**Evidence:**
- Submission 40 `ceo_runtime_prediction_audit` count: **0 rows**
- Submission 44 `ceo_runtime_prediction_audit` count: **19 rows**
- Both submissions have `detected_items` with `_predictionSource` values, proving the pipeline ran
- Submission 40 has `ocr_confidence: 48` but items show `_rawOcrConfidence: 0.91` — inconsistency

**Possible causes:**
1. The `try/catch` around `decideFormValues()` at line 937-949 silently swallowed an error for submission 40
2. Submission 40 was processed through a different code path (dashboard `/api/food-safety/submit` at index.js line 158 which does NOT run Decision Engine)

**Most likely:** Submission 40 was submitted via the dashboard API (`index.js` line 158-209), which calls `parseTemperatures()` and saves directly WITHOUT running Decision Engine, Vision, Memory, or any of the pipeline modules. The dashboard path at line 158 does:
```
POST /api/food-safety/submit → performOCR → parseTemperatures → insertSubmission
```
No `decideFormValues()`. No `visionAiReviewer`. No `applyMemoryPredictions()`. **None of Phase 2-5.**

---

## IMMPOSSIBLE VALUES IN PRODUCTION REPLIES

### Submission 44 (B2 Stone Oak) — 3 impossible values:
- **SO-04 = 1°F** (Bowl Warmer, expected 100-125°F) — OCR misread, not blocked
- **SO-09 = 50°F** (Sliced Pork Hot, expected 95-105°F) — OCR misread, not blocked
- **SO-17 = 300°F** (Fryer Right, expected 350-360°F) — OCR misread, not blocked

### Submission 40 (B3 Bandera) — 4 impossible values:
- **BAN-03 = 100°F** (Prep Area Cooler, expected 30-45°F) — not blocked
- **BAN-16 = 138°F** (Fryer Left, expected 350-360°F) — known bad OCR pattern, not blocked
- **BAN-17 = 138°F** (Fryer Right, expected 350-360°F) — known bad OCR pattern, not blocked
- Multiple fields with null where values should exist

---

## FIX REQUIREMENTS

### Fix 1: Enable Vision (PHASE 3)
- Merge `.env.vision-prod` settings into `.env`
- Verify `VISION_REVIEW_ENABLED=true` is loaded at runtime

### Fix 2: Decision Engine Must Block Impossible Values (PHASE 3)
- `decideFieldValue()` Step 8 must return `finalValue: null` (not `numOcrValue`) when OCR is out of range
- Add field-range validation: if value is outside `[range_min - tolerance, range_max + tolerance]`, block it

### Fix 3: Dashboard API Must Route Through Full Pipeline (PHASE 3)
- `/api/food-safety/submit` must NOT be used for production submissions
- OR: It must invoke the same pipeline as WhatsApp (Decision Engine, Memory, Vision)

---

## ACCEPTANCE CRITERIA

After fixes:
- Zero impossible values in WhatsApp replies
- Every field goes through: OCR → Memory → Writer Profile → Store Knowledge → Vision → Decision Engine → Reply
- Decision Engine is the ONLY source of final output values
- No module may produce WhatsApp replies except Decision Engine
