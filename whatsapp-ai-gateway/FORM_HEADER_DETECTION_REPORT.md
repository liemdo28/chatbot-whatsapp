# FORM HEADER DETECTION REPORT

## Status: DESIGN COMPLETE — AWAITING LD Agent-Logtest

Date: 2026-06-19
Author: DEV1

## 1. Purpose

Production groups resolve store from WhatsApp Group ID (authoritative).

The test group "LD Agent-Logtest" requires a different resolution mode: form-header detection.

## 2. Detection Logic

When an image is uploaded in a group configured as `store_resolution_mode=form_header`:

1. Run initial OCR pass to extract text from the form header (top 20% of image)
2. Match extracted text against keyword patterns:

| Store | Keywords (case-insensitive) | Template | Prefix |
| --- | --- | --- | --- |
| The Rim | `The Rim`, `Rim`, `rim` | `FoodSafety-Rim-v3` | `RIM` |
| Stone Oak | `Stone Oak`, `StoneOak`, `stone oak` | `FoodSafety-StoneOak-v3` | `SO` |
| Bandera | `Bandera`, `bandera` | `FoodSafety-Bandera-v3` | `BAN` |

3. If no match → reply "Food Safety form not detected" (same as non-form image handling)
4. If match → load the matched template and run full OCR

## 3. Detection Flow

```
Image received in test group
  │
  ├── Download media
  │
  ├── Extract header text (OCR on top 20% of image)
  │     │
  │     ├── Contains "Rim" → store = rim
  │     ├── Contains "Stone Oak" → store = stone_oak
  │     ├── Contains "Bandera" → store = bandera
  │     └── No match → IGNORED (no form detected)
  │
  ├── Load matched template from template cache
  │
  ├── Run full OCR with resolved template
  │
  └── Output using store prefix (RIM-*/SO-*/BAN-*)
```

## 4. Priority Rules

- Form-header keywords take priority over any group-level store_id
- If both the header and the group_workflow_config agree → use that (no conflict)
- If they disagree (unlikely in test group) → header wins (because test group is designed for multi-form testing)

## 5. Production vs Test Group

| Property | Production Groups | Test Group (LD Agent-Logtest) |
| --- | --- | --- |
| Resolution mode | `group_id` | `form_header` |
| Store source | DB (group_workflow_config) | OCR text in form header |
| Allowed templates | All 3 (locked) | All 3 (unlocked) |
| Lock status | locked=1 | locked=0 |
| Template override | Not allowed | Allowed per image |

## 6. Code Changes Required

- [ ] Add `store_resolution_mode` column to `group_workflow_config`
- [ ] Implement `resolveStoreFromFormHeader(imageData)` function
- [ ] Modify `image-analyzer.js` to branch on resolution mode
- [ ] Verify header detection accuracy with real form PDFs

## 7. Validation (Pending)

Once bot is in LD Agent-Logtest:

1. Upload Rim form → expect store resolved as "rim", prefix "RIM"
2. Upload Stone Oak form → expect store resolved as "stone_oak", prefix "SO"
3. Upload Bandera form → expect store resolved as "bandera", prefix "BAN"
4. Upload random photo → expect "Food Safety form not detected"
