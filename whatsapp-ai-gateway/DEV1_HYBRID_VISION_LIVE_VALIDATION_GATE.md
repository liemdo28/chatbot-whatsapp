# DEV1 — Hybrid Vision Live Validation Gate

**Date:** 2026-06-20  
**From:** CTO  
**To:** DEV1  
**Directive:** Architecture accepted. Now prove Vision AI Reviewer works in live WhatsApp.

---

## Status

| Gate | Status |
|------|--------|
| Architecture | ✅ PASS |
| Code-level tests (11 cases) | ✅ PASS |
| **Production validation** | **⏳ PENDING** |

**Critical point:** Vision is disabled by default. The live bot is NOT using Vision AI yet.  
This gate exists to prove Vision works in live WhatsApp before enabling for production.

---

## Step 1 — Enable Vision Safely

**Do NOT enable globally for production.** Enable in test environment only.

Add these environment variables to the bot's `.env` file (or process environment):

```env
# Vision Review — TEST ONLY
VISION_REVIEW_ENABLED=true
VISION_PROVIDER=openai
VISION_REVIEW_FIELDS=critical_only
VISION_MAX_CALLS_PER_FORM=6
VISION_TIMEOUT_MS=15000
```

**Also required (must already exist):**
```env
OPENAI_API_KEY=sk-...
```

**How to verify it's active:**

After restarting the bot, check the logs for:
```
[VisionProvider] Using OpenAI Vision provider
```

If you see:
```
[VisionProvider] Vision review disabled via config
```
Then Vision is NOT enabled. Check your env vars.

**Rollback:** Set `VISION_REVIEW_ENABLED=false` to immediately disable Vision.

---

## Step 2 — Validate Critical Fields

Use the **latest B2 and B3 real form images** from the LD Agent-Logtest WhatsApp group.

### Required Test Cases

| # | Field | Store | What to test | Expected |
|---|-------|-------|-------------|----------|
| 1 | SO-16 | B2 | Fryer Left — OCR often misreads as 138/300 | Vision corrects to 350-360 range |
| 2 | SO-17 | B2 | Fryer Right — same OCR issue | Vision corrects to 350-360 range |
| 3 | BAN-16 | B3 | Fryer Left | Vision corrects to 350-360 range |
| 4 | BAN-17 | B3 | Fryer Right | Vision corrects to 350-360 range |
| 5 | BAN-03 | B3 | Blank/dash cell | Stays blank/null — no fake number |
| 6 | BAN-02 | B3 | Negative freezer value (e.g. -7) | Stays negative — not flipped to positive |
| 7 | SO-18 | B2 | Boiler Left (200-220 range) | Vision confirms or corrects |
| 8 | SO-19 | B2 | Boiler Right (200-220 range) | Vision confirms or corrects |

### How to validate

For each form submission, check the **bot logs** for lines like:
```
[VisionReviewer] Field reviewed { fieldId: "SO-16", ocrValue: 138, memoryValue: 360, visionValue: 360, visionConfidence: 0.91, shouldOverrideOcr: true }
```

Also check the `vision_review_log` database table:
```sql
SELECT * FROM vision_review_log ORDER BY id DESC LIMIT 20;
```

---

## Step 3 — Required Proof Per Field

For **each reviewed field**, output a JSON record like this:

```json
{
  "field_id": "SO-16",
  "ocr_value": 300,
  "memory_value": 360,
  "store_knowledge": "350-360 fryer range, common bad OCR: [1,7,138,300,56]",
  "vision_value": 360,
  "vision_confidence": 0.91,
  "final_value": 360,
  "final_source": "VISION_MEMORY_AGREEMENT",
  "requires_confirmation": true
}
```

Collect these for **every critical field** that Vision actually reviewed during the live test.

### What to log for each field

