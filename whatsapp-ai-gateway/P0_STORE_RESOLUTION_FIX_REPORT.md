# P0 STORE RESOLUTION FIX REPORT

## Status: DB FIXED — RUNTIME PROOF PENDING

Date: 2026-06-18
Author: DEV1
Severity: P0 CRITICAL
Runtime: Laptop1 (PID 20976)

## 1. Bug

**Current state:** All stores were receiving Stone Oak IDs (SO-01..SO-19) because:

- `group_workflow_config` had no `template_id` or `prefix` columns
- A single hardcoded template `daily-entry-v1` was applied to every group
- `detectStoreFromText` searched OCR text for "stone oak" / "bandera" / "rim" — false positives were possible
- The result: B1 Kitchen Log (The Rim) and B3 Kitchen Log (Bandera) both got Stone Oak IDs

**Required state:** Each WhatsApp Group ID must resolve to:

- A specific Store (resolved from the group, not from OCR)
- A specific Template (per-store)
- A specific Prefix (per-store)
- All downstream IDs (IM-01..IM-19, validation, dashboard labels, notifications, replies) must come from the resolved store template

## 2. Required Architecture (per CEO)

```
WhatsApp Group ID
    → Store Mapping (DB, authoritative)
    → Template Selection (per-store template_id)
    → OCR (uses the resolved template, not a hardcoded one)
    → Store-Specific Validation (per-store ranges and rules)
    → Store-Specific Reply (per-store prefix + format)
```

**Do NOT infer store from OCR.** Store must be resolved from the WhatsApp Group ID at the very start of the pipeline.

## 3. Store Mapping Table (Production)

| Group Label | WhatsApp Group ID | Store ID | Store Name | Template | Prefix |
| --- | --- | --- | --- | --- | --- |
| B1 Kitchen Log | `120363365547218966@g.us` | `rim` | The Rim | `FoodSafety-Rim-v3` | RIM |
| B2 Kitchen Log | `120363349425133238@g.us` | `stone_oak` | Stone Oak | `FoodSafety-StoneOak-v3` | SO |
| B3 Kitchen Log | `120363409731424335@g.us` | `bandera` | Bandera | `FoodSafety-Bandera-v3` | BAN |

## 4. DB Changes Applied

### Schema change

Added two columns to `group_workflow_config`:

```sql
ALTER TABLE group_workflow_config ADD COLUMN template_id TEXT;
ALTER TABLE group_workflow_config ADD COLUMN prefix TEXT DEFAULT 'SO';
```

### Data applied

```sql
INSERT INTO group_workflow_config
  (chat_id, group_name, store_id, store_name, template_id, prefix, enabled_workflows, active)
VALUES
  ('120363365547218966@g.us', 'B1 Kitchen Log', 'rim', 'The Rim', 'FoodSafety-Rim-v3', 'RIM', 'food_safety_capture', 1),
  ('120363349425133238@g.us', 'B2 Kitchen Log', 'stone_oak', 'Stone Oak', 'FoodSafety-StoneOak-v3', 'SO', 'food_safety_capture', 1),
  ('120363409731424335@g.us', 'B3 Kitchen Log', 'bandera', 'Bandera', 'FoodSafety-Bandera-v3', 'BAN', 'food_safety_capture', 1)
ON CONFLICT(chat_id) DO UPDATE SET
  template_id = excluded.template_id,
  prefix = excluded.prefix,
  store_id = excluded.store_id,
  store_name = excluded.store_name,
  enabled_workflows = excluded.enabled_workflows,
  active = 1;
```

### Lock applied

```sql
UPDATE store_groups SET locked = 1 WHERE chat_id IN (
  '120363365547218966@g.us',
  '120363349425133238@g.us',
  '120363409731424335@g.us'
);
```

This prevents staff from overriding the store via chat commands in production.

## 5. Verification

DB confirms all 3 real production groups have the correct store, template, and prefix:

```
{"chat_id":"120363349425133238@g.us","group_name":"B2 Kitchen Log","store_id":"stone_oak","store_name":"Stone Oak","template_id":"FoodSafety-StoneOak-v3","prefix":"SO","enabled_workflows":"food_safety_capture","active":1}
{"chat_id":"120363365547218966@g.us","group_name":"B1 Kitchen Log","store_id":"rim","store_name":"The Rim","template_id":"FoodSafety-Rim-v3","prefix":"RIM","enabled_workflows":"food_safety_capture","active":1}
{"chat_id":"120363409731424335@g.us","group_name":"B3 Kitchen Log","store_id":"bandera","store_name":"Bandera","template_id":"FoodSafety-Bandera-v3","prefix":"BAN","enabled_workflows":"food_safety_capture","active":1}
```

All 3 rows are also `locked=1` in `store_groups`.

## 6. Code Changes Required (Pre-Deploy Checklist)

The DB layer is fixed. The runtime code still needs the following updates to read these mappings and apply them per-group:

- [ ] Add `resolveStoreFromGroupId(chatId)` in `src/stores/store-registry.js` — returns `{store_id, store_name, template_id, prefix}` from `group_workflow_config` (no OCR fallback)
- [ ] Modify `src/food-safety/food-safety-pipeline.js` — call `resolveStoreFromGroupId` BEFORE OCR, use the resolved `template_id` and `prefix` for the entire pipeline
- [ ] Modify `src/template-ocr/template-cache.js` — add 3 new templates (`FoodSafety-Rim-v3`, `FoodSafety-StoneOak-v3`, `FoodSafety-Bandera-v3`) keyed by their respective `template_id`
- [ ] Remove `detectStoreFromText` usage from the image pipeline (still allowed in admin/test paths)
- [ ] Modify `src/template-ocr/template-ocr.js` — IDs (IM-01..IM-19), ranges, and reply format must come from the resolved template
- [ ] Modify `src/food-safety/warning-generator.js` — thresholds and ranges come from the resolved template
- [ ] Modify `src/food-safety/threshold-engine.js` — same
- [ ] Modify `src/food-safety/item-matcher.js` — same
- [ ] Modify `src/api/food-safety-command-center-routes.js` — dashboard labels use the resolved `prefix`
- [ ] Modify `src/google/daily-log-writer.js` — sheet labels use the resolved `prefix`

## 7. Runtime Validation (Pending)

After code changes are deployed:

1. **B1 test** — Upload Rim form in `120363365547218966@g.us`. Expect `RIM-01`..`RIM-19` (not SO-*). Dashboard row should show `store=rim`.
2. **B2 test** — Upload Stone Oak form in `120363349425133238@g.us`. Expect `SO-01`..`SO-19`. Dashboard row should show `store=stone_oak`.
3. **B3 test** — Upload Bandera form in `120363409731424335@g.us`. Expect `BAN-01`..`BAN-19`. Dashboard row should show `store=bandera`.
4. **Cross-test** — Upload a Rim form's image (which contains the text "stone oak" in some items) in the B2 Stone Oak group. Expect B2 template to win, NOT Rim template. The store resolution must NOT depend on OCR text.

## 8. Decision

DB is fixed and ready. Code changes are required before any production deployment of v2 behavior. **No production sign-off until runtime evidence from all 3 groups is collected.**
