# CEO Two-Laptop + Mi-core Validation Report
**Generated:** 2026-06-09  
**Architecture:** CEO PC (Mi-core) ← Laptop 1 + Laptop 2 (QB Agents)

---

## Validation Checklist

| Checkpoint | Status | Notes |
|---|---|---|
| Mi-core running on CEO PC port 4001 | ✅ CODE READY | Binds `HOST=0.0.0.0` when `MOBILE_ACCESS=1` — already set in `.env` |
| Mi-core QB Agent API (19 routes) | ✅ BUILT | `/api/qb-agent/*` implemented and registered |
| Mi-core Google Sheets writer | ✅ BUILT | `googleSheetReporter.ts` + `qbAgentSheetSyncService.ts` — wired into all QB routes |
| Laptop 1 can ping Mi-core | ⚙️ REQUIRES DEPLOY | Config template at `config-templates/laptop-01-local-config.json` |
| Laptop 2 can ping Mi-core | ⚙️ REQUIRES DEPLOY | Config template at `config-templates/laptop-02-local-config.json` |
| Laptop 1 heartbeat received | ⚙️ REQUIRES DEPLOY | `mi_core_client.heartbeat()` implemented and tested |
| Laptop 2 heartbeat received | ⚙️ REQUIRES DEPLOY | Same client, different `machine_id` |
| Laptop 1 QB files detected | ⚙️ REQUIRES DEPLOY | `qb_file_scanner.py` built + `qb_file_registry.py` built |
| Laptop 2 QB files detected | ⚙️ REQUIRES DEPLOY | Same scanner |
| 12h scheduler enabled on both | ⚙️ REQUIRES DEPLOY | `qb_multi_file_sync_scheduler.py` built, default ON |
| Manual RUN_12H_SYNC_NOW on Laptop 1 | ⚙️ REQUIRES DEPLOY | Handler `_handle_run_12h_sync` wired |
| Manual RUN_12H_SYNC_NOW on Laptop 2 | ⚙️ REQUIRES DEPLOY | Same handler |
| Mi-core receives results from both | ⚙️ REQUIRES DEPLOY | Routes + DB schema ready |
| Google Sheet receives rows from both | ⚙️ REQUIRES CONFIG | Needs `GOOGLE_SHEET_ID` + auth in Mi-core `.env` |
| Remote command works per laptop | ⚙️ REQUIRES DEPLOY | Command queue + handlers built |
| qb-ops-agent NOT running | ⚙️ ACTION REQUIRED | See stop instructions below |
| Old Agent-Coding NOT used as central | ✅ CONFIRMED | integration-system uses `mi_core` config key only |

---

## Architecture Confirmed

```
CEO PC — E:\Project\Master\mi-core\server  (port 4001, HOST=0.0.0.0)
│
├── QB Agent API:  GET/POST /api/qb-agent/*
├── SQLite DB:     data/qb-agent.db
├── Google Sheets: fires on every heartbeat, activity-log, timeline, cycle, error
│
QB Laptop 1 (qb-laptop-01)
├── integration-system QB Agent
├── mi_core.base_url = http://<CEO_PC_TAILSCALE_IP>:4001
├── machine_id = qb-laptop-01
├── reads all .QBW files every 12h
└── pushes results → Mi-core → Google Sheet
│
QB Laptop 2 (qb-laptop-02)
└── same as Laptop 1, machine_id = qb-laptop-02
```

---

## Mi-core Network Binding

Current `.env` state:
```env
HOST=0.0.0.0
MOBILE_ACCESS=1
MI_PORT=4001
MI_CORE_API_KEY=        ← FILL THIS IN
GOOGLE_SHEET_ID=        ← FILL THIS IN
```

`index.ts` binding logic (confirmed):
```typescript
const HOST = process.env.HOST || (process.env.MOBILE_ACCESS === '1' ? '0.0.0.0' : '127.0.0.1');
server.listen(PORT, HOST, () => { ... });
```
✅ Will bind to `0.0.0.0:4001` — accessible from all Tailscale-connected laptops.

---

## Laptop Config Templates

| Laptop | Template | machine_id | store_code |
|---|---|---|---|
| Laptop 1 | `config-templates/laptop-01-local-config.json` | `qb-laptop-01` | `bandera` |
| Laptop 2 | `config-templates/laptop-02-local-config.json` | `qb-laptop-02` | `stone_oak` |

Both templates set:
- `qb_write_sync_enabled: false` — read-only by default
- `qb_read_only_activity_log_enabled: true`
- `mi_core_reporting_enabled: true`
- `multi_file_12h_sync_enabled: true`

---

## Google Sheets Writer

**Location:** `E:\Project\Master\mi-core\server\src\services\googleSheetReporter.ts`

Tabs created automatically on first write:

| Tab | Trigger |
|---|---|
| Dashboard | Every heartbeat |
| Machines | Every register |
| QB Files | After QB file scan |
| 12H Sync Cycles | After each cycle |
| Daily Activity Log | After each activity-log-result |
| Activity Timeline | After each timeline-result |
| Errors & Warnings | After each error report |
| Remote Commands | After each command update |
| Store Summary | After each activity-log-result |

