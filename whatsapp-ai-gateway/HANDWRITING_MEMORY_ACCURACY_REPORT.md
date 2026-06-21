# HANDWRITING_MEMORY_ACCURACY_REPORT.md

## Phase 14: Accuracy Tracking

---

## How Accuracy is Measured

After each confirmed submission, the system records:

```sql
INSERT INTO handwriting_accuracy_log (
    submission_id, store_code, field_id,
    ocr_value, predicted_value, confirmed_value,
    ocr_correct, prediction_correct,
    prediction_source
)
```

Where:
- `ocr_correct = 1` if `ocr_value == confirmed_value`
- `prediction_correct = 1` if `predicted_value == confirmed_value`

---

## Accuracy API

```bash
# Get overall accuracy
GET /api/handwriting/accuracy

# Response
{
  "overall": {
    "total": 150,
    "ocr_correct_count": 97,
    "prediction_correct_count": 135
  },
  "by_store": [
    {"store_code": "B2", "total": 80, "ocr_correct": 52, "prediction_correct": 74},
    {"store_code": "B1", "total": 40, "ocr_correct": 22, "prediction_correct": 35},
    {"store_code": "B3", "total": 30, "ocr_correct": 23, "prediction_correct": 26}
  ],
  "by_field": [
    {"field_id": "SO-03", "total": 15, "ocr_correct": 8, "prediction_correct": 14},
    {"field_id": "IM-07", "total": 12, "ocr_correct": 5, "prediction_correct": 11}
  ]
}
```

---

## Expected Accuracy Targets

| Metric | Target |
|--------|--------|
| OCR-only accuracy | Baseline (no memory) |
| Memory-assisted accuracy | > OCR-only |
| Confirmed accuracy | 100% (after human confirmation) |
| Auto-confirm accuracy | >= 95% (only safe cases) |

---

## Accuracy Improvement Formula

```
improvement = prediction_correct_rate - ocr_correct_rate
```

Example:
- OCR-only: 65% correct
- Memory-assisted: 85% correct
- Improvement: +20 percentage points

---

## Key Metrics to Track

| Metric | Description |
|--------|-------------|
| `ocr_only_accuracy` | % of fields where OCR matched confirmed value |
| `memory_accuracy` | % of fields where memory-assisted prediction matched |
| `field_accuracy_by_store` | Accuracy broken down by field and store |
| `most_improved_fields` | Fields where memory helped most |
| `low_confidence_fields` | Fields frequently needing correction |
| `edit_rate` | % of submissions with at least one edit |
