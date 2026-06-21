# Mi-Core Discovery Report
**Generated:** 2026-06-09  
**Status:** COMPLETE

---

## Mi-core Location

| Field | Value |
|---|---|
| **Canonical Mi-core Path** | `E:\Project\Master\mi-core` |
| **Old Agent-Coding Path** | `E:\Project\Master\Bakudan\Agent-Coding` |
| **Migration Status** | Agent-Coding is a SEPARATE legacy project. Mi-core is a new canonical project. Code has NOT been auto-merged — integration-system now points to mi-core via config key `mi_core`. |
| **Mi-core Branch** | `feature/option-b-form-photo-workflow` |
| **Mi-core Latest Commit** | `e06e26c` — Add: CEO double-click launchers |
| **Integration-System Branch** | `main` |

---

## Mi-core Server Details

| Field | Value |
|---|---|
| **Package Name** | `mi-core-server` |
| **Default Port** | `4001` (env: `MI_PORT`) |
| **Framework** | Express + TypeScript |
| **DB** | `better-sqlite3` (local SQLite per feature area) |
| **Dashboard Route** | `/` (static UI at `../ui`) |
| **QB Agent API** | `/api/qb-agent/*` — **ADDED in this session** |

---

## QB Agent API Routes (newly added to Mi-core)

```
GET  /api/qb-agent/ping
POST /api/qb-agent/register
POST /api/qb-agent/heartbeat
POST /api/qb-agent/event
POST /api/qb-agent/activity-log-result
POST /api/qb-agent/timeline-result
POST /api/qb-agent/sync-result
POST /api/qb-agent/error
POST /api/qb-agent/qb-files
POST /api/qb-agent/sync-cycle
GET  /api/qb-agent/machines
GET  /api/qb-agent/status
GET  /api/qb-agent/qb-files
GET  /api/qb-agent/sync-cycles
GET  /api/qb-agent/commands?machine_id=
POST /api/qb-agent/commands
POST /api/qb-agent/commands/:command_id/ack
POST /api/qb-agent/commands/:command_id/result
GET  /api/qb-agent/recent-activity
```

---

## Config Key Mapping

| Old Key | New Key | Status |
|---|---|---|
| `agent_coding` | `mi_core` | Deprecated but still works (warning logged) |
| `AGENT_CODING_API_KEY` | `MI_CORE_API_KEY` | Both accepted, `MI_CORE_API_KEY` preferred |

---

## Google Sheet Reporting

- Mode: `centralized` via Mi-core (not written directly from QB agent)
- Integration-system reports to Mi-core via `/api/qb-agent/*` endpoints
- Mi-core is responsible for Google Sheet writes (not yet implemented in Mi-core — requires Mi-core Google Sheets service)

---

## Files Created / Modified

| File | Action |
|---|---|
| `E:/Project/Master/mi-core/server/src/routes/qb-agent.ts` | **CREATED** — full QB agent routes + SQLite schema |
| `E:/Project/Master/mi-core/server/src/index.ts` | **MODIFIED** — registered `qbAgentRouter` |
| `desktop-app/services/mi_core_client.py` | **CREATED** — canonical Mi-core client |
| `desktop-app/services/central_control_client.py` | **CREATED** — compatibility shim |
| `desktop-app/services/machine_identity_service.py` | **MODIFIED** — `mi_core` key support + dual env var |
| `desktop-app/services/qb_file_scanner.py` | **CREATED** |
| `desktop-app/services/qb_file_registry.py` | **CREATED** |
| `desktop-app/services/qb_file_sync_runner.py` | **CREATED** |
| `desktop-app/services/qb_multi_file_sync_scheduler.py` | **CREATED** |
| `desktop-app/services/remote_command_client.py` | **MODIFIED** — added 8 new command types |
| `desktop-app/ui/first_run_wizard.py` | **CREATED** |
| `installer/ToastPOSManager.iss` | **CREATED** |
| `installer/build_installer.ps1` | **CREATED** |
