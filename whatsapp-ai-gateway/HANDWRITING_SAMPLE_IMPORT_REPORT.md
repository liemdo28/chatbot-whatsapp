# HANDWRITING_SAMPLE_IMPORT_REPORT.md

## Phase 9: Training Samples Import

CEO will send sample handwriting for each group/store.
The system supports importing samples from LD Agent-Logtest, Production B1/B2/B3 Kitchen Log, and local upload folders.

---

## Import API

### POST `/api/handwriting/import-sample`

```json
{
  "store_code": "B2",
  "template_id": "FoodSafety-StoneOak-v3",
  "employee_name": "LD",
  "employee_phone": "+1555XXXXXXX",
  "source_image_path": "/path/to/image.jpg",
  "ground_truth": {
    "SO-01": 30,
    "SO-02": 0,
    "SO-03": 35,
    "SO-04": 40,
    "SO-05": 100,
    "SO-06": 0,
    "SO-07": 100,
    "SO-08": 101,
    "SO-09": 102,
    "SO-10": 39
  },
  "column": "10:00"
}
```

**Response:**
```json
{
  "success": true,
  "import_id": "IMP-1750339200000-abc123",
  "store_code": "B2",
  "fields_imported": 10,
  "samples": [
    { "field_id": "SO-01", "confirmed_value": 30, "sample_id": "SPL-..." },
    ...
  ]
}
```

---

### POST `/api/handwriting/import-form`

Import a full form image with all ground truth values:
```json
{
  "store_code": "B2",
  "template_id": "FoodSafety-StoneOak-v3",
  "form_image_path": "/path/to/form.jpg",
  "ground_truth": { "SO-01": 30, "SO-02": 0, ... },
  "column": "10:00",
  "employee_name": "LD"
}
```

---

## Sample Source Paths

| Source | Path |
|--------|------|
| LD Agent-Logtest | `data/handwriting/imports/` |
| Production B1 Kitchen Log | Imported via API |
| Production B2 Kitchen Log | Imported via API |
| Production B3 Kitchen Log | Imported via API |
| CEO uploads | Via `/api/handwriting/import-sample` |

---

## Data Storage

Each imported sample creates:
1. **Cell crop** → `data/handwriting/crops/{store}/{date}/{import_id}/{field}.png`
2. **Confirmed sample** → `data/handwriting/samples/{store}/{sample_id}_{field}.png`
3. **Database record** → `handwriting_confirmed_samples` table

---

## Bulk Import

```javascript
// Example bulk import via API
POST /api/handwriting/import-sample (multiple calls)

or create a manifest file:

data/handwriting/imports/manifest.json
{
  "samples": [
    {
      "store_code": "B2",
      "image_path": "B2_SO-01_30.jpg",
      "ground_truth": { "SO-01": 30 },
      "employee_name": "LD"
    }
  ]
}
```

---

## Required: sharp Dependency

```bash
cd whatsapp-ai-gateway
npm install sharp
```

This enables fingerprint generation for each imported sample.
