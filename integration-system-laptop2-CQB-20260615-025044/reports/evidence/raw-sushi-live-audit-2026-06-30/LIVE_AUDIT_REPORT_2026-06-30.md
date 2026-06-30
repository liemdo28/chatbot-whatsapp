# Raw Sushi Live Audit - 2026-06-30

## Scope

- Store audited: `Stockton / Raw Sushi Bistro`
- Report audited: `Sale Summary`
- Business dates downloaded individually: `2026-06-23` through `2026-06-29`
- QuickBooks company targeted: `C:\QB Data\Raw Stockton\rawstockton.qbw`

## QB status

- `QBStartupService` returned `QB_READY`
- Open company file confirmed as `rawstockton.qbw`

## Runtime fixes applied

1. Retargeted local runtime config from `Stone Oak` to `Stockton / Raw Sushi`
2. Enabled `qb_write_sync_enabled` in local runtime config for this machine
3. Forced QB sync service to prepare the correct company file before live Sales Receipt writes
4. Changed Toast Playwright path to prefer installed `chrome` channel instead of default `Chrome for Testing`
5. Fixed Toast download wrapper so a real `status=downloaded` result is recorded as success instead of false failure
6. Added a live audit script that captures windows and writes JSON/TXT audit artifacts

## Live issue encountered and fixed

- Initial live audit got stuck on a `Just a moment... - Google Chrome for Testing` verification window
- Root cause: Playwright static downloader launched the default automation browser instead of installed Chrome
- Fix: `toast_downloader.py` now prefers the installed Chrome channel and falls back only if needed
- Secondary bug: orchestration layer marked a completed Playwright download as failed because it expected a `success` flag that Toast did not emit on each file item

## Final result

- `7/7` Sale Summary downloads completed successfully
- Output folder:
  - `C:\ProgramData\ToastPOSManager\toast-reports\Stockton\Sale Summary`

## Downloaded files

- `2026-06-23_SalesSummary_Stockton.xlsx`
- `2026-06-24_SalesSummary_Stockton.xlsx`
- `2026-06-25_SalesSummary_Stockton.xlsx`
- `2026-06-26_SalesSummary_Stockton.xlsx`
- `2026-06-27_SalesSummary_Stockton.xlsx`
- `2026-06-28_SalesSummary_Stockton.xlsx`
- `2026-06-29_SalesSummary_Stockton.xlsx`

## Evidence

- App screenshot: `01-app-home.png`
- QuickBooks screenshot: `02-qb-window.png`
- Toast browser screenshot on Raw Sushi page: `window-captures/toast-005-Toast-Home---Google-Chrome.png`
- Folder screenshot with all 7 files: `04-stockton-sale-summary-folder.png`
- Machine-readable audit summary: `download-audit-summary.json`
- Audit log transcript: `download-audit-summary.txt`

## Notes

- `openpyxl` emitted `Workbook contains no default style` warnings while validating downloaded files. The downloads still validated successfully and the files were saved correctly.
