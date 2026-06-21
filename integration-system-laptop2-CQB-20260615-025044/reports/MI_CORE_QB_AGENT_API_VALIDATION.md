# Mi-Core QB Agent API Validation Report
**Generated:** 2026-06-09  
**File:** `E:\Project\Master\mi-core\server\src\routes\qb-agent.ts`

---

## Route Inventory

| Route | Method | Exists | Auth Required | Notes |
|---|---|---|---|---|
| `/api/qb-agent/ping` | GET | ✅ | Bearer token | Returns `{ok:true, server:"mi-core"}` |
| `/api/qb-agent/register` | POST | ✅ | Bearer token | Upserts machine record |
| `/api/qb-agent/heartbeat` | POST | ✅ | Bearer token | Updates machine `last_seen_at` |
| `/api/qb-agent/event` | POST | ✅ | Bearer token | Stores agent event |
| `/api/qb-agent/activity-log-result` | POST | ✅ | Bearer token | Stores QB activity log result |
| `/api/qb-agent/timeline-result` | POST | ✅ | Bearer token | Stores QB timeline data |
| `/api/qb-agent/sync-result` | POST | ✅ | Bearer token | Stores sync outcome |
| `/api/qb-agent/error` | POST | ✅ | Bearer token | Stores error report |
| `/api/qb-agent/qb-files` | POST | ✅ | Bearer token | Upserts QB file registry |
| `/api/qb-agent/sync-cycle` | POST | ✅ | Bearer token | Stores 12h cycle record |
| `/api/qb-agent/machines` | GET | ✅ | Bearer token | Lists all registered machines |
| `/api/qb-agent/status` | GET | ✅ | Bearer token | Summary: machines, commands, errors |
| `/api/qb-agent/qb-files` | GET | ✅ | Bearer token | List QB files (optional ?machine_id=) |
| `/api/qb-agent/sync-cycles` | GET | ✅ | Bearer token | List sync cycles |
| `/api/qb-agent/commands` | GET | ✅ | Bearer token | Poll pending commands for machine_id |
| `/api/qb-agent/commands` | POST | ✅ | Bearer token | Create new command |
| `/api/qb-agent/commands/:id/ack` | POST | ✅ | Bearer token | Acknowledge command |
| `/api/qb-agent/commands/:id/result` | POST | ✅ | Bearer token | Post command result |
| `/api/qb-agent/recent-activity` | GET | ✅ | Bearer token | Recent logs/timelines/errors |

---

## Auth Mechanism

```
Authorization: Bearer <MI_CORE_API_KEY>
```

- If `MI_CORE_API_KEY` env var is not set on the server → routes are **open** (dev mode)
- Also accepts legacy `AGENT_CODING_API_KEY` env var

---

## Database Schema (qb-agent.db)

Tables created at startup:
- `machines` — registered QB agent PCs
- `heartbeats` — periodic heartbeat log
- `events` — agent events
- `activity_log_results` — QB activity log data
- `timeline_results` — QB timeline data
- `sync_results` — sync outcomes
- `error_reports` — error log
- `qb_files` — QB company file registry per machine
- `sync_cycles` — 12h sync cycle records
- `commands` — remote command queue

---

## Sample Payloads

### POST /api/qb-agent/register
```json
{
  "machine_id": "qb-laptop-01",
  "machine_name": "QB Laptop",
  "store_code": "bandera",
  "store_name": "Bakudan Bandera",
  "app_version": "3.0.0",
  "os_version": "Windows 11 Pro"
}
```

### POST /api/qb-agent/heartbeat
```json
{
  "machine_id": "qb-laptop-01",
  "store_code": "bandera",
  "status": "ok",
  "qb_open": true,
  "qb_company": "Bakudan Bandera"
}
```

### POST /api/qb-agent/commands (create)
```json
{
  "machine_id": "qb-laptop-01",
  "command_type": "RUN_FILE_SYNC_NOW",
  "payload": {"file_id": "bandera", "force": true}
}
```

---

## Status
All 19 routes implemented. DB schema validated at TypeScript compile level.
Mi-core must be built (`npm run build`) before deployment.
