# MANAGEMENT GROUP ALERT ROUTING REPORT

## Status: DB CONFIGURED — CODE PATH PENDING

Date: 2026-06-19
Author: DEV1

## 1. Management Group

| Field | Value |
| --- | --- |
| Group Name | Bakudan Management Team |
| Chat ID | `120363404818462093@g.us` |
| Workflow | `manager_alerts` |
| Active | Yes |

## 2. Manager Mapping

| Store Code | Store Name | Manager | Phone |
| --- | --- | --- | --- |
| B1 | The Rim | David | +1 (210) 685-3184 |
| B2 | Stone Oak | Edga | +1 (210) 979-1918 |
| B3 | Bandera | Miles | +1 (210) 771-2832 |

Stored in: `manager-mapping.json`

## 3. Alert Format

When an alert triggers, bot sends to `Bakudan Management Team`:

```
@David
⚠️ Food Safety Alert

Store: The Rim / B1
Issue: Unsafe Temperature

Item: RIM-01 Walk-In Cooler
Expected: 30°F – 45°F
Detected: 58°F

Please review.
```

If WhatsApp mention ID is unavailable:
```
Manager: David (+1 210 685 3184)

⚠️ Food Safety Alert
...
```

## 4. Alert Triggers

- Unsafe temperature (out of range)
- Low OCR confidence (< 70%)
- Missing required field
- Manual MANAGER reply from employee
- Duplicate suspicious form
- Missing submission after 30 minutes
- Auto-confirm blocked

## 5. Alert Routing Logic

```
Alert generated in B1/B2/B3
  │
  ├── Load manager-mapping.json
  ├── Find manager for store code (B1→David, B2→Edga, B3→Miles)
  ├── Format alert message with @ManagerName
  └── Send to Bakudan Management Team (120363404818462093@g.us)
```

## 6. Code Changes Required

- [ ] Load `manager-mapping.json` at startup
- [ ] Modify `src/alerts/manager-alert-service.js` to target management group
- [ ] Add @mention formatting with manager name
- [ ] Route all food safety warnings to management group
- [ ] Test with unsafe temperature trigger
