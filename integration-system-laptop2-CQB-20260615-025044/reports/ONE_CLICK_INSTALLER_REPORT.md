# One-Click Installer Report
**Generated:** 2026-06-09

---

## Installer Files

| File | Path | Status |
|---|---|---|
| Inno Setup script | `installer/ToastPOSManager.iss` | ✅ Created |
| Build script | `installer/build_installer.ps1` | ✅ Created |
| Output (after build) | `release/ToastPOSManagerSetup.exe` | Pending build |

---

## Build Prerequisites

1. **Inno Setup 6** — https://jrsoftware.org/isdl.php
2. **PyInstaller EXE** — run `cd desktop-app && .\build_release.ps1` first

## Build Command

```powershell
cd installer
.\build_installer.ps1
```

---

## Install Flow

```
Double-click ToastPOSManagerSetup.exe
→ Welcome screen
→ Select install directory (default: %LOCALAPPDATA%\Programs\ToastPOSManager)
→ Choose: desktop icon + startup agent task
→ Install (copies EXE, creates shortcuts, data dirs)
→ Creates Windows scheduled task: ToastPOSManager-Background (ONLOGON)
→ Launches: ToastPOSManager.exe --first-run
→ First-run wizard opens
→ User configures Mi-core URL, API key, machine ID
→ User scans QB files
→ User enables 12h sync
→ Background agent starts
```

---

## Installer Features

| Feature | Status |
|---|---|
| Install to AppData/Program Files | ✅ |
| Start Menu shortcut | ✅ |
| Desktop shortcut (optional) | ✅ |
| Windows scheduled task at logon | ✅ (`schtasks /Create /SC ONLOGON`) |
| Uninstall entry | ✅ (Inno Setup built-in) |
| Uninstall removes scheduled task | ✅ (`schtasks /Delete` in `[UninstallRun]`) |
| Creates local data dirs | ✅ (`%LOCALAPPDATA%\ToastPOSManager\logs\`, `runtime\`) |
| Launches first-run wizard | ✅ (`--first-run` flag) |
| Privilege: user-level | ✅ (`PrivilegesRequired=lowest`) |

---

## First-Run Wizard (desktop-app/ui/first_run_wizard.py)

Steps:
1. Welcome
2. Mi-core URL + API key (with Test Connection button)
3. Machine ID + name + store code
4. QB file scan (auto-detects .QBW/.QBM/.QBB)
5. 12h sync schedule + startup option
6. Done (installs startup task if selected)

API key is written to `.env` file (not plain JSON config).

---

## Verdict

READY FOR BUILD — Inno Setup 6 required on build machine.
EXE must be built first via PyInstaller before running installer build.