| Key | Source | How to get it |
|-----|--------|--------------|
| `field_id` | Template | SO-16, BAN-16, etc. |
| `ocr_value` | OCR result | From bot logs or `form_submission_items` table |
| `memory_value` | Writer profile | From `handwriting_samples` or bot logs |
| `store_knowledge` | `storeKnowledge.js` | Range + common bad OCR values |
| `vision_value` | Vision API | From `vision_review_log.vision_value` |
| `vision_confidence` | Vision API | From `vision_review_log.vision_confidence` |
| `final_value` | Decision engine | From `form_submission_items.detected_value` |
| `final_source` | Decision engine | From `form_submission_items.prediction_source` |
| `requires_confirmation` | Decision engine | From `form_submission_items.needs_confirmation` |

---

## Step 4 — Live WhatsApp Test

### Test group: LD Agent-Logtest

Upload exactly these 4 images in order:

| # | Image | Expected bot behavior |
|---|-------|----------------------|
| 1 | **B2 Stone Oak form** | One reply. Critical fields reviewed by Vision. No false unsafe alert. |
| 2 | **B3 Bandera form** | One reply. Critical fields reviewed by Vision. No false unsafe alert. |
| 3 | **Food photo** (any) | Silent or evidence-only reply. **No Food Safety OCR.** |
| 4 | **Thermometer photo** (any) | Silent or evidence-only reply. **No Food Safety OCR.** |

### Expected behavior for B2/B3 forms

- ✅ **One reply only** (not two, not zero)
- ✅ **Critical fields reviewed by Vision** (check `vision_review_log` table)
- ✅ **No false unsafe alert** sent to manager
- ✅ **Unclear values marked for confirmation** (not auto-saved)
- ✅ **MANUAL / EDIT / CONFIRM available** in the reply
- ✅ **Blank cells remain blank** (not converted to numbers)
- ✅ **Negative values remain negative** (e.g. BAN-02 = -7 stays -7)

### Expected behavior for Food/Thermometer photos

- ✅ Silent or evidence-only (no form processing triggered)
- ✅ **No Food Safety OCR** runs
- ✅ No reply with temperature data

---

## Step 5 — Required Report

Create: **`HYBRID_VISION_LIVE_VALIDATION_REPORT.md`**

### Report Structure (follow exactly)

```markdown
# HYBRID VISION LIVE VALIDATION REPORT

**Date:** [date]
**Tester:** DEV1
**Test Group:** LD Agent-Logtest
**Bot Version:** [git commit or version]
**Vision Config:** VISION_REVIEW_ENABLED=true, VISION_PROVIDER=openai, VISION_REVIEW_FIELDS=critical_only

---

## Verdict: PASS / FAIL

[State PASS or FAIL with one-line reason]

---

## Vision Configuration Active

| Variable | Value |
|----------|-------|
| VISION_REVIEW_ENABLED | true |
| VISION_PROVIDER | openai |
| VISION_REVIEW_FIELDS | critical_only |
| VISION_MAX_CALLS_PER_FORM | 6 |
| VISION_TIMEOUT_MS | 15000 |
| OPENAI_API_KEY | [set / not set] |

---

## Vision Calls Summary

| Metric | Count |
|--------|-------|
| Total Vision API calls made | [N] |
| Fields reviewed by Vision | [N] |
| Vision overrides (OCR corrected) | [N] |
| Vision + Memory agreements | [N] |
| Vision unavailable / timeout | [N] |
| Vision below confidence threshold | [N] |

---

## Reviewed Fields Table

For each field Vision actually reviewed:

| field_id | ocr_value | memory_value | vision_value | vision_confidence | final_value | final_source | requires_confirmation |
|----------|-----------|-------------|-------------|-------------------|-------------|-------------|----------------------|
| SO-16 | 300 | 360 | 360 | 0.91 | 360 | VISION_MEMORY_AGREEMENT | true |
| SO-17 | ... | ... | ... | ... | ... | ... | ... |
| BAN-16 | ... | ... | ... | ... | ... | ... | ... |
| BAN-17 | ... | ... | ... | ... | ... | ... | ... |
| BAN-03 | [blank] | ... | null | ... | null | MISSING_VALUE | true |
| BAN-02 | -7 | ... | -7 | ... | -7 | OCR_HIGH_CONFIDENCE | false |
| SO-18 | ... | ... | ... | ... | ... | ... | ... |
| SO-19 | ... | ... | ... | ... | ... | ... | ... |

---

## Blank Cell Handling Proof

| Field | OCR result | Vision result | Final value | Correct? |
|-------|-----------|--------------|-------------|----------|
| BAN-03 | [OCR value or null] | null (blank) | null | ✅ / ❌ |

---

## Negative Value Handling Proof

| Field | OCR result | Vision result | Final value | Correct? |
|-------|-----------|--------------|-------------|----------|
| BAN-02 | -7 | -7 | -7 | ✅ stays negative |

---

## One Image = One Reply Proof

| Image uploaded | Replies received | Correct? |
|---------------|-----------------|----------|
| B2 form | 1 | ✅ / ❌ |
| B3 form | 1 | ✅ / ❌ |
| Food photo | 0-1 (silent or evidence) | ✅ / ❌ |
| Thermometer photo | 0-1 (silent or evidence) | ✅ / ❌ |

---

## Food/Thermometer Non-OCR Proof

| Image type | Form OCR triggered? | Food Safety data extracted? | Correct? |
|-----------|---------------------|---------------------------|----------|
| Food photo | No | No | ✅ |
| Thermometer photo | No | No | ✅ |

---

## Alert Composer Proof

| Submission | Alert sent? | Alert type | Correct? |
|-----------|------------|-----------|----------|
| B2 form | Yes/No | unsafe / review / none | ✅ / ❌ |
| B3 form | Yes/No | unsafe / review / none | ✅ / ❌ |

**False unsafe alerts: 0** (required for PASS)

---

## Decision Audit Rows

```sql
SELECT field_id, raw_ocr_value, prediction_source, prediction_confidence,
       final_suggested_value, needs_confirmation, alert_allowed
