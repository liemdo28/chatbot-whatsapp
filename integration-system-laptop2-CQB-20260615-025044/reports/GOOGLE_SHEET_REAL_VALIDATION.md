# GOOGLE SHEET REAL VALIDATION

**Report Date:** 2026-06-05 16:32 UTC+7  
**Status:** PASS — real Google Sheets API connection validated.  
**Sheet Name:** `Bakudan QB Remote Ops Report`  
**Sheet URL:** https://docs.google.com/spreadsheets/d/11eSF0DcAzdYnei1m9lQxHvVd3I0L0S3T0AHKquQsUug/edit

## Required Proof

| Requirement | Status | Evidence |
|---|---|---|
| Can create tab | PASS | Created `Validation`, sheet ID `311888188` |
| Can append row | PASS | Updated `Validation!A1:C2`, 6 cells |
| Can update row | PASS | Updated `Validation!A2:C2`, 3 cells |
| Can reconnect | PASS | Reconnected, read back updated row, created `ReconnectCheck` tab |

## Validation Result

```json
{
  "ok": true,
  "spreadsheet_id": "11eSF0DcAzdYnei1m9lQxHvVd3I0L0S3T0AHKquQsUug",
  "spreadsheet_url": "https://docs.google.com/spreadsheets/d/11eSF0DcAzdYnei1m9lQxHvVd3I0L0S3T0AHKquQsUug/edit",
  "sheet_title": "Bakudan QB Remote Ops Report",
  "created_tab": "Validation",
  "created_sheet_id": 311888188,
  "append_updates": {
    "updatedRange": "Validation!A1:C2",
    "updatedRows": 2,
    "updatedColumns": 3,
    "updatedCells": 6
  },
  "update_result": {
    "updatedRange": "Validation!A2:C2",
    "updatedRows": 1,
    "updatedColumns": 3,
    "updatedCells": 3
  },
  "reconnect_read_back": {
    "range": "Validation!A1:C2",
    "values": [
      ["created_at", "status", "note"],
      ["2026-06-05 09:32:21 UTC", "UPDATED", "row updated successfully"]
    ]
  },
  "validated_at": "2026-06-05T09:32:26.536206+00:00"
}
```

## Evidence

Script:

```text
reports/evidence/google_sheet_real_validation.py
```

Latest command:

```text
python reports\evidence\google_sheet_real_validation.py
```

Latest result file:

```text
reports/evidence/google_sheet_validation_result.json
```

