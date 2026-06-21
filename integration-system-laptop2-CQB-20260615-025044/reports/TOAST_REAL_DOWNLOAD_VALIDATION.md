# Toast Real Download Validation

Date: 2026-06-10

## Requested Live Test

- Report type: Sales Summary or report currently needed for QB sync
- Store: one active Bakudan/Raw store
- Date: previous business day
- Output folder: `C:\ProgramData\ToastPOSManager\toast-reports\<store>\<date>\...`

## Source Controls Added

Implemented:

- `desktop-app/services/toast_download_orchestrator.py`
- `desktop-app/services/toast_report_validator.py`
- `desktop-app/ui/toast_download_panel.py`

Validation checks implemented:

- File exists
- File size minimum
- Required columns/sheets via existing Toast report validator
- HTML/login/error page detection
- Expected store/date warning checks

## Live Result

```text
NOT RUN
```

Reason:

No real ToastTab authenticated browser session is available in this workspace.

## Test Evidence

Unit-level report validation and orchestrator tests pass:

```text
Focused Toast Browser-Use/UI tests: 14 passed
Full suite: 489 passed
```

## Verdict

```text
PASS WITH WARNINGS
```

The source path is ready for operator-triggered live validation from the UI panel, but no real report file was downloaded in this environment.