FROM form_submission_items
WHERE submission_id = '[latest_submission_id]'
ORDER BY id;
```

[ paste results here ]

---

## Cost Estimate Per Form

| Metric | Value |
|--------|-------|
| Fields per form | ~19 |
| Fields needing Vision review | ~6 (critical_only mode) |
| Vision API cost per call (GPT-4o, high detail) | ~$0.01-0.03 |
| Max cost per form | ~$0.06-0.18 |
| Monthly cost (100 forms/day × 30 days) | ~$180-540 |

---

## Known Blockers / Issues

[List any issues encountered. If none, write "None"]

---

## Acceptance Checklist

| Rule | Status |
|------|--------|
| Vision actually runs in live test | ✅ / ❌ |
| SO/BAN critical fields corrected or safely blocked | ✅ / ❌ |
| Blank cells remain blank | ✅ / ❌ |
| Negative values remain negative | ✅ / ❌ |
| One image = one reply | ✅ / ❌ |
| No false unsafe alert | ✅ / ❌ |
| Food/thermometer photos do not trigger form OCR | ✅ / ❌ |

**PASS only if ALL boxes are ✅**
```

---

## Acceptance Rule

**Do NOT mark PASS unless ALL of the following are true:**

1. ✅ Vision actually runs in live test (check `vision_review_log` table has new rows)
2. ✅ SO/BAN critical fields are corrected or safely blocked
3. ✅ Blank cells remain blank (BAN-03 = null, not a fake number)
4. ✅ Negative values remain negative (BAN-02 = -7, not 7)
5. ✅ One image = one reply
6. ✅ No false unsafe alert sent
7. ✅ Food/thermometer photos do not trigger form OCR

---

## Quick Reference: How to Check Vision is Running

```bash
# Check logs for Vision provider activation
grep "VisionProvider" logs/*.log

# Check vision review log table
sqlite3 data/food_safety.db "SELECT COUNT(*) FROM vision_review_log WHERE date(created_at) = date('now');"

# Check latest Vision reviews
sqlite3 data/food_safety.db "SELECT field_id, vision_value, vision_confidence, should_override_ocr FROM vision_review_log ORDER BY id DESC LIMIT 10;"
```

---

## Quick Reference: Rollback

If Vision causes any issue during live test:

```env
VISION_REVIEW_ENABLED=false
```

Restart bot. Pipeline continues with OCR + memory + manual flow. Zero data loss.
