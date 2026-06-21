# Laptop2 Install Notes

This package is prepared for QB Laptop 2 / Stone Oak.

QuickBooks company file expected by default:

```text
C:\QB\StoneOak.qbw
```

Install:

1. Put the source folder on laptop2.
2. Make sure QuickBooks Desktop is installed.
3. Make sure the company file is at `C:\QB\StoneOak.qbw`.
4. Run `INSTALL-laptop-02.bat`.
5. Launch `ToastPOSManager` from the Desktop shortcut.

If the actual QB file has a different name, update these values before install:

```text
desktop-app\config-templates\laptop-02-local-config.json
quickbooks.company_file
qbw_paths.Stone Oak
quickbooks_files.company_files[0].company_file_path
```

Live QB writes are intentionally OFF in the template:

```json
"qb_write_sync_enabled": false,
"auto_sync": {
  "enabled": false,
  "require_preview_before_first_live_sync": true
}
```

For auto-login, password slots are stored in `desktop-app\.env.qb`.
Laptop2 uses `password_key: "pass1"` by default, so the matching variable is:

```text
QB_PASSWORD1=your_quickbooks_password
```

If passwords change later, edit `desktop-app\.env.qb` and restart the background agent.
