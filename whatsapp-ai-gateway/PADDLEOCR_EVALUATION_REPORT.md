# PADDLEOCR_EVALUATION_REPORT.md
## DEV1 — P0 OCR Accuracy Rebuild: PaddleOCR Engine Evaluation
**Date:** 2026-06-19
**Engine:** PaddleOCR PP-OCR v2.9.1 + PaddlePaddle v3.0
**Objective:** Replace Tesseract.js full-page OCR with cell-level PaddleOCR extraction

---

## 1. Why PaddleOCR Over Tesseract

| Criteria | Tesseract.js (OLD) | PaddleOCR (NEW) |
|-----------|-------------------|-----------------|
| **Approach** | Full-page OCR + regex guessing | Cell-level OCR with template coordinates |
| **Handwritten digits** | Poor accuracy on small cells | CRNN model optimized for digits |
| **Table structure** | None — regex only | Built-in table structure support |
| **Perspective correction** | None | OpenCV homography transform |
| **Preprocessing** | None | Adaptive threshold, CLAHE, line removal |
| **Coordinate mapping** | None | Normalized template cell maps |
| **Confidence scoring** | Page-level only | Per-cell confidence |
| **Handwriting support** | Weak | Trained on Chinese + English handwriting |
| **Open source** | Yes (HP) | Yes (Baidu) |
| **Python native** | No (JS wrapper) | Yes (native) |

**Decision:** PaddleOCR is the clear winner for cell-level handwritten temperature reading.

---

## 2. Architecture Overview

```
Image
  ├─ OpenCV Load
  ├─ Auto-detect form edges (Canny edge detection)
  ├─ Perspective correction (Homography transform)
  ├─ Enhance for OCR (CLAHE + adaptive threshold)
  └─ Remove table lines (Morphological opening)
       │
       ├─ Crop per-cell region (template coordinates)
       ├─ Preprocess cell (grayscale, threshold x3, denoise)
       ├─ PaddleOCR CRNN on cropped cell
       ├─ Normalize OCR text → numeric value
       └─ Validate against safe range
            │
            └─ Structured JSON per cell
```

---

## 3. PaddleOCR Configuration

```python
ocr = PaddleOCR(
    use_angle_cls=True,
    lang="en",
    show_log=False,
    use_gpu=False,
    rec_algorithm="CRNN",   # Best for single-line handwritten digits
    rec_batch_num=16,
)
```

**Why CRNN?** CRNN (Convolutional Recurrent Neural Network) is ideal for:
- Single-line text recognition
- Handwritten digits
- Variable-length sequences (handwritten numbers)
- Small input (cropped cells ~100px wide)

---

## 4. Digit Normalization Rules

Implemented in `normalize_ocr_digit()`:

| OCR Output | Interpreted As | Rule |
|------------|---------------|------|
| `3O` | `30` | Letter O → digit 0 |
| `l00` | `100` | Letter l → digit 1 |
| `—15` | `-15` | Em-dash → minus |
| `5°` | `5` | Degree symbol removed |
| `S3` | `53` | Letter S → digit 5 |
| `-030` | `-30` | Leading zeros stripped |
| `30O` | `30` | Letter O → digit 0 |

**Rejection rules:**
- Non-temperature values (< -50°F or > 500°F)
- Multiple decimal points
- Minus not at start
- Empty string after normalization

---

## 5. Template Cell Maps

Three templates created with normalized 0-1 coordinate system:

| Template | Store | Fields | Form Type |
|----------|-------|--------|-----------|
| `FoodSafety-StoneOak-v3` | Stone Oak (B2) | SO-01 to SO-10 | 10-item |
| `FoodSafety-Rim-v3` | The Rim (B1) | IM-01 to IM-19 | 19-item |
| `FoodSafety-Bandera-v3` | Bandera (B3) | BAN-01 to BAN-19 | 19-item |

Coordinate format (normalized 0-1):
```python
"columns": {
    "10am": {"label_col_x": 0.44, "label_col_w": 0.18},
    "4pm":  {"label_col_x": 0.62, "label_col_w": 0.18},
}
"fields": {
    "SO-01": {"y1": 0.20, "y2": 0.255, "range_min": 30, "range_max": 45},
    ...
}
```

---

## 6. Preprocessing Pipeline

```python
# Per-cell preprocessing:
1. cv2.fastNlMeansDenoising()  # Remove noise
2. cv2.createCLAHE(clipLimit=3.0)  # Contrast enhancement
3. cv2.adaptiveThreshold(BLOCK_SIZE=7, C=5)  # Binarize
4. remove_table_lines()  # Morphological opening
5. cv2.bitwise_not()  # Invert (white text on black)
6. cv2.resize(scale=3)  # Enlarge 3x for OCR
```

---

## 7. Evaluation Summary

| Metric | Before (Tesseract) | After (PaddleOCR) |
|--------|-------------------|-------------------|
| Stone Oak field accuracy | <50% | Target: 95%+ |
| Correct store mapping | Inconsistent | Per-group template |
| Column selection | Manual | Auto (4pm default) |
| Processing per image | ~2s | ~5-15s |
| Perspective correction | None | Auto-detect & correct |
| Cell-level OCR | No | Yes |
| Digit normalization | Basic | Full (O→0, l→1, etc.) |

---

## 8. Files Changed

| File | Change |
|------|--------|
| `paddleocr_service/requirements.txt` | New — PaddleOCR deps |
| `paddleocr_service/install.bat` | New — Python env setup |
| `paddleocr_service/start.bat` | New — Service launcher |
| `paddleocr_service/template_cell_maps.py` | New — 3 template maps |
| `paddleocr_service/form_preprocessor.py` | New — OpenCV pipeline |
| `paddleocr_service/cell_extractor.py` | New — PaddleOCR + normalization |
| `paddleocr_service/column_selector.py` | New — Auto column selection |
| `paddleocr_service/app.py` | New — Flask REST API |
| `paddleocr_service/test_cell_extraction.py` | New — Test suite |
| `paddleocr_bridge.js` | New — Node.js bridge |
| `src/foodSafetyHandler.js` | Modified — PaddleOCR integration |

---

## 9. Deployment Steps

```bash
# Step 1: Install Python dependencies
cd whatsapp-ai-gateway/paddleocr_service
install.bat

# Step 2: Start PaddleOCR service
start.bat
# Runs on port 5501

# Step 3: Configure gateway
# Add to .env:
# PADDLEOCR_HOST=localhost
# PADDLEOCR_PORT=5501
```

**Fallback:** If PaddleOCR service is unavailable, gateway automatically falls back to Tesseract.js without breaking user experience.

---

## 10. Known Limitations

- Python 3.9+ required
- ~500MB disk space for PaddleOCR models