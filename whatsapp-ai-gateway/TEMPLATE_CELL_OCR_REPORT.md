# TEMPLATE_CELL_OCR_REPORT.md
## DEV1 — Template Cell OCR Report
**Date:** 2026-06-19

---

## 1. Cell Extraction Architecture

Each temperature field is extracted by:

1. **Coordinate lookup** — Normalized 0-1 coordinates from template map
2. **Cell crop** — OpenCV `img[y1:y2, x1:x2]`
3. **Preprocessing** — Denoise → CLAHE → Adaptive threshold → Remove lines → Enlarge 3x
4. **PaddleOCR CRNN** — Single-line recognition on preprocessed cell
5. **Digit normalization** — "3O" → 30, "l00" → 100, etc.
6. **Range validation** — Compare against `range_min` / `range_max`

---

## 2. Stone Oak Template (FoodSafety-StoneOak-v3)

| Field | Item | Range | Coordinate Y |
|-------|------|-------|--------------|
| SO-01 | Walk-In Cooler | 30-45°F | 0.20-0.255 |
| SO-02 | Walk-In Freezer | -10-0°F | 0.255-0.31 |
| SO-03 | Prep Cooler | 30-45°F | 0.31-0.365 |
| SO-04 | Reach-In Cooler | 30-45°F | 0.365-0.42 |
| SO-05 | Reach-In Freezer | -10-0°F | 0.42-0.475 |
| SO-06 | Hot Holding | 135-200°F | 0.475-0.53 |
| SO-07 | Cooking Temp | 165-200°F | 0.53-0.585 |
| SO-08 | Cooling Step 1 | 0-70°F | 0.585-0.64 |
| SO-09 | Cooling Step 2 | 0-41°F | 0.64-0.695 |
| SO-10 | Dishwasher | 150-180°F | 0.695-0.75 |

**Column X coordinates (normalized):**
- 10am column: x=0.44, width=0.18 (ends at 0.62)
- 4pm column: x=0.62, width=0.18 (ends at 0.80)

---

## 3. Rim Template (FoodSafety-Rim-v3)

19 fields from y=0.20 to y=0.865 (evenly distributed):
- Columns: 10am at x=0.40, 4pm at x=0.58 (each width=0.18)
- Fields: IM-01 through IM-19

| Group | Fields | Range Type |
|-------|--------|------------|
| Coolers/Freezers | IM-01 to IM-07 | 30-45°F or -20-0°F |
| Hot holding | IM-08 to IM-10 | 95-105°F |
| Cold storage | IM-11 to IM-15 | 30-45°F |
| Fryers | IM-16, IM-17 | 350-360°F |
| Pasta boilers | IM-18, IM-19 | 200-220°F |

---

## 4. Bandera Template (FoodSafety-Bandera-v3)

Same layout as Rim (19 fields, same column positions).
- Columns: 10am at x=0.40, 4pm at x=0.58 (each width=0.18)
- Fields: BAN-01 through BAN-19

---

## 5. Coordinate Normalization

Coordinates are stored as 0-1 normalized values relative to image dimensions.
Applied to actual pixel coordinates at runtime:

```python
img_h, img_w = form_img.shape[:2]
x1 = int(label_col_x * img_w)
y1 = int(field_y1 * img_h)
x2 = int((label_col_x + label_col_w) * img_w)
y2 = int(field_y2 * img_h)
cell = form_img[y1:y2, x1:x2]
```

This ensures coordinates work regardless of:
- Input image resolution
- Perspective distortion (after correction)
- Mobile vs. scanner capture

---

## 6. Expected Accuracy Gains

| Scenario | Tesseract (before) | PaddleOCR (after) |
|----------|---------------------|---------------------|
| Clean form, clear digits | ~70% | ~95%+ |
| Angled photo | ~40% | ~90%+ |
| Small handwriting | ~30% | ~90%+ |
| "O" vs "0" confusion | ~50% | ~98%+ |
| "l" vs "1" confusion | ~50% | ~98%+ |
| Missing cell | ~0% | returns null |

---

## 7. Calibration Tool

To recalibrate coordinates for a new form image:

```python
# Run calibration tool
python calibrate_cell_coords.py test_images/stone_oak.jpg

# Interactive: click corners, then each cell center
# Outputs: updated template_cell_maps.py entries
```

Calibration notes:
- Always use perspective-corrected image
- Add 3-5% padding to each cell
- Verify with `python test_cell_extraction.py <image>`
