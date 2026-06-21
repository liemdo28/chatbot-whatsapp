# FOOD SAFETY GROUP BEHAVIOR V2 — RUNTIME REPORT

## Status: DB CONFIGURED — CODE CHANGES PENDING — LIVE TEST PENDING

Date: 2026-06-19
Author: DEV1
Runtime: Laptop1

## 1. Confirmed Group Configuration

### Production Groups (store resolved from group ID)

| Chat ID | Group Name | Store | Prefix | Template | Locked |
| --- | --- | --- | --- | --- | --- |
| 120363349425133238@g.us | B1 Kitchen Log | The Rim | RIM | FoodSafety-Rim-v3 | Yes |
| 120363365547218966@g.us | B2 Kitchen Log | Stone Oak | SO | FoodSafety-StoneOak-v3 | Yes |
| 120363409731424335@g.us | Bakudan B2 | Bandera | BAN | FoodSafety-Bandera-v3 | Yes |

### Test Group (store resolved from form header)

| Chat ID | Group Name | Resolution | Templates | Locked |
| --- | --- | --- | --- | --- |
| PENDING | LD Agent-Logtest | form_header | All 3 v3 | No |

### Management Group

| Chat ID | Group Name | Workflow |
| --- | --- | --- |
| 120363404818462093@g.us | Bakudan Management Team | manager_alerts |

## 2. Manager Mapping

| Store | Manager | Phone | Alert Tag |
| --- | --- | --- | --- |
| B1 / The Rim | David | +1 (210) 685-3184 | @David |
| B2 / Stone Oak | Edga | +1 (210) 979-1918 | @Edga |
| B3 / Bandera | Miles | +1 (210) 771-2832 | @Miles |

## 3. State Machine

```
Image received → DOWNLOADING → DETECTING
  │
  ├── Official form → OCR_RUNNING → WAITING_CONFIRM
  │     ├── CONFIRM → SUBMITTED → SAVED+SHEET
  │     ├── EDIT → EDITED → re-validate → WAITING_CONFIRM
  │     ├── RETAKE → cleared
  │     ├── MANAGER → ESCALATED → alert to Bakudan Management Team
  │     ├── CANCEL → cleared
  │     └── 60s timeout → 1 reminder → 5min auto-confirm or MANAGER_REVIEW
  │
  └── Non-form → IGNORED (silent or evidence-only)
```

## 4. Rules Summary (Tasks 4-12)

| Task | Rule | Status |
| --- | --- | --- |
| 4 | One reply only + dedup | Design done, code pending |
| 5 | Official form only | Design done, code pending |
| 6 | Store-specific output (RIM-*/SO-*/BAN-*) | Design done, code pending |
| 7 | Correct range source from template | Design done, code pending |
| 8 | Column selection (1=10AM, 2=4PM) | Design done, code pending |
| 9 | 60s reminder + 5min auto-confirm | Design done, code pending |
| 10 | Cross-store 30min reminder | Design done, code pending |
| 11 | Group scope (5 groups only) | DB configured |
| 12 | Manager alerts with @mention | DB + JSON configured, code pending |

## 5. Group Scope (Task 11)

Only active in:

1. B1 Kitchen Log — production
2. B2 Kitchen Log — production
3. Bakudan B2 — production
4. LD Agent-Logtest — test
5. Bakudan Management Team — management

All other groups: silent. No OCR. No replies. No commands.

## 6. Files Changed

| File | Purpose | Status |
| --- | --- | --- |
| `group_workflow_config` DB | Group → store → template mapping | DONE |
| `store_groups` DB | Group lock configuration | DONE |
| `manager-mapping.json` | Manager names + phones | DONE |
| `configure-all-groups.js` | DB setup script | DONE |
| `fix-b1b2-swap.js` | Critical mapping fix | DONE |
| `manager-alert-service.js` (code) | Manager alert routing | PENDING |
| `message-listener.js` (code) | Dedup + one-reply | PENDING |
| `image-analyzer.js` (code) | Form header detection | PENDING |
| `template-cache.js` (code) | Store-specific templates | PENDING |
| `food-safety-pipeline.js` (code) | Silent processing | PENDING |

## 7. Known Blockers

1. **LD Agent-Logtest chat ID not captured** — Bot needs to receive at least one message in the test group
2. **No live form test data** — Need actual Rim, Stone Oak, Bandera form images uploaded
3. **Code changes not merged** — Dedup, one-reply, store-specific templates, manager alerts, form-header detection all need code changes
4. **Manager WhatsApp IDs unknown** — manager_whatsapp_id is null (can fall back to name + phone display)

## 8. CEO Approval Checklist

- [ ] LD Agent-Logtest is captured and configured
- [ ] Bakudan Management Team is captured and configured ✅
- [ ] B1 outputs RIM-* (verified in DB config)
- [ ] B2 outputs SO-* (verified in DB config)
- [ ] B3 outputs BAN-* (verified in DB config)
- [ ] Production groups are group-ID locked ✅
- [ ] Test group resolves by form header (design done)
- [ ] Only one reply per form image (design done)
- [ ] Food photos are not parsed as forms (design done)
- [ ] Manager alerts go to Management group (DB configured)
- [ ] Correct manager is tagged/named (mapping configured)
- [ ] Cross-store reminder logic exists (design done)
- [ ] 60s reminder and 5min auto-confirm logic exists (design done)

## 9. Next Steps

1. Send a message in "LD Agent-Logtest" to capture its group ID
2. Implement code changes (dedup, one-reply, store-specific templates, manager alerts, form-header detection)
3. Run live tests A-E in LD Agent-Logtest
4. Capture screenshots
5. Final CEO approval
