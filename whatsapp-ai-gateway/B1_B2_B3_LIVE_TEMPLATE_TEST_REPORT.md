# B1/B2/B3 LIVE TEMPLATE TEST REPORT

## Status: AWAITING LIVE TEST — LD Agent-Logtest Required

Date: 2026-06-19
Author: DEV1

## 1. Test Matrix

| Test | Form | Expected Store | Expected Prefix | Expected IDs | Group |
| --- | --- | --- | --- | --- | --- |
| Test A | Rim LineCheck | The Rim / B1 | RIM | RIM-01 to RIM-19 | LD Agent-Logtest |
| Test B | Stone Oak LineCheck | Stone Oak / B2 | SO | SO-01 to SO-19 | LD Agent-Logtest |
| Test C | Bandera LineCheck | Bandera / B3 | BAN | BAN-01 to BAN-19 | LD Agent-Logtest |
| Test D | Food photo | N/A | N/A | No output | LD Agent-Logtest |
| Test E | Manager alert trigger | N/A | N/A | Alert in Management | B1/B2/B3 |

## 2. Expected Template Output

Each form upload must produce a single reply with:
- Store code and name header
- Store-specific prefix IDs (RIM-*, SO-*, BAN-*)
- Temperature ranges from the resolved template
- CONFIRM/EDIT/RETAKE/MANAGER/CANCEL options

## 3. Validation Criteria

- IDs must NOT be generic IM-*
- IDs must use the resolved store prefix
- Ranges must match the printed form template
- Only one bot reply per uploaded form
- Non-form images produce no RIM/SO/BAN rows
- Manager alerts appear in Bakudan Management Team

## 4. Pending

- [ ] LD Agent-Logtest group needs to receive at least one message for bot to discover it
- [ ] Upload Rim form → verify RIM-01..RIM-19
- [ ] Upload Stone Oak form → verify SO-01..SO-19
- [ ] Upload Bandera form → verify BAN-01..BAN-19
- [ ] Upload food photo → verify no form output
- [ ] Trigger unsafe temp → verify manager alert in Management group
