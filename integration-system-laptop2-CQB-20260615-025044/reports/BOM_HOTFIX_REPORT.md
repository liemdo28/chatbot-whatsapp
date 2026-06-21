# CEO HOTFIX - UTF-8 BOM CONFIG CRASH

Date: 2026-06-10
Severity: P0 STARTUP BLOCKER

## Root Cause

Windows tools can save JSON files as UTF-8 with BOM. The app had multiple JSON config/runtime readers using plain `encoding="utf-8"`, which leaves the BOM marker in the first token and can raise:

```text
json.JSONDecodeError: Unexpected UTF-8 BOM (decode using utf-8-sig)
```

This can block startup when `local-config.json` contains a BOM.

## Files Changed

- `desktop-app/json_file_utils.py`
- `desktop-app/bootstrap_runtime.py`
- `desktop-app/app_shared.py`
- `desktop-app/background_agent.py`
- `desktop-app/agentai_sync.py`
- `desktop-app/first_run_wizard.py`
- `desktop-app/gdrive_service.py`
- `desktop-app/qb_sync.py`
- `desktop-app/mapping_maintenance.py`
- `desktop-app/runtime_manifest.py`
- `desktop-app/worker_runtime.py`
- `desktop-app/services/*` JSON config/state readers
- `desktop-app/ui/first_run_wizard.py`
- `desktop-app/ui/home_dashboard.py`
- `desktop-app/ui/tabs/settings_tab.py`
- `tests/test_config_loader_utf8_bom.py`

## Fix

Added shared JSON helper:

```python
def load_json_file(path, *, default=None, missing_ok=False):
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)
```

Startup-critical readers now accept both:

- UTF-8
- UTF-8 with BOM

Writers still save UTF-8 without BOM.

## Regression Tests Added

`tests/test_config_loader_utf8_bom.py`

Cases covered:

- UTF-8 config: PASS
- UTF-8 BOM config: PASS
- Missing config with default: PASS
- Empty config: controlled `JSONDecodeError`
- Corrupted config: controlled `JSONDecodeError`
- Bootstrap reads BOM `local-config.json` without marking it malformed

## Test Output

```text
python -m pytest tests/test_config_loader_utf8_bom.py -q
6 passed in 0.10s

python -m pytest tests -q
475 passed in 15.93s
```

## App Startup Proof

Validation temporarily wrote `desktop-app/local-config.json` as UTF-8 with BOM, ran bootstrap, created the app, then restored the original bytes.

```text
BOOTSTRAP_CAN_RUN= True
BOOTSTRAP_SUMMARY= All checks passed
APP_CREATED_OK
HAS_AUDIT_TAB= True
```

Observed during harness-only teardown:

```text
pystray not installed - system tray will not be available.
RuntimeError: main thread is not in main loop
```

This occurred after the test script destroyed the Tk app without entering the normal GUI mainloop. It did not prevent bootstrap or app creation and is not the UTF-8 BOM startup crash.

## Final Verdict

P0 UTF-8 BOM startup blocker fixed.

Current verdict remains:

```text
PASS WITH WARNINGS
NOT PRODUCTION READY
```

Production readiness still depends on the broader acceptance criteria: live Mi-core/Tailscale validation, laptop install validation, QB Agent validation, outbox validation, and final 471/471-equivalent production gate.
