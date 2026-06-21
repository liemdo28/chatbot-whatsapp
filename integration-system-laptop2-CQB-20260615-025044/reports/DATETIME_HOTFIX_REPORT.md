# Datetime Hotfix Report

**Date:** 2026-06-10  
**Severity:** P0 BLOCKER  
**Area:** App startup / ActivityAuditCenter  
**Python:** 3.14.5 on laptop validation

## Final Verdict

**PASS**

The startup crash caused by mixed timezone-aware and timezone-naive datetime comparison is fixed and covered by regression tests.

## Root Cause

The app crashed while building the UI because `ActivityAuditCenter` called:

```python
get_events(since=since, category=cat_filter, limit=200)
```

For the Today filter, `since` was a local naive datetime:

```python
datetime(local_now.year, local_now.month, local_now.day)
```

`desktop-app/services/activity_log_service.py` then compared that path against UTC-aware datetimes:

```python
end = datetime.now(timezone.utc)
cur = datetime(since.year, since.month, 1)
while cur <= end:
```

Python 3.14 raises:

```text
TypeError: can't compare offset-naive and offset-aware datetimes
```

## Files Changed

```text
desktop-app/services/activity_log_service.py
tests/test_activity_log_service_datetime.py
```

## Fix Applied

Added UTC normalization helpers:

```python
def _as_utc_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
```

```python
def _parse_event_time(timestamp: str) -> datetime:
    raw = (timestamp or "").strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    parsed = datetime.fromisoformat(raw)
    return _as_utc_aware(parsed)
```

Updated `_all_log_files()` so both `cur` and `end` are UTC-aware before comparison.

Updated `get_events()` so `since` and parsed event timestamps are UTC-aware before comparison.

## Regression Tests Added

```text
tests/test_activity_log_service_datetime.py
```

Cases covered:

```text
naive start + aware end
aware start + naive end
aware start + aware end
naive start + naive end
```

Expected:

```text
No crash
Correct monthly activity log file list returned
Events still load from JSONL
```

## Project Datetime Audit

Commands run:

```powershell
rg -n "datetime\.utcnow\(" desktop-app tests -S -g "!**/.venv/**" -g "!**/__pycache__/**"
rg -n "fromisoformat\(|replace\(tzinfo|datetime\.now\(timezone\.utc\)|datetime\.now\(\)" desktop-app\services desktop-app\ui tests -S -g "!**/.venv/**" -g "!**/__pycache__/**"
```

Findings:

```text
datetime.utcnow(): no matches
activity_log_service.py: mixed aware/naive comparison fixed
qb_multi_file_sync_scheduler.py: existing fromisoformat path already normalizes naive values before UTC compare
integration_status.py: existing parser/coercer normalizes UTC when used for comparisons
Remaining datetime.now() usages are display, filenames, date-only UI selection, or local schedule calculations
```

## Test Output

Focused regression:

```text
5 passed in 0.08s
```

Related focused validation:

```text
37 passed in 0.45s
```

Full tests:

```text
469 passed in 26.05s
```

## App Startup Proof

Command:

```powershell
$env:PYTHONPATH='E:\Project\Master\Bakudan\integration-system\desktop-app'
@'
from app import App
app = App(runtime_mode="gui", start_hidden=True, headless_downloads=None)
print("APP_CREATED_OK")
print("HAS_AUDIT_TAB=", hasattr(app, "audit_tab"))
app.destroy()
'@ | .\desktop-app\.venv\Scripts\python.exe -
```

Output:

```text
APP_CREATED_OK
HAS_AUDIT_TAB= True
```

This proves the UI builds through `ActivityAuditCenter` without the datetime exception.

## Remaining Notes

The laptop package still requires each laptop to configure its real `.qbw` path and establish network access to the PC-hosted `mi-core` at:

```text
http://100.118.102.113:4001
```
