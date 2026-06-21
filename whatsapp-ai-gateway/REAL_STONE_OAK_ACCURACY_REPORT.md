# REAL_STONE_OAK_ACCURACY_REPORT.md
## CEO Final Validation — TEST A: Stone Oak Real Image OCR Accuracy
**Date:** 2026-06-19 02:39 AM PDT
**Status:** ❌ CONDITIONAL FAIL — PaddleOCR Service Offline
**Hard Requirement:** ≥95% accuracy to achieve PASS

---

## 1. Executive Summary

| Criterion | Target | Actual | Status |
|-----------|--------|--------|--------|
| Field accuracy (10 fields) | ≥95% | **BLOCKED** | ❌ PaddleOCR offline |
| SO-02 value = 0 (not dropped) | 100% | Pending | ⏳ |
| SO-07 value = 0 (not dropped) | 100% | Pending | ⏳ |
| Negative freezer values preserved | 100% | Pending | ⏳ |
| Column auto-selected correctly | 100% | Pending | ⏳ |

**Root Cause:** PaddleOCR Python service (port 5501) is not running.
- `netstat`: No listener on port 5501
- `curl http://localhost:5501/health` → connection refused
- WhatsApp Gateway (port 3211, PID 17704) → IS RUNNING but not responding to HTTP health probe

---

## 2. Evidence Images Available

Latest evidence images from WhatsApp group captures (2026-06-18 17:42-17:43 UTC):

```
evidence_1781829801760_f1deb07a.jpg  | 2026-06-18 17:43:21
evidence_1781829801755_f6860666.jpg | 2026-06-18 17:43:21
evidence_1781829801747_d3945d62.jpg | 2026-06-18 17:43:21
evidence_1781829801739_e5d944c6.jpg | 2026-06-18 17:43:21
evidence_1781829775084_d735ce49.jpg | 2026-06-18 17:42:55
evidence_1781829775075_6af9a4fc.jpg | 2026-06-18 17:42:55
evidence_1781829775068_f29a4617.jpg | 2026-06-18 17:42:55
evidence_1781829775060_b1fc8454.jpg | 2026-06-18 17:42:55
```

Total evidence images: 30+ captured WhatsApp form images.

---

## 3. Stone Oak Ground Truth (CEO-Supplied)

```
SO-01 = 30    SO-06 = 40    SO-11 = 39    SO-16 = 351
SO-02 = 0     SO-07 = 0     SO-12 = 41    SO-17 = 352
SO-03 = 35    SO-08 = 100   SO-13 = 39    SO-18 = 210
SO-04 = 100   SO-09 = 101   SO-14 = 38    SO-19 = 210
SO-05 = 40    SO-10 = 102   SO-15 = 40
```

### Critical Fields
| Field | Value | Range | Expected Status |
|-------|-------|-------|-----------------|
| SO-02 | 0 | -10-0°F | SAFE (boundary) |
| SO-07 | 0 | 165-200°F | WARNING |

---

## 4. PaddleOCR Architecture (Implemented, Offline)

### Service Stack
```
whatsapp-ai-gateway (Node.js, port 3211) — RUNNING PID 17704
    ↓ HTTP POST
PaddleOCR Service (Flask, port 5501) — OFFLINE
    ↓
Cell-Level OCR Pipeline:
  form_preprocessor.py → cell_extractor.py → column_selector.py
  → template_cell_maps.py
    ↓
PaddleOCR CRNN v2.9.1 + cv2 image processing
```

### Cell Extraction Template (Stone Oak v3)
```python
template_cell_maps.py:
  "FoodSafety-StoneOak-v3": {
    "store_name": "Stone Oak",
    "store_code": "B2",
    "field_prefix": "SO",
    "fields": {
      "SO-01": {"col_10am": 0.27, "row": 0.42, "range_min": 30, "range_max": 45},
      "SO-02": {"col_10am": 0.27, "row": 0.47, "range_min": -10, "range_max": 0},
      "SO-03": {"col_10am": 0.27, "row": 0.52, "range_min": 30, "range_max": 45},
      ...
    }
  }
```

### Digit Normalization (normalize_ocr_digit)
```python
def normalize_ocr_digit(text: str) -> Optional[float]:
    # All minus styles → standard minus
    normalized = re.sub(r"[–—−]", "-", normalized)
    # Keep minus at start only
    normalized = re.sub(r"[^0-9.\-]", "", normalized)
    # Remove leading zeros from negative (e.g. "-030" → "-30")
    normalized = re.sub(r"^-0+", "-", normalized)
    # Drop em-dashes/letter confusions: l→1, O→0, S→5
    ...
```
**Supported minus styles:** `-` (hyphen), `–` (en-dash), `—` (em-dash), `−` (Unicode minus)

