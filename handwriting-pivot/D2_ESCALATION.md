# D2 Escalation Report — FAIL at 86.7%

**Date:** 2026-06-20 (Updated 2026-06-21)
**Status:** D2 ⛔ FAIL — below 95% acceptance threshold. No pilot until fixed.

---

## Actual Results

### Gemini 2.5 Flash vs CEO visual reading (Stone Oak only)

| Field | Model | CEO GT | Match |
|---|---|---|---|
| WALK_IN_COOLER | 40 | 40 | ✅ |
| PREP_AREA_COOLER | 37 | 37 | ✅ |
| RAMEN_REACH_BELOW | 38 | 38 | ✅ |
| RAMEN_REACH_TOP | 36 | 36 | ✅ |
| LINE_FREEZER | 0 | 0 | ✅ |
| TAPAS_REACH_BELOW | 39 | 39 | ✅ |
| TAPAS_REACH_TOP | 33 | 33 | ✅ |
| PORK_CHASHU_COLD | 38 | 38 | ✅ |
| CHICKEN_CHASHU_COLD | 38 | 38 | ✅ |
| SEASONED_EGGS | 100 | 100 | ✅ |
| FRYER_2 | 350 | 350 | ✅ |
| PASTA_BOILER_1 | 215 | 215 | ✅ |
| PASTA_BOILER_2 | 210 | 210 | ✅ |
| **FRYER_1** | **380** | **300** | ❌ |
| **WALK_IN_FREEZER** | **10** | **0** | ❌ |

**Result:** 13/15 = 86.7% accuracy on 1 form (Stone Oak). This is below the 95% threshold.

### Additional data from earlier eval run (24.2% — broken GT)

The `results.json` shows 24.2% accuracy. This was caused by:
1. Old ground truth was mapped from PaddleOCR alignment data, not visual reading
2. Field IDs were mismatched (hot-hold values mapped to cold-hold fields, e.g., FRYER_1 expected 33)
3. Two fields (PORK_BROTH, CHICKEN_BROTH) were expected on Stone Oak but are not on that form

**The 24.2% number is not representative of model accuracy** — it's an artifact of broken ground truth mapping.

### Bandera form (no verified GT yet)

I previously claimed "Claude Vision 100% on Bandera." I cannot substantiate this claim with per-cell raw output. The Bandera ground truth has not been verified by CEO against the actual image. I was using values I inferred, which is circular reasoning.

---

## What We Actually Know

1. **Gemini 2.5 Flash gets 86.7% on Stone Oak** (1 form, 15 cells, CEO-verified GT) — FAIL
2. **We do NOT have CEO-verified GT for Bandera** — eval pending
3. **The 24.2% number is invalid** — wrong GT, not a model problem
4. **Claude Vision "100% on Bandera" claim is unverified** — I cannot produce per-cell raw output with confidence scores
5. **Latency is 15-26s** — above 8s target
6. **We have only 2 test images** — brief says 4, I only found 2

---

## Root Causes of Accuracy Failure

### Model errors on Stone Oak:
1. **FRYER_1: model read 380, CEO says 300** — handwriting ambiguous. Both are plausible fryer readings.
2. **WALK_IN_FREEZER: model read 10, CEO says 0** — the model may have read a different cell or misread '0' as '10'.

### Structural gaps:
1. **Only 2 images tested** — need minimum 3 forms × 2 shifts = 100+ cells
2. **No Bandera GT** — CEO needs to read form_bandera.png cell-by-cell
3. **No Rim image** — need 3rd form for robust eval
4. **No confidence calibration test** — haven't verified if low-confidence predictions are actually wrong more often

---

## What Needs to Happen (CEO's 7 Pilot Gating Items)

- [ ] ☐ **GT for ≥3 forms, each 2 shifts, total ≥100 cells** — CEO sign-off before eval
- [ ] ☐ **Accuracy ≥95% per-cell** — currently 86.7% on 1 form
- [ ] ☐ **GT locked before eval** — RFC process for any GT changes
- [ ] ☐ **Confidence calibration** — when model says confidence <0.85, error rate should be ≥70%
- [ ] ☐ **Latency p95 ≤8s** — currently 15-26s, need investigation
- [ ] ☐ **Eval report** — per-cell results, per-provider comparison, ambiguous cell handling
- [ ] ☐ **D2 doc honest** — this document

---

## Latency Breakdown (what we know)

17.5s end-to-end in D4 test. Breakdown not yet measured. Likely causes:
- Gemini 2.5 Flash is a "thinking" model — inherently slower than 2.0 Flash
- Network latency to Google API
- Image compression + base64 encoding overhead
- Python HTTP server overhead

**Target:** Gemini 2.0 Flash (non-thinking) should be 1-3s. Rate limiting has prevented testing.

---

## Honest Assessment

D2 fail at 86.7%. Investigation shows two errors on Stone Oak (FRYER_1 ambiguous handwriting, WALK_IN_FREEZER misread). We have insufficient data — only 1 form with verified GT out of the 4 required. Bandera GT needs CEO verification. Latency is 2-3x over target.

**Plan to fix:**
1. CEO verifies Bandera GT (I provide the image, CEO reads cell-by-cell)
2. Find 3rd form image (Rim or Bakudan)
3. Re-run eval on ≥3 forms with locked GT
4. If accuracy stays below 95% → try Claude Vision as primary (claimed better, needs verification)
5. Investigate latency: test Gemini 2.0 Flash with fresh API key

**Will not pilot until all 7 gating items pass.**

---

## What IS working (honest list)
- 21/21 unit tests pass
- Pipeline runs end-to-end without crashing
- Store detection: correct on both images
- Reply format: matches expected UX
- Decision engine + reply builder: functional
- Node.js bridge: working (foodSafetyHandler.js integration verified)
- Feature flag: USE_VISION_LLM_PIPELINE=true/false working
- Claude Vision provider: code complete, needs per-cell verification
