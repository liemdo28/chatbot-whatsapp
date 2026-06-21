# Auto-Updater Architecture
**Date:** 2026-06-09  
**System:** integration-system QB Agent — Auto-Update via Mi-core

---

## Overview

```
Mi-core (CEO PC, port 4001)
  ├── GET  /api/integration-agent/releases/latest    ← version manifest
  ├── GET  /api/integration-agent/releases/:version  ← specific version
  ├── POST /api/integration-agent/releases            ← publish new release
  ├── POST /api/integration-agent/update-events       ← agent reports progress
  ├── GET  /api/integration-agent/update-events       ← CEO sees history
  └── GET  /api/integration-agent/machines/versions  ← per-laptop versions

QB Laptop (integration-system)
  ├── update_scheduler.py   → checks every 12h (background thread)
  ├── update_client.py      → queries Mi-core, compares semver
  ├── update_downloader.py  → downloads to C:\ProgramData\ToastPOSManager\updates\
  ├── update_backup_service.py → snapshots config/db/runtime before install
  ├── update_installer.py   → stops agent, runs installer silently, restarts
  └── update_rollback_service.py → restores from backup if new version fails
```

---

## Update Flow

```
App detects new version (scheduler or manual check)
  │
  ▼
Show "Update Available" banner/notification
  │
  ▼ User clicks UPDATE (never auto-installs without approval)
  │
  ├─ Safety check:
  │   QB sync running?         → DEFER
  │   Remote command running?  → DEFER
  │   Backup fails?            → ABORT
  │   SHA-256 mismatch?        → ABORT
  │
  ▼
Download installer → C:\ProgramData\ToastPOSManager\updates\ToastPOSManagerSetup-<v>.exe
  │  Validate size + SHA-256
  │
  ▼
Backup data → C:\ProgramData\ToastPOSManager\backups\pre-update-<v>-<timestamp>\
  │  config/local-config.json
  │  config/machine-identity.json
  │  runtime/agent-heartbeat.json
  │  db/sync-ledger.db
  │  db/qb-agent.db
  │
  ▼
Stop background agent (schtasks /End)
  │
  ▼
Run installer /VERYSILENT /NORESTART
  │
  ▼
Start background agent (schtasks /Run)
  │
  ▼
Report UPDATE_COMPLETED to Mi-core
```

---

## Data Separation

| Path | Contents | Touched by Installer? |
|---|---|---|
| `C:\Program Files\ToastPOSManager\` | App binaries, version.json | ✅ Updated |
| `C:\ProgramData\ToastPOSManager\config\` | local-config.json, machine-identity.json | ❌ NEVER |
| `C:\ProgramData\ToastPOSManager\runtime\` | Agent state, outbox | ❌ NEVER |
| `C:\ProgramData\ToastPOSManager\logs\` | QB activity logs | ❌ NEVER |
| `C:\ProgramData\ToastPOSManager\db\` | SQLite databases | ❌ NEVER |
| `C:\ProgramData\ToastPOSManager\backups\` | Pre-update snapshots | ❌ NEVER |
| `C:\ProgramData\ToastPOSManager\updates\` | Downloaded installers | ✅ Written by downloader |

---

## Version Manifest Format

```json
{
  "app": "integration-system",
  "channel": "stable",
  "version": "1.3.0",
  "build": "20260609.01",
  "published_at": "2026-06-09T09:00:00Z",
  "min_supported_version": "1.0.0",
  "download_url": "http://<MI_CORE_URL>/api/integration-agent/downloads/1.3.0/ToastPOSManagerSetup-1.3.0.exe",
  "sha256": "FILL_IN_AFTER_BUILD",
  "size_bytes": 85234123,
  "release_notes": ["Fixed QB multi-file sync", "Added Mi-core reporting"],
  "requires_restart": true,
  "rollback_supported": true
}
```

---

## Update Event Types

| Event | Trigger |
|---|---|
| `UPDATE_CHECKED` | Every check (scheduled or manual) |
| `UPDATE_AVAILABLE` | New version found |
| `UPDATE_DOWNLOADED` | Download complete, checksum OK |
| `UPDATE_INSTALL_STARTED` | About to run installer |
| `UPDATE_COMPLETED` | Installer succeeded, agent restarted |
| `UPDATE_FAILED` | Any step failed |
| `UPDATE_ROLLBACK_STARTED` | Rollback initiated |
| `UPDATE_ROLLBACK_COMPLETED` | Data restored from backup |

---

## Files Created

### Python (integration-system)
| File | Purpose |
|---|---|
| `desktop-app/version.json` | Current installed version |
| `desktop-app/services/update_client.py` | Version check, semver comparison |
| `desktop-app/services/update_downloader.py` | Download + SHA-256 validation |
| `desktop-app/services/update_backup_service.py` | Pre-update data snapshot |
| `desktop-app/services/update_installer.py` | Install orchestration |
| `desktop-app/services/update_rollback_service.py` | Data restore from backup |
| `desktop-app/services/update_scheduler.py` | 12h check scheduler |

### TypeScript (Mi-core)
| File | Purpose |
|---|---|
| `server/src/services/integrationAgentReleaseService.ts` | Release manifest storage + event DB |
| `server/src/routes/integrationAgentReleases.ts` | REST API routes |

### Inno Setup
| Change | Detail |
|---|---|
| Version → 1.2.0 | OutputBaseFilename = `ToastPOSManagerSetup-1.2.0.exe` |
| Data dir → `C:\ProgramData\ToastPOSManager\` | Never deleted on install/uninstall |
| Silent install | `/VERYSILENT /NORESTART /LOG=...` supported |
| Agent stop/start | `schtasks /End` before, `schtasks /Run` after |
| `version.json` included | Bundled in install for update_client to read |
