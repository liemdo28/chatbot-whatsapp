# TEST GROUP B1/B2/B3 ROUTING REPORT

## Status: PENDING — Bot Not Yet in LD Agent-Logtest

Date: 2026-06-19
Author: DEV1

## 1. Required Behavior

When an image is uploaded in "LD Agent-Logtest":

```
Detect form header (OCR text)
  → Resolve store from form content (Rim / Stone Oak / Bandera)
  → Load correct template (FoodSafety-*-v3)
  → Run OCR with resolved template
  → Return store-specific field IDs (RIM-01..RIM-19, SO-01..SO-19, BAN-01..BAN-19)
```

Unlike production groups, the test group resolves store from form header content — NOT from group ID.

## 2. Expected Outputs

### Rim Form
```
Store: B1 / The Rim
RIM-01 Walk-In Cooler = XX°F
RIM-02 Walk-In Freezer = XX°F
...
RIM-19 Pasta Boiler = XX°F
```

### Stone Oak Form
```
Store: B2 / Stone Oak
SO-01 Walk-In Cooler = XX°F
SO-02 Walk-In Freezer = XX°F
...
SO-19 Pasta Boiler = XX°F
```

### Bandera Form
```
Store: B3 / Bandera
BAN-01 Walk-In Cooler = XX°F
BAN-02 Walk-In Freezer = XX°F
...
BAN-19 Pasta Boiler = XX°F
```

## 3. Routing Design

```
Image received in LD Agent-Logtest
  │
  ├── Is this group configured as type="test"?
  │     │
  │     YES → Use form_header detection
  │     │     │
  │     │     ├── OCR header text
  │     │     ├── Match "Rim"/"Stone Oak"/"Bandera" keywords
  │     │     ├── Load matched template
  │     │     └── Run OCR with loaded template
  │     │
  │     NO → Use group_workflow_config (production path)
  │           │
  │           └── Resolve store from chat_id in DB
  │
  └── Output uses resolved store prefix (RIM-*/SO-*/BAN-*)
```

## 4. Code Path (To Be Implemented)

1. Add `group_type` column to `group_workflow_config` (values: "production" or "test")
2. Add `store_resolution_mode` column (values: "group_id" or "form_header")
3. In `food-safety-pipeline.js`: check group_type first
4. If test group: run form-header OCR first, then use matched template
5. If production group: resolve from chat_id (existing path)

## 5. Pending

- [ ] Bot needs to be added to LD Agent-Logtest (+84 584 990 2302)
- [ ] Capture chat ID
- [ ] Add group_type and store_resolution_mode columns to DB
- [ ] Implement form-header detection code path
- [ ] Live test with all 3 forms
- [ ] Screenshot evidence