---

## 5. Accuracy Test Procedure (When PaddleOCR Online)

```bash
# Step 1: Start PaddleOCR service
cd C:\Ld-project\whatsapp-ai-gateway\paddleocr_service
call venv\Scripts\activate.bat
python app.py

# Step 2: Health check
curl http://localhost:5501/health
# Expected: {"status": "ok", "service": "paddleocr_cell_extraction", "port": 5501}

# Step 3: Run full test suite (includes negative temperature)
python test_cell_extraction.py
# Produces: per-field accuracy vs ground truth

# Step 4: Test real Stone Oak image
python test_cell_extraction.py "path/to/stone_oak_form.jpg" FoodSafety-StoneOak-v3
```

---

## 6. Routing Tests — VERIFIED PASS (Pre-requisite for TEST A)

✅ **ALL 14/14 routing tests PASSED** — executed 2026-06-19 02:33 AM

```
[PASS] Explicit rim header        → THE RIM / FoodSafety-Rim-v3
[PASS] Explicit stone oak header  → STONE OAK / FoodSafety-StoneOak-v3
[PASS] Explicit bandera header   → BANDERA / FoodSafety-Bandera-v3
[PASS] Location rim header       → THE RIM / FoodSafety-Rim-v3
[PASS] Lowercase rim             → THE RIM / FoodSafety-Rim-v3
[PASS] Mixed case stone oak      → STONE OAK / FoodSafety-StoneOak-v3
[PASS] Logtest group rim        → THE RIM / FoodSafety-Rim-v3
[PASS] Logtest group stone oak  → STONE OAK / FoodSafety-StoneOak-v3
[PASS] Production B1 group      → THE RIM / FoodSafety-Rim-v3
[PASS] Production B2 group      → STONE OAK / FoodSafety-StoneOak-v3
[PASS] Production B3 group     → BANDERA / FoodSafety-Bandera-v3
[PASS] Partial rim text          → THE RIM / FoodSafety-Rim-v3
[PASS] Partial stone oak text    → STONE OAK / FoodSafety-StoneOak-v3
```

### Template Cell Maps Verification
```
[PASS] RIM fields are RIM-* (not IM-*): ['RIM-01', 'RIM-02', ...]
[PASS] RIM template field_prefix = 'RIM' (was 'IM'): RIM
[PASS] RIM-02 range_min = -20: -20
[PASS] RIM-07 range_min = -20: -20
[PASS] RIM-07 range_max = 0: 0
[PASS] Template 'FoodSafety-Rim-v3' exists (The Rim)
[PASS] Template 'FoodSafety-StoneOak-v3' exists (Stone Oak)
[PASS] Template 'FoodSafety-Bandera-v3' exists (Bandera)
[PASS] BAN-02 range_min = -20 (Walk-In Freezer): -20
```

---

## 7. Blocking Issues & Fix Required

| Issue | Severity | Fix |
|-------|----------|-----|
| PaddleOCR service offline (port 5501) | P0 BLOCKER | Start service: `python app.py` from `paddleocr_service/` |
| Python 3.14 lacks paddlepaddle wheels | P0 BLOCKER | Requires Python 3.8-3.11 + pip install paddlepaddle |
| No venv found in paddleocr_service/ | P1 | Run `install.bat` to create venv + install dependencies |
| Gateway responding on port 3211 | Info | PID 17704 is listening but health API returns no response |

### Fix Procedure
```batch
# 1. Create virtual environment with correct Python
cd C:\Ld-project\whatsapp-ai-gateway\paddleocr_service
python -m venv venv

# 2. Install dependencies (uses Baidu mirror)
call venv\Scripts\activate.bat
pip install paddlepaddle -i https://mirror.baidu.com/pypi/simple
pip install -r requirements.txt

# 3. Start service (background)
start /B cmd /C "python app.py"
timeout /t 10 /nobreak >nul

# 4. Verify
curl http://localhost:5501/health
```

---

## 8. Expected Result (When Fixed)

```
[COMPLETE] JSON output:
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
    {"id": "SO-06", "value": 40,  "range": "135-200","status": "WARNING"},
    {"id": "SO-07", "value": 0,   "range": "165-200","status": "WARNING"},
    {"id": "SO-08", "