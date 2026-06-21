# LIVE TEST GROUP CONFIGURATION REPORT

## Status: PARTIAL — LD Agent-Logtest Not Yet Visible

Date: 2026-06-19
Author: DEV1
Runtime: Laptop1

## 1. Discovered Groups (WhatsApp API)

```json
{
  "groups": [
    {"chat_id": "120363404818462093@g.us", "name": "Bakudan Management Team", "type": "management"},
    {"chat_id": "120363349425133238@g.us", "name": "B1 Kitchen Log", "type": "production"},
    {"chat_id": "120363365547218966@g.us", "name": "B2 Kitchen Log", "type": "production"},
    {"chat_id": "120363409731424335@g.us", "name": "Bakudan B2", "type": "production"}
  ]
}
```

**LD Agent-Logtest: NOT YET VISIBLE** — The bot's WhatsApp account (+84 584 990 2302) has been added to the group by the CEO, but no message has been received yet. The bot only learns group IDs when it receives a message.

## 2. Configured groups in `group_workflow_config`

| Chat ID | Group Name | Store | Template | Prefix | Workflow | Active | Locked |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 120363349425133238@g.us | B1 Kitchen Log | The Rim | FoodSafety-Rim-v3 | RIM | food_safety_capture | 1 | Yes |
| 120363365547218966@g.us | B2 Kitchen Log | Stone Oak | FoodSafety-StoneOak-v3 | SO | food_safety_capture | 1 | Yes |
| 120363409731424335@g.us | Bakudan B2 | Bandera | FoodSafety-Bandera-v3 | BAN | food_safety_capture | 1 | Yes |
| 120363404818462093@g.us | Bakudan Management Team | Management | null | MGT | manager_alerts | 1 | Yes |

## 3. LD Agent-Logtest Configuration (Pending)

When the group becomes visible, it will be configured as:

```json
{
  "group_name": "LD Agent-Logtest",
  "group_type": "test",
  "workflow": "food_safety_capture",
  "store_resolution_mode": "form_header",
  "enabled": true,
  "locked": false,
  "allowed_templates": [
    "FoodSafety-Rim-v3",
    "FoodSafety-StoneOak-v3",
    "FoodSafety-Bandera-v3"
  ]
}
```

## 4. Production Group Rules

- All 3 production groups are **locked** (`locked=1`)
- Store is resolved from WhatsApp Group ID (authoritative)
- Do NOT infer store from OCR text in production groups
- Staff cannot override store via chat commands

## 5. Known Blockers

- LD Agent-Logtest chat ID not yet captured (bot needs to receive at least one message)
- No live form test data yet
