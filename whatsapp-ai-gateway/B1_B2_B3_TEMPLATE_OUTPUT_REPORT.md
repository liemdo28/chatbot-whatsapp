# B1/B2/B3 TEMPLATE OUTPUT REPORT

## Status: DESIGN COMPLETE — AWAITING LIVE TEST

Date: 2026-06-19
Author: DEV1

## 1. Required Outputs

Each store template must produce store-specific field IDs, NOT generic `IM-*` IDs.

| Store Code | Store Name | Template | Prefix | Expected IDs |
| --- | --- | --- | --- | --- |
| B1 | The Rim | `FoodSafety-Rim-v3` | `RIM` | `RIM-01` to `RIM-19` |
| B2 | Stone Oak | `FoodSafety-StoneOak-v3` | `SO` | `SO-01` to `SO-19` |
| B3 | Bandera | `FoodSafety-Bandera-v3` | `BAN` | `BAN-01` to `BAN-19` |

## 2. Current Issue

The current code uses a single `daily-entry-v1` template with generic `IM-*` IDs for all stores. The CEO directive requires store-specific prefixes:

- `IM-01` should become `RIM-01` when processing Rim forms
- `IM-01` should become `SO-01` when processing Stone Oak forms
- `IM-01` should become `BAN-01` when processing Bandera forms

## 3. Template Structure

Each template contains:
- Store-specific field IDs (RIM-01, SO-01, BAN-01)
- Store-specific temperature ranges and thresholds
- Store-specific item labels
- Store-specific validation rules
- Dashboard labels using the store prefix

## 4. Expected Bot Reply Format

### B1 (Rim) Form Upload
```
Food Safety Form Detected

Store: B1 / The Rim
Date: 2026-06-19

RIM-01 Walk-In Cooler = 40°F
RIM-02 Walk-In Freezer = -15°F
RIM-03 Walk-In Cooler #2 = 38°F
RIM-04 Walk-In Freezer #2 = -12°F
RIM-05 Reach-In Cooler = 42°F
RIM-06 Reach-In Freezer = -8°F
RIM-07 Dry Storage = 68°F
RIM-08 Prep Line #1 = 41°F
RIM-09 Prep Line #2 = 40°F
RIM-10 Hot Holding #1 = 165°F
RIM-11 Hot Holding #2 = 168°F
RIM-12 Steam Table = 162°F
RIM-13 Grill = 375°F
RIM-14 Fryer = 350°F
RIM-15 Oven = 400°F
RIM-16 Dishwasher = 180°F
RIM-17 Ice Machine = 28°F
RIM-18 Walk-In Cooler (Evening) = 39°F
RIM-19 Pasta Boiler = 210°F

Reply:
CONFIRM
EDIT RIM-01 38
RETAKE
MANAGER
CANCEL
```

### B2 (Stone Oak) Form Upload
```
Food Safety Form Detected

Store: B2 / Stone Oak
Date: 2026-06-19

SO-01 Walk-In Cooler = 40°F
SO-02 Walk-In Freezer = -15°F
... (19 items)
```

### B3 (Bandera) Form Upload
```
Food Safety Form Detected

Store: B3 / Bandera
Date: 2026-06-19

BAN-01 Walk-In Cooler = 40°F
BAN-02 Walk-In Freezer = -15°F
... (19 items)
```

## 5. Naming Consistency Rules

- **Do NOT output `IM-*`** — use store-specific prefix only
- If the current code uses `IM-*`, the template IDs must be updated to use `RIM-*`, `SO-*`, or `BAN-*`
- Dashboard labels, sheet column headers, and manager alerts all use the store prefix
- EDIT command references the store prefix: `EDIT RIM-01 38`

## 6. Validation

| Form | Expected First ID | Expected Last ID | Expected Store |
| --- | --- | --- | --- |
| Rim form in B1 Kitchen Log | RIM-01 | RIM-19 | rim |
| Stone Oak form in B2 Kitchen Log | SO-01 | SO-19 | stone_oak |
| Bandera form in Bakudan B2 | BAN-01 | BAN-19 | bandera |
| Rim form in LD Agent-Logtest | RIM-01 | RIM-19 | rim (from header) |
| Stone Oak form in LD Agent-Logtest | SO-01 | SO-19 | stone_oak (from header) |
| Bandera form in LD Agent-Logtest | BAN-01 | BAN-19 | bandera (from header) |

## 7. Pending

- [ ] Verify current template IDs in `template-cache.js` — do they use `IM-*` or store-specific?
- [ ] If `IM-*`, update templates to use `RIM-*`, `SO-*`, `BAN-*`
- [ ] Verify OCR output uses the resolved prefix
- [ ] Verify dashboard API returns store-specific IDs
- [ ] Live test in all 3 production groups + test group
- [ ] Screenshot evidence for each form type
