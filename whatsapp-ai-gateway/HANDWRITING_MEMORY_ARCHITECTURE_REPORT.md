# HANDWRITING_MEMORY_ARCHITECTURE_REPORT.md

## System Overview

The Handwriting Memory Layer is a learning system that improves OCR accuracy for the Food Safety Bot after each confirmed form submission.

**Date:** 2026-06-19
**Status:** IMPLEMENTED

---

## Architecture

```
Image Upload
    ↓
Single Image Router
    ↓
Store/Template Resolver (existing paddleocr_bridge.js)
    ↓
Perspective Correction (PaddleOCR service)
    ↓
Cell Crop Extraction (PaddleOCR service)
    ↓
OCR per Cell
    ↓
Handwriting Memory Lookup ←── NEW
    ↓
Prediction Engine ←── NEW
    ↓
Validation Engine
    ↓
One Confirmation Message ←── NEW
    ↓
Employee: CONFIRM / EDIT / MANUAL / RETAKE / MANAGER / CANCEL
    ↓
Save Confirmed Values
    ↓
Update Handwriting Memory ←── NEW
```

---

## New Files Created

| File | Purpose |
|------|---------|
| `src/handwriting/dbSchema.js` | 4 new DB tables + indexes |
| `src/handwriting/cellCropStorage.js` | Phase 1: Cell crop image storage |
| `src/handwriting/confirmedSamples.js` | Phase 2: Confirmed handwriting samples |
| `src/handwriting/featureExtraction.js` | Phase 3: Image fingerprinting (OpenCV-like) |
| `src/handwriting/memorySearch.js` | Phase 4: Memory search by priority |
| `src/handwriting/predictionEngine.js` | Phase 5: Combined prediction |
| `src/handwriting/sampleImporter.js` | Phase 9: Training sample import |
| `src/handwriting/api.js` | Phase 12: REST API endpoints |
| `src/handwriting/index.js` | Module entry point |

---

## Database Schema (4 New Tables)

### Table 1: `handwriting_cell_crops`
Crops from every Food Safety form image.
- `submission_id`, `group_id`, `store_code`, `template_id`
- `field_id`, `item_name`, `column`
- `raw_cell_image_path`, `processed_cell_image_path`
- `ocr_text`, `ocr_value`, `ocr_confidence`
- `created_at`

### Table 2: `handwriting_confirmed_samples`
Confirmed handwriting samples after employee confirmation.
- `sample_id` (unique), `submission_id`, `employee_name`, `employee_phone`
- `store_code`, `template_id`, `field_id`, `item_name`, `column`
- `confirmed_value`, `raw_ocr_value`, `raw_ocr_confidence`
- `cell_image_path`, `normalized_cell_image_path`, `fingerprint`
- `source_action` (CONFIRM, EDIT, MANUAL, AUTO_CONFIRM, MANAGER_APPROVED)
- `created_at`

### Table 3: `handwriting_predictions`
Prediction audit log.
- `submission_id`, `field_id`, `store_code`
- `ocr_value`, `ocr_confidence`, `memory_match_count`
- `predicted_value`, `prediction_source`, `prediction_confidence`
- `needs_confirmation`, `final_confirmed_value`, `final_source`
- `created_at`, `confirmed_at`

### Table 4: `handwriting_accuracy_log`
Accuracy tracking.
- `submission_id`, `store_code`, `field_id`
- `ocr_value`, `predicted_value`, `confirmed_value`
- `ocr_correct`, `prediction_correct`
- `created_at`

---

## Feature Extraction (Phase 3)

**Layer A: Simple Image Fingerprint (OpenCV-style)**
- Uses `sharp` library for image processing
- Resize to 64×64 fixed size
- Grayscale conversion
- Binary threshold (128)
- 8×8 grid → perceptual hash (32 hex chars)
- Binary vector (256 bits, downsampled)

**Layer B: Advanced Embedding**
- Optional ONNX/TrOCR/CLIP integration
- Falls back to Layer A if unavailable
- Does NOT block system if unavailable

