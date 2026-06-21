# Browser-Use ToastTab Integration Report

Date: 2026-06-10

## Integration Summary

Browser-Use was added as an optional ToastTab automation layer. It does not replace the current Playwright downloader.

Implemented modes:

- `PLAYWRIGHT_STATIC`
- `BROWSER_USE_AGENT`
- `HYBRID_FALLBACK`

Default:

```text
HYBRID_FALLBACK
```

## Files Added

- `desktop-app/services/toast_browser_agent.py`
- `desktop-app/services/toast_browser_use_downloader.py`
- `desktop-app/services/toast_download_orchestrator.py`
- `desktop-app/services/toast_report_validator.py`
- `desktop-app/services/toast_human_handoff.py`
- `desktop-app/ui/toast_download_panel.py`
- `desktop-app/requirements-browser-use.txt`
- `tests/test_toast_download_orchestrator.py`
- `tests/test_toast_browser_use_downloader.py`
- `tests/test_toast_report_validator.py`
- `tests/test_toast_human_handoff.py`
- `tests/test_toast_browser_agent_safety.py`
- `tests/test_toast_download_panel_wiring.py`

## Files Updated

- `desktop-app/bootstrap_runtime.py`
- `desktop-app/local-config.example.json`
- `desktop-app/config-templates/laptop-01-local-config.json`
- `desktop-app/config-templates/laptop-02-local-config.json`
- `desktop-app/app.py`
- `desktop-app/services/ui_state_service.py`
- `installer/build-deploy-zips.ps1`

## Config Added

```json
{
  "toast_download": {
    "enabled": true,
    "automation_mode": "HYBRID_FALLBACK",
    "download_dir": "C:\\ProgramData\\ToastPOSManager\\toast-reports",
    "allowed_domains": [
      "*.toasttab.com",
      "*.toasttab.com/*"
    ],
    "browser_profile": {
      "use_real_profile": true,
      "browser": "chrome",
      "profile_path": "",
      "require_existing_login": true
    },
    "browser_use": {
      "enabled": true,
      "model_provider": "openai",
      "model": "gpt-5.5",
      "timeout_seconds": 180,
      "max_steps": 40,
      "headless": false,
      "human_approval_required_for_login": true,
      "never_store_password": true
    }
  }
}
```

Existing installs will auto-heal this config through `bootstrap_runtime.py`.

## Service Behavior

`toast_download_orchestrator.py`:

1. Emits `TOAST_DOWNLOAD_STARTED`.
2. Runs Playwright first in `HYBRID_FALLBACK`.
3. If Playwright succeeds, validates downloaded report and does not call Browser-Use.
4. If Playwright fails due selector/navigation, calls Browser-Use.
5. If login/MFA/CAPTCHA/permission blocker appears, creates handoff and returns `HUMAN_REQUIRED`.
6. Validates downloaded report before marking success.
7. Emits Mi-core events through the existing client when supplied.

Statuses implemented:

- `DOWNLOAD_STARTED`
- `PLAYWRIGHT_RUNNING`
- `PLAYWRIGHT_FAILED`
- `BROWSER_USE_RUNNING`
- `BROWSER_USE_FAILED`
- `HUMAN_REQUIRED`
- `DOWNLOAD_COMPLETED`
- `REPORT_VALIDATED`
- `REPORT_INVALID`

Mi-core event names implemented:

- `TOAST_DOWNLOAD_STARTED`
- `TOAST_PLAYWRIGHT_RUNNING`
- `TOAST_PLAYWRIGHT_FAILED`
- `TOAST_BROWSER_USE_STARTED`
- `TOAST_BROWSER_USE_COMPLETED`
- `TOAST_BROWSER_USE_FAILED`
- `TOAST_HUMAN_REQUIRED`
- `TOAST_REPORT_VALIDATED`
- `TOAST_REPORT_INVALID`

## Safety Controls

Allowed actions:

- Navigate
- Click report menu
- Set date filter
- Select store
- Download CSV/XLSX/PDF
- Take screenshot
- Return status

Forbidden actions:

- Change settings
- Delete reports
- Modify menu/items
- Change payroll
- Change payments
- Submit non-report forms
- Store passwords
- Bypass MFA/CAPTCHA

Authentication policy:

- Prefer existing Chrome/Edge profile.
- Plain-text passwords are not allowed.
- Hardcoded credentials are not allowed.
- MFA/CAPTCHA bypass is not allowed.
- Human login handoff is required for login/MFA/CAPTCHA.

## Install Result

Browser-Use was not installed into the default app venv.

Reason:

```text
It must remain optional until Python runtime and laptop validation pass.
```

Dry-run result:

```text
python -m pip install --dry-run "browser-use[core]==0.13.1"
Resolved successfully on Python 3.13.12
```

Optional install file:

```text
desktop-app/requirements-browser-use.txt
```

## Compatibility Result

```text
PASS WITH WARNINGS
```

Known compatibility risks:

- Laptop Python 3.14.5 not validated.
- Browser-Use docs recommend Python 3.12 environment.
- PyInstaller/frozen EXE packaging not validated.
- Browser-Use has many optional/native dependencies.

## Test Output

Focused tests:

```text
14 passed in 0.61s
```

Full suite:

```text
489 passed in 16.83s
```

## UI Panel Proof

Implemented:

```text
desktop-app/ui/toast_download_panel.py
desktop-app/app.py
desktop-app/services/ui_state_service.py
```

Startup proof:

```text
APP_CREATED_OK
HAS_TOAST_DOWNLOAD_PANEL= True
TOAST_FRAME_EXISTS= True
```

Panel shows:

- Automation Mode
- Browser-Use Installed
- Toast Login Status
- Last Download Status
- Last Downloaded File
- Last Error
- Human Required

Buttons:

- Test Toast Login
- Download Report Now
- Open Download Folder
- Human Login Completed
- Switch Mode via mode dropdown

## Manual Toast Download Proof

```text
NOT RUN
```

No live ToastTab browser profile was available in this environment.

## Downloaded File Path

```text
N/A - live Browser-Use Toast download not run
```

## Validation Result

Unit-level validator tests pass.

Live report validation:

```text
NOT RUN
```

## Mi-core Event Proof

Unit-level fake Mi-core client test confirms events are emitted.

Live Mi-core event proof:

```text
NOT RUN
```

## Google Sheet Row Proof

```text
NOT RUN
```

The current implementation emits Mi-core events. Google Sheet update should remain centralized through Mi-core/Agent-Coding reporting, not direct laptop writes.

## Known Limitations

- Browser-Use is optional and not installed by default.
- Real ToastTab UI behavior is not validated.
- Real Chrome profile reuse is not validated.
- CAPTCHA/MFA must stop automation and require human action.
- Google Sheet `Toast Downloads` tab update is not yet proven live.
- PyInstaller packaging with Browser-Use is not validated.

## Final Verdict

```text
PASS WITH WARNINGS
```

FULL PASS is not allowed yet because:

- Browser-Use is not installed in target laptop runtime from this workspace.
- Existing profile login has not been proven.
- Report download has not been proven.
- Report validation has not been proven against a real downloaded Toast report.
- Mi-core live event was not proven.
- Google Sheet row was not proven.
