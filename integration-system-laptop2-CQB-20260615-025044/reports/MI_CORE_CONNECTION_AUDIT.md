# Mi-Core Connection Audit
**Generated:** 2026-06-09

---

## Mi-core Server — QB Agent Endpoints

**Location:** `E:\Project\Master\mi-core\server\src\routes\qb-agent.ts`
**Registered:** `app.use('/api/qb-agent', qbAgentRouter)` in `index.ts`

| Route | Method | Verified |
|---|---|---|
| `/api/qb-agent/ping` | GET | ✅ |
| `/api/qb-agent/register` | POST | ✅ |
| `/api/qb-agent/heartbeat` | POST | ✅ |
| `/api/qb-agent/event` | POST | ✅ |
| `/api/qb-agent/activity-log-result` | POST | ✅ |
| `/api/qb-agent/timeline-result` | POST | ✅ |
| `/api/qb-agent/sync-result` | POST | ✅ |
| `/api/qb-agent/error` | POST | ✅ |
| `/api/qb-agent/qb-files` | GET + POST | ✅ |
| `/api/qb-agent/sync-cycle` | POST | ✅ |
| `/api/qb-agent/machines` | GET | ✅ |
| `/api/qb-agent/status` | GET | ✅ |
| `/api/qb-agent/sync-cycles` | GET | ✅ |
| `/api/qb-agent/commands` | GET + POST | ✅ |
| `/api/qb-agent/commands/:id/ack` | POST | ✅ |
| `/api/qb-agent/commands/:id/result` | POST | ✅ |
| `/api/qb-agent/recent-activity` | GET | ✅ |

**Total routes: 19** — all implemented in this session.

---

## Integration-System — Client Files

| File | Status |
|---|---|
| `services/mi_core_client.py` | ✅ EXISTS — canonical client |
| `services/central_control_client.py` | ✅ EXISTS — compat shim |
| `services/remote_command_client.py` | ✅ EXISTS — command poller |
| `services/reporting_outbox.py` | ✅ EXISTS — offline queue |
| `services/reporting_event_bus.py` | ✅ EXISTS — event bus |
| `services/qb_multi_file_sync_scheduler.py` | ✅ EXISTS — 12h scheduler |
| `services/qb_file_scanner.py` | ✅ EXISTS — file scanner |
| `services/qb_file_registry.py` | ✅ EXISTS — file registry |

---

## Config Connection

```json
// local-config.json
{
  "mi_core": {
    "enabled": true,
    "base_url": "http://<CEO_PC_TAILSCALE_IP>:4001",
    "api_key_env": "MI_CORE_API_KEY",
    "machine_id": "qb-laptop-01",
    "heartbeat_seconds": 60,
    "poll_commands_seconds": 15,
    "timeout_seconds": 15
  }
}
```

```
.env file (alongside EXE):
MI_CORE_API_KEY=<your-api-key>
```

---

## Dashboard Route

Mi-core UI is served as static files from `../ui/`. The `/qb-agent` dashboard page requires a frontend HTML/JS page to be built in `mi-core/ui/`. 

**Status:** Backend routes ✅ COMPLETE. Frontend dashboard page ⚠️ NOT YET BUILT.

---

## Google Sheet Integration

**Status:** ⚠️ NOT YET IMPLEMENTED in Mi-core.

Mi-core receives all QB data via `/api/qb-agent/*` and stores in SQLite (`data/qb-agent.db`).
The next step is to implement a Google Sheets writer service in Mi-core that:
1. Receives the stored data
2. Writes to the correct Google Sheet tabs

Required tabs:
- `QB Files`
- `12H Sync Cycles`
- `Daily Activity Log`
- `Activity Timeline`
- `Errors & Warnings`
- `Remote Commands`

---

## Remote Commands Available

From `integration-system`:

| Command | Handler |
|---|---|
| `OPEN_QB_NOW` | `_handle_open_qb` |
| `TEST_QB_CONNECTION` | `_handle_test_connection` |
| `GENERATE_ACTIVITY_LOG_NOW` | `_handle_activity_log` |
| `GENERATE_TIMELINE_NOW` | `_handle_timeline` |
| `RUN_AUTO_SYNC_NOW` | `_handle_auto_sync` |
| `RESTART_AGENT` | `_handle_restart_agent` |
| `SCAN_QB_FILES` | `_handle_scan_qb_files` ← NEW |
| `RUN_12H_SYNC_NOW` | `_handle_run_12h_sync` ← NEW |
| `RUN_FILE_SYNC_NOW` | `_handle_run_file_sync` ← NEW |
| `ENABLE_QB_FILE` | `_handle_enable_qb_file` ← NEW |
| `DISABLE_QB_FILE` | `_handle_disable_qb_file` ← NEW |
| `TEST_QB_FILE_CONNECTION` | `_handle_test_file_connection` ← NEW |
