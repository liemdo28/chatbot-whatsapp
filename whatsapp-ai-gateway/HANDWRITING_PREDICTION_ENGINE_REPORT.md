# HANDWRITING_PREDICTION_ENGINE_REPORT.md

## Phase 5: Prediction Engine

### Overview

The prediction engine combines OCR results with handwriting memory to produce final suggestions for each temperature field.

---

## Prediction Sources

| Source | Description |
|--------|-------------|
| `OCR_HIGH_CONFIDENCE` | OCR ≥90%, value in valid range |
| `OCR_WITH_MEMORY_SUPPORT` | OCR confirmed by memory match |
| `MEMORY_ASSISTED` | Memory strong match overrides OCR |
| `RANGE_CORRECTED` | OCR out-of-range, misread pattern corrected |
| `HUMAN_REQUIRED` | Unclear, needs employee input |
| `MANUAL_ENTRY` | Employee manually entered value |

---

## Confidence Thresholds

```javascript
OCR_HIGH_CONFIDENCE_THRESHOLD = 90   // 90% OCR confidence
OCR_MEDIUM_CONFIDENCE_THRESHOLD = 70 // 70% OCR confidence
MEMORY_STRONG_MATCH_THRESHOLD = 0.7   // 70% visual similarity
MEMORY_WEAK_MATCH_THRESHOLD = 0.4    // 40% visual similarity
```

---

## Decision Rules

### Rule 1: High Confidence OCR + In Range → Trust OCR
```
IF ocr_value IS NOT NULL
AND ocr_confidence >= 90
AND value IN range
THEN final_value = ocr_value
     source = OCR_HIGH_CONFIDENCE
     needs_confirmation = false
```

### Rule 2: OCR + Memory Agree
```
IF ocr_value IN range
AND memory_similarity >= 0.7
AND |ocr_value - memory_value| <= 2
THEN final_value = ocr_value
     source = OCR_WITH_MEMORY_SUPPORT
     needs_confirmation = false
```

### Rule 3: OCR Out-of-Range + Memory Strong
```
IF ocr_value NOT IN range
AND memory_similarity >= 0.7
AND memory_value IN range
THEN final_value = memory_value
     source = MEMORY_ASSISTED
     needs_confirmation = true
```

### Rule 4: No OCR + Memory Strong
```
IF ocr_value IS NULL
AND memory_similarity >= 0.7
AND memory_value IN range
THEN final_value = memory_value
     source = MEMORY_ASSISTED
     needs_confirmation = true
```

### Rule 5: Range-Corrected Misread
```
IF ocr_value NOT IN range
AND ocr_value matches common_misread_pattern
THEN final_value = corrected_value
     source = RANGE_CORRECTED
     needs_confirmation = true
```

### Rule 6: OCR + Memory Disagree
```
IF ocr_value IN range
AND memory_similarity >= 0.7
AND |ocr_value - memory_value| > 5
THEN final_value = ocr_value
     source = HUMAN_REQUIRED
     needs_confirmation = true
     note: "OCR and memory disagree"
```

---

## Common Misread Patterns

Handwriting "30" can be misread as "3" or "0".
Handwriting "35" can be misread as "5", "3", "8".

```javascript
const misreadMap = {
    "0": [100, 10, 40, 30, 20, 200, 300],
    "1": [101, 11, 41, 31, 21, 201, 351, 100],
    "2": [102, 12, 42, 32, 22, 202, 352, 200],
    "3": [103, 13, 43, 33, 23, 300, 353, 30],
    "7": [107, 17, 30, 37, 357, 70],
    // etc.
}
```

---

## Combined Similarity Score

```javascript
combinedScore =
    visual_similarity * 0.5 +      // 50% visual match
    (1 - priority/5) * 0.3 +      // 30% search priority
    value_confidence * 0.2;         // 20% value typicality
```

---

## API Usage

```bash
# Test prediction
curl -X POST http://localhost:3211/api/handwriting/predict \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"id": "SO-01", "detectedValue": 30, "confidence": 0.95, "safeRange": {"min": 30, "max": 45}},
      {"id": "SO-02", "detectedValue": 7, "confidence": 0.4, "safeRange": {"min": -10, "max": 0}}
    ],
    "ocrConfidence": 60,
    "storeCode": "B2",
    "templateId": "FoodSafety-StoneOak-v3",
    "employeeName": "LD"
  }'
```

**Response:**
```json
{
  "predictions": [
    {
      "id": "SO-01",
      "detectedValue": 30,
      "_predictionSource": "OCR_HIGH_CONFIDENCE",
      "_needsConfirmation": false,
      "_prediction": {
        "final_suggested_value": 30,
        "prediction_source": "OCR_HIGH_CONFIDENCE",
        "prediction_confidence": 0.95,
        "needs_confirmation": false
      }
    },
    {
      "id": "SO-02",
      "detectedValue": 30,
      "_predictionSource": "MEMORY_ASSISTED",
      "_needsConfirmation": true,
      "_prediction": {
        "final_suggested_value": 30,
        "prediction_source": "MEMORY_ASSISTED",
        "prediction_confidence": 0.63,
        "needs_confirmation": true
      }
    }
  ],
  "summary": {
    "total_fields": 2,
    "detected_fields": 2,
    "high_confidence": 1,
    "memory_assisted": 1,
    "human_required": 0,
    "needs_confirmation": true
  }
}
```
