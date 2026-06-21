# STONE_OAK_OCR_ACCURACY_REPORT.md
## DEV1 — Stone Oak OCR Accuracy Report
**Date:** 2026-06-19
**Form:** Food Safety Checklist — Stone Oak (B2)
**Engine:** PaddleOCR v2.9.1 + Template Cell Extraction

---

## 1. Problem Statement

Stone Oak form actual values:
```
SO-01 = 30   SO-06 = 40   SO-11 = 39   SO-16 = 351
SO-02 = 0    SO-07 = 0    SO-12 = 41   SO-17 = 352
SO-03 = 35   SO-08 = 100  SO-13 = 39   SO-18 = 210
SO-04 = 100  SO-09 = 101  SO-14 = 38   SO-19 = 210
SO-05 = 40   SO-10 = 102  SO-15 = 40
```

The OLD Tesseract OCR was reading these incorrectly.

---

## 2. Root Cause Analysis

| Failure Mode | Cause |
|-------------|-------|
| "3O" → misread as "3o" | Tesseract confused letter O with digit 0 |
| "l00" → misread as "100" | Tesseract confused lowercase l with digit 1 |
| Cross-row contamination | Full-page OCR confused adjacent rows |
| No cell isolation | Regex matched wrong row/column |
| Small cell size | Tesseract needs minimum 300 DPI for small text |

---

## 3. Solution: Cell-Level Extraction

Each SO-01 through SO-10 cell is now:
1. **Cropped** to exact template coordinates (normalized 0-1)
2. **Preprocessed** (threshold, enlarge 3x, remove lines)
3. **OCR'd individually** by PaddleOCR CRNN
4. **Normalized** with digit-replacement rules

---

## 4. Expected PaddleOCR Output

For a Stone Oak 10am column image:

```json
{
  "store_code": "B2",
  "store_name": "Stone Oak",
  "template_id": "FoodSafety-StoneOak-v3",
  "selected_column": "10:00 AM",
  "items": [
    {"id": "SO-01", "value": 30,  "range": "30-45",  "status": "SAFE"},
    {"id": "SO-02", "value": 0,   "range": "-10-0",  "status": "SAFE"},
    {"id": "SO-03", "value": 35,  "range": "30-45",  "status": "SAFE"},
    {"id": "SO-04", "value": 100, "range": "30-45",  "status": "WARNING"},
    {"id": "SO-05", "value": 40,  "range": "-10-0",  "status": "WARNING"},
    {"id": "SO-06", "value": 40,  "range": "135-200", "status": "WARNING"},
    {"id": "SO-07", "value": 0,   "range": "165-200", "status": "WARNING"},
    {"id": "SO-08", "value": 100, "range": "0-70",    "status": "WARNING"},
    {"id": "SO-09", "value": 101, "range": "0-41",    "status": "WARNING"},
    {"id": "SO-10", "value": 102, "range": "150-180", "status": "WARNING"}
  ]
}
```

---

## 5. Accuracy Targets

| Metric | Target | Method |
|--------|--------|--------|
| Field accuracy (Stone Oak) | >= 95% | Compare extracted vs actual values |
| Correct store mapping | 100% | WhatsApp group → template ID |
| Column auto-selection | >= 90% | Compare auto vs manual selection |
| No SO prefix in Rim/Bandera | 100% | Cross-store isolation |
| No form extraction from food photos | 100% | Non-form rejection |
| No hallucinated values | 100% | Range validation + digit normalization |
| Single reply only | 100% | Dedupe logic |

---

## 6. Digit Normalization Impact

| OCR Input | Normalized | Action |
|-----------|-----------|--------|
| "3O" | 30 | Letter O → digit 0 |
| "l00" | 100 | Letter l → digit 1 |
| "—15" | -15 | Em-dash → minus |
| "5°" | 5 | Degree symbol removed |
| "S3" | 53 | Letter S → digit 5 |
| "Bb" | 88 | Letters → digits |
| "-030" | -30 | Leading zeros stripped |
| "foo" | null | Reject impossible values |

---

## 7. Caveats

- Coordinate calibration needed after perspective correction
- Y-coordinates may shift slightly with different form versions
- Run `python test_cell_extraction.py` after first deployment to verify coordinates
- Safe ranges in template may need adjustment based on actual form specs
