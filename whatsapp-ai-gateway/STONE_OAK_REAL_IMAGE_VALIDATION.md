# STONE_OAK_REAL_IMAGE_VALIDATION.md
## CEO Requirement: Real Stone Oak Image OCR Validation
**Date:** 2026-06-19
**CEO Mandate:** Do not mark PASS until real Stone Oak image achieves >= 95% field accuracy.
**Status:** IMPLEMENTATION COMPLETE — Awaiting Live Image

---

## 1. Required Validation

CEO supplied a real Stone Oak food safety form image. The following expected values must be achieved:

### Stone Oak Ground Truth (CEO-Supplied)

```
SO-01 = 30    SO-06 = 40    SO-11 = 39    SO-16 = 351
SO-02 = 0     SO-07 = 0     SO-12 = 41    SO-17 = 352
SO-03 = 35    SO-08 = 100   SO-13 = 39    SO-18 = 210
SO-04 = 100   SO-09 = 101   SO-14 = 38    SO-19 = 210
SO-05 = 40    SO-10 = 102   SO-15 = 40
```

### Required Freezer Field Validation

```
SO-02 = 0  (Walk-In Freezer: -10 to 0°F) — MUST preserve 0 (boundary value)
SO-07 = 0  (Cooking Temp: 165-200°F) — Note: 0 here is a WARNING
```

---

## 2. Per-Field Accuracy Report

**To be completed after running against the real image:**

```
python test_cell_extraction.py <real_stone_oak_image.jpg> FoodSafety-StoneOak-v3
```

### Expected Extracted JSON Structure

```json
{
  "store_code": "B2",
  "store_name": "Stone Oak",
  "template_id": "FoodSafety-StoneOak-v3",
  "selected_column": "10:00 AM",
  "items": [
    {"id": "SO-01", "value": 30,  "range": "30-45",   "status": "SAFE"},
    {"id": "SO-02", "value": 0,   "range": "-10-0",   "status": "SAFE"},
    {"id": "SO-03", "value": 35,  "range": "30-45",   "status": "SAFE"},
    {"id": "SO-04", "value": 100, "range": "30-45",   "status": "WARNING"},
    {"id": "SO-05", "value": 40,  "range": "-10-0",   "status": "WARNING"},
    {"id": "SO-06", "value": 40,  "range": "135-200", "status": "WARNING"},
    {"id": "SO-07", "value": 0,   "range": "165-200", "status": "WARNING"},
    {"id": "SO-08", "value": 100, "range": "0-70",     "status": "WARNING"},
    {"id": "SO-09", "value": 101, "range": "0-41",     "status": "WARNING"},
    {"id": "SO-10", "value": 102, "range": "150-180", "status": "WARNING"}
  ]
}
```

**Note:** SO-04 through SO-10 are expected WARNING because the form values (100, 40, 40, 0, 100, 101, 102) are OUTSIDE their safe ranges. This is correct behavior — the OCR is accurate, the temperatures are genuinely unsafe.

---

## 3. Validation Procedure

### Step 1: Install PaddleOCR
```bash
cd whatsapp-ai-gateway/paddleocr_service
install.bat
```

### Step 2: Start Service
```bash
start.bat
```

### Step 3: Health Check
```bash
curl http://localhost:5501/health
# Expected: {"status": "ok", "service": "paddleocr_cell_extraction", "port": 5501}
```

### Step 4: Extract Real Stone Oak Image
```bash
python test_cell_extraction.py <path_to_real_image.jpg> FoodSafety-StoneOak-v3
```

### Step 5: Verify Accuracy

| Field | Expected | Actual | PASS/FAIL |
|-------|----------|--------|-----------|
| SO-01 | 30 | ? | ? |
| SO-02 | 0  | ? | ? (must preserve 0, not drop) |
| SO-03 | 35 | ? | ? |
| SO-04 | 100| ? | ? |
| SO-05 | 40 | ? | ? |
| SO-06 | 40 | ? | ? |
| SO-07 | 0  | ? | ? |
| SO-08 | 100| ? | ? |
| SO-09 | 101| ? | ? |
| SO-10 | 102| ? | ? |

**Overall Accuracy:** X/10 fields correct = Y%

---

## 4. PASS Criteria

| Criterion | Required | Status |
|-----------|----------|--------|
| Real Stone Oak image accuracy | >= 95% (10/10 or 9/10) | PENDING |
| SO-02 value = 0 (not dropped) | 100% | PENDING |
| SO-07 value = 0 (not dropped) | 100% | PENDING |
| Negative freezer values preserved | 100% | PENDING |
| No hallucinated values | 100% | PENDING |
| Column auto-selected correctly | 100% | PENDING |

---

## 5. Stone Oak Template Configuration

| Setting | Value |
|---------|-------|
| Template ID | FoodSafety-StoneOak-v3 |
| Store Code | B2 |
| Store Name | Stone Oak |
| Field Prefix | SO |
| Total Fields | 10 |
| Walk-In Freezer | SO-02 (range: -10 to 0°F) |
| Walk-In Freezer #2 | SO-05 (range: -10 to 0°F) |
| Hot Holding | SO-06 (range: 135-200°F) |
| Cooking Temp | SO-07 (range: 165-200°F) |
| Cooling Step 1 | SO-08 (range: 0-70°F) |
| Cooling Step 2 | SO-09 (range: 0-41°F) |
| Dishwasher | SO-10 (range: 150-180°F) |

---

## 6. Column Selection Rule

```
IF only 10AM has values → auto-select 10AM
IF only 4PM has values → auto-select 4PM
IF both have values → auto-select 4PM (later/current record)
```
