# Auto-Updater Data Preservation Report
**Date:** 2026-06-09

---

## Data Preservation Guarantee

The auto-updater NEVER deletes or overwrites user data.

### Separation of App vs Data

```
C:\Program Files\ToastPOSManager\         ← APP (replaced on update)
  ToastPOSManager.exe
  ToastPOSManagerBackground.exe
  version.json
  local-config.example.json
  assets\

C:\ProgramData\ToastPOSManager\           ← USER DATA (never touched)
  config\
    local-config.json                     ← Mi-core URL, machine_id, QB files
    machine-identity.json                 ← Laptop identity
  runtime\
    agent-heartbeat.json                  ← Last heartbeat state
    scheduler-state.json                  ← 12h sync state
    reporting-outbox\                     ← Unsent reports
    qb-file-sync-state.json               ← File sync cycle state
  logs\
    qb-activity\                          ← QB activity CSV/JSON logs
    reporting-events\                     ← Report event logs
  db\
    sync-ledger.db                        ← SQLite sync history
    qb-agent.db                           ← QB agent data
  backups\
    pre-update-<version>-<timestamp>\     ← Created BEFORE each update
  updates\
    ToastPOSManagerSetup-<version>.exe    ← Downloaded installer
```

---

## Backup Contents (Pre-Update Snapshot)

Created at: `C:\ProgramData\ToastPOSManager\backups\pre-update-<version>-<timestamp>\`

| File | Why backed up |
|---|---|
| `config/local-config.json` | Machine configuration, QB file paths, Mi-core URL |
| `config/machine-identity.json` | machine_id, store_code |
| `runtime/agent-heartbeat.json` | Last known agent state |
| `runtime/scheduler-state.json` | Next sync time, cycle state |
| `db/sync-ledger.db` | Full sync history |
| `db/qb-agent.db` | QB agent data |
| `runtime/reporting-outbox/` | Unsent reports (full directory copy) |
| `backup-manifest.json` | List of backed-up files + timestamp |

---

## Rollback Procedure

If new version fails to start:
1. `update_rollback_service.py` finds the most recent `pre-update-*` backup
2. Restores all files listed in `backup-manifest.json`
3. Reports `UPDATE_ROLLBACK_COMPLETED` to Mi-core
4. Background agent remains running (old version)

```python
from services.update_rollback_service import rollback
result = rollback(version="1.2.0")  # restore from latest backup for 1.2.0
```

---

## Safety Rules (Never Install If)

| Condition | Check |
|---|---|
| QB sync running | `runtime/qb-sync-running.lock` exists |
| Remote command running | `runtime/remote-command-running.lock` exists |
| Backup failed | `BackupResult.success is False` |
| SHA-256 mismatch | Detected in `update_downloader.py` |
| Download incomplete | Size mismatch check |

---

## Installer Safety (Inno Setup)

```iss
; Data dir is NEVER in [UninstallDelete] or [InstallDelete]
; CurUninstallStepChanged() is intentionally empty
; ForceDirectories() only creates — never deletes
```

Result: even if user runs installer twice, or uninstalls then reinstalls,
`C:\ProgramData\ToastPOSManager\` and all its contents are preserved.