All writes are **fire-and-forget** — a Sheet failure never breaks the agent report.

**Required setup:**
1. Set `GOOGLE_SHEET_ID=` in Mi-core `.env`
2. Set auth: `GOOGLE_SERVICE_ACCOUNT_JSON=` (preferred) or OAuth2 vars
3. Share spreadsheet with service account email

---

## qb-ops-agent Disable Instructions

Run on any QB laptop where `qb-ops-agent` is installed:
```powershell
# Stop Node process if running
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force

# Remove scheduled task if installed
schtasks /Delete /TN "qb-ops-agent" /F 2>$null
schtasks /Delete /TN "qb-ops-agent-startup" /F 2>$null

# Optionally move to archive (do NOT delete — CEO approval required)
# Move-Item "E:\Project\Master\qb-ops-agent" "E:\Project\Master\_archive\qb-ops-agent"
```

**Why:** `qb-ops-agent` targets port `3456` (old Agent OS), not Mi-core (port 4001). Running both creates split-brain monitoring.

---

## Remote Commands Available (CEO can issue from Mi-core)

```powershell
# Trigger 12h sync now on Laptop 1
curl -X POST http://localhost:4001/api/qb-agent/commands `
  -H "Authorization: Bearer $MI_CORE_API_KEY" `
  -H "Content-Type: application/json" `
  -d '{"machine_id":"qb-laptop-01","command_type":"RUN_12H_SYNC_NOW","payload":{}}'

# Sync specific file on Laptop 2
curl -X POST http://localhost:4001/api/qb-agent/commands `
  -H "Authorization: Bearer $MI_CORE_API_KEY" `
  -H "Content-Type: application/json" `
  -d '{"machine_id":"qb-laptop-02","command_type":"RUN_FILE_SYNC_NOW","payload":{"file_id":"bakudan-stoneoak","force":true}}'

# Scan QB files on Laptop 1
curl -X POST http://localhost:4001/api/qb-agent/commands `
  -H "Authorization: Bearer $MI_CORE_API_KEY" `
  -H "Content-Type: application/json" `
  -d '{"machine_id":"qb-laptop-01","command_type":"SCAN_QB_FILES","payload":{}}'
```

Command lifecycle: `PENDING → ACKNOWLEDGED → RUNNING → COMPLETED / FAILED`

---

## Tests

```
430 passed in 25.72s (full test suite, excluding legacy desktop app unit tests)

Key new tests:
  test_project_scope_separation.py   10 pass
  test_qb_read_write_boundary.py     14 pass
  test_mi_core_connection.py          8 pass
  test_one_click_installer.py         8 pass
  test_mi_core_client.py              9 pass
  test_config_backward_compatibility  5 pass
  test_qb_file_scanner.py             7 pass
  test_qb_file_registry.py            6 pass
  test_qb_multi_file_sync_scheduler   4 pass
  test_qb_file_sync_runner.py         4 pass
  test_first_run_wizard_config.py     6 pass
  test_installer_config.py            7 pass
```

---

## Final Verdict

### `PASS WITH WARNINGS`

---

## Acceptance Criteria Status

| Criterion | Status |
|---|---|
| Mi-core is the only central server | ✅ Code + config confirmed |
| integration-system is the only QB Agent on laptops | ✅ Confirmed |
| Both laptops report to Mi-core | ✅ Config templates ready — REQUIRES DEPLOY to confirm live |
| Google Sheet writer works | ✅ BUILT — REQUIRES `GOOGLE_SHEET_ID` + auth config |
| 12h sync works | ✅ Scheduler, runner, registry all built and tested |
| Remote commands work | ✅ All handlers built + wired |
| qb-ops-agent disabled/archived | ⚠️ REQUIRES MANUAL STEP on each QB laptop |
| old Agent-Coding disabled/archived | ⚠️ CEO approval pending to move to `_archive/` |

---

## CEO Action Items (ordered)

| # | Action | Who | Status |
|---|---|---|---|
| 1 | Fill in `MI_CORE_API_KEY` in Mi-core `.env` | Dev/CEO | ⚠️ REQUIRED |
| 2 | Set `GOOGLE_SHEET_ID` + auth in Mi-core `.env` | Dev/CEO | ⚠️ REQUIRED |
| 3 | Run `npm run build` in `mi-core/server/` | Dev | ⚠️ REQUIRED |
| 4 | Deploy `integration-system` to Laptop 1 with `laptop-01-local-config.json` | Dev | ⚠️ REQUIRED |
| 5 | Deploy `integration-system` to Laptop 2 with `laptop-02-local-config.json` | Dev | ⚠️ REQUIRED |
| 6 | Stop/disable `qb-ops-agent` on each QB laptop | Dev | ⚠️ REQUIRED |
| 7 | Approve archive of `Agent-Coding` → `_archive/Agent-Coding` | CEO | Pending |
| 8 | Approve archive of `qb-ops-agent` → `_archive/qb-ops-agent` | CEO | Pending |
| 9 | Build installer EXE (`cd installer && .\build_installer.ps1`) | Dev | Optional |
| 10 | Build Mi-core QB Agent dashboard UI page | Dev | Future sprint |
