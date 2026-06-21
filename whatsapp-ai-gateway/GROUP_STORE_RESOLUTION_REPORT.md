# GROUP STORE RESOLUTION REPORT

## Status: DB CORRECTED — B1/B2 SWAP FIXED

Date: 2026-06-19
Author: DEV1
Severity: P0 CRITICAL (mapping swap)

## 1. Bug Found

The WhatsApp OS store revealed actual group names that differed from assumptions:

```
120363349425133238@g.us = "B1 Kitchen Log"
120363365547218966@g.us = "B2 Kitchen Log"
120363409731424335@g.us = "Bakudan B2"
```

The DB had:
```
120363349425133238@g.us → stone_oak (WRONG)
120363365547218966@g.us → rim (WRONG)
```

B1 and B2 were swapped.

## 2. Fix Applied

Applied via `fix-b1b2-swap.js`:

```sql
UPDATE group_workflow_config SET
  store_id='rim', store_name='The Rim',
  group_name='B1 Kitchen Log',
  template_id='FoodSafety-Rim-v3', prefix='RIM'
WHERE chat_id='120363349425133238@g.us';

UPDATE group_workflow_config SET
  store_id='stone_oak', store_name='Stone Oak',
  group_name='B2 Kitchen Log',
  template_id='FoodSafety-StoneOak-v3', prefix='SO'
WHERE chat_id='120363365547218966@g.us';

UPDATE group_workflow_config SET
  store_id='bandera', store_name='Bandera',
  group_name='Bakudan B2',
  template_id='FoodSafety-Bandera-v3', prefix='BAN'
WHERE chat_id='120363409731424335@g.us';
```

## 3. Verified Production Mapping

| Group Label (WhatsApp) | WhatsApp Group ID | Store ID | Store Name | Template | Prefix |
| --- | --- | --- | --- | --- | --- |
| B1 Kitchen Log | `120363349425133238@g.us` | `rim` | The Rim | `FoodSafety-Rim-v3` | `RIM` |
| B2 Kitchen Log | `120363365547218966@g.us` | `stone_oak` | Stone Oak | `FoodSafety-StoneOak-v3` | `SO` |
| Bakudan B2 | `120363409731424335@g.us` | `bandera` | Bandera | `FoodSafety-Bandera-v3` | `BAN` |

All rows are `locked=1` in `store_groups` — staff cannot override via chat commands.

## 4. Store Resolution Rules

**Production groups** (`group_workflow_config` with `locked=1`):
- Store is resolved from WhatsApp Group ID (authoritative)
- Do NOT infer store from OCR text
- All IDs, ranges, validation, dashboard labels come from the resolved store template

**Test group** (`LD Agent-Logtest`, when configured):
- Store is resolved from form header content (e.g., "Rim", "Stone Oak", "Bandera" in the form text)
- Only the test group may use form-header detection
- Production groups never use this mode

## 5. LD Agent-Logtest Status

**Status: NOT YET VISIBLE TO BOT**

The bot's WhatsApp account (+84 584 990 2302 / Liem Do) must be added as a member of the "LD Agent-Logtest" group before it can see or respond to messages.

Once the bot is a member and receives a message, the chat ID will appear and can be configured with:
```json
{
  "group_name": "LD Agent-Logtest",
  "group_type": "test",
  "store_resolution_mode": "form_header",
  "allowed_templates": [
    "FoodSafety-Rim-v3",
    "FoodSafety-StoneOak-v3",
    "FoodSafety-Bandera-v3"
  ],
  "enabled": true
}
```

## 6. Pending Tasks

- [ ] Add +84 584 990 2302 to LD Agent-Logtest group
- [ ] Capture group chat ID from DB
- [ ] Configure group_workflow_config for test group
- [ ] Add form-header detection code path for test group only
- [ ] Run 3-form live test (Rim, Stone Oak, Bandera)
- [ ] Capture screenshots from test group
- [ ] Capture dashboard/API evidence