---

## Memory Search Priority (Phase 4)

| Priority | Scope | Weight |
|----------|-------|--------|
| 1 | Same employee + same store + same field_id | 100% |
| 2 | Same employee + same store | 90% |
| 3 | Same store + same field_id | 80% |
| 4 | Same store | 70% |
| 5 | Global (ALLOW_GLOBAL_FALLBACK=true) | 50% |

---

## Prediction Engine (Phase 5)

### Sources
- `OCR_HIGH_CONFIDENCE` — OCR ≥90%, value in range
- `OCR_WITH_MEMORY_SUPPORT` — OCR confirmed by memory
- `MEMORY_ASSISTED` — Memory strong match (>0.7 similarity)
- `RANGE_CORRECTED` — OCR out-of-range, common misread fixed
- `HUMAN_REQUIRED` — Unclear, needs employee input

### Rules
1. OCR ≥90% + in range → trust OCR (auto-confirm possible)
2. OCR in range + memory confirms → OCR + Memory Support
3. OCR out of range + memory strong → memory value (needs confirmation)
4. No OCR + memory strong → memory value (needs confirmation)
5. OCR + memory disagree → human required

---

## Safe Confirmation Rules (Phase 6)

**Auto-confirm only when ALL of:**
- OCR confidence ≥ 90
- Memory confidence ≥ 85 (if available)
- Value in allowed range
- No unsafe/warning
- No missing required field
- No duplicate suspicion

---

## WhatsApp UX (Phase 7)

**One message only:**
```
⚠️ Este formulario necesita revisión.
Store: Stone Oak / B2
Template: FoodSafety-StoneOak-v3
Column: 10:00 AM
Date: 2026-06-19

Valores detectados:
SO-01 Walk-In Cooler: 30°F ✅ OCR
SO-02 Walk-In Freezer: 0°F ✅ OCR
SO-03 Prep Cooler: 35°F 🧠 predicted from handwriting memory
SO-04 Reach-In Cooler: unclear ❓

Responde:
CONFIRM = guardar si correcto
EDIT SO-01 30 = corregir un valor
MANUAL = ingresar todos
RETAKE = foto más clara
MANAGER = revisión
CANCEL = cancelar
```

---

## Store-Specific Separation (Phase 10)

| Store | Code | Path |
|-------|------|------|
| The Rim | RIM / B1 | `data/handwriting/samples/RIM/` |
| Stone Oak | SO / B2 | `data/handwriting/samples/SO/` |
| Bandera | BAN / B3 | `data/handwriting/samples/BAN/` |

`ALLOW_GLOBAL_HANDWRITING_FALLBACK=true` (env var) enables cross-store fallback. Default: `false`.

---

## Employee-Specific Learning (Phase 11)

Session enriched with `employeeName`, `employeePhone` when available.
- Stored in confirmed samples
- Priority search: same employee → same store → same field → global
- Different employees write numbers differently — separate learning

---

## API Endpoints (Phase 12)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/handwriting/status` | Dashboard overview |
| GET | `/api/handwriting/samples` | List confirmed samples |
| GET | `/api/handwriting/samples/:id` | Single sample |
| POST | `/api/handwriting/import-sample` | Import single sample |
| POST | `/api/handwriting/import-form` | Import full form |
| POST | `/api/handwriting/rebuild-index` | Rebuild DB indexes |
| GET | `/api/handwriting/predictions/:id` | Prediction audit |
| POST | `/api/handwriting/search` | Search memory |
| POST | `/api/handwriting/predict` | Test prediction |
| GET | `/api/handwriting/crops` | List cell crops |
| GET | `/api/handwriting/accuracy` | Accuracy metrics |

---

## Required Dependencies

```json
{
  "sharp": "^0.33.0"  // Image processing (feature extraction)
}
```

Install: `npm install sharp`

Falls back to pure-JS hash if sharp unavailable.
