# QB Multi-File 12H Sync Report
**Generated:** 2026-06-09

---

## New Services

| Service | File | Purpose |
|---|---|---|
| QB File Scanner | `services/qb_file_scanner.py` | Scans drives for .QBW/.QBM/.QBB |
| QB File Registry | `services/qb_file_registry.py` | CRUD for company_files in local-config.json |
| QB File Sync Runner | `services/qb_file_sync_runner.py` | Syncs a single file (read-only, thread-safe) |
| Multi-File Scheduler | `services/qb_multi_file_sync_scheduler.py` | 12h cycle across all enabled files |

---

## Scheduler Behavior

```
Every 12 hours (± jitter):
  cycle_id = uuid4()
  for each enabled QB file:
    run_file_sync(entry)      # blocks — never concurrent
    if status == PASS:        pass_count++
    elif QB_PASSWORD_REQUIRED: warning_count++
    elif SKIPPED:              warning_count++
    else:                      error_count++
    continue to next file regardless of failure

  save state → runtime/qb-file-sync-state.json
  report cycle → Mi-core POST /api/qb-agent/sync-cycle
```

## Status Codes

| Status | Meaning |
|---|---|
| `PASS` | Sync completed, data sent to Mi-core |
| `PASS_WITH_WARNINGS` | Completed with warnings |
| `QB_BLOCKED` | File not found or COM error |
| `QB_PASSWORD_REQUIRED` | QB requires password/manual input |
| `SKIPPED` | QB was busy or another sync was running |
| `ERROR` | Unexpected exception |

---

## State File

```
runtime/qb-file-sync-state.json
```

```json
{
  "last_cycle_started_at": "2026-06-09T09:00:00Z",
  "last_cycle_finished_at": "2026-06-09T09:20:00Z",
  "next_cycle_at": "2026-06-09T21:03:42Z",
  "files": {
    "bakudan-bandera": {
      "last_status": "PASS",
      "last_synced_at": "2026-06-09T09:05:00Z",
      "last_error": ""
    }
  }
}
```

---

## Config Schema (local-config.json additions)

```json
{
  "quickbooks_files": {
    "scan_enabled": true,
    "scan_roots": ["C:\\Users\\...\\Documents", "D:\\", "E:\\"],
    "company_files": [
      {
        "file_id": "bakudan-bandera",
        "store_code": "bandera",
        "company_file_path": "D:\\QB\\Bandera.qbw",
        "expected_company_name": "Bakudan Bandera",
        "enabled": true,
        "last_status": "PASS",
        "last_synced_at": "2026-06-09T09:05:00Z",
        "next_sync_at": "2026-06-09T21:05:00Z"
      }
    ]
  },
  "sync_schedule": {
    "enabled": true,
    "interval_hours": 12,
    "run_on_startup": true,
    "jitter_minutes": 10
  }
}
```

---

## Safety Guarantees

- ✅ Never runs two file syncs concurrently (`threading.Lock`)
- ✅ Read-only QB access via QBXMLRP2 COM
- ✅ One file failure does not stop others (try/except per file)
- ✅ Blocked/password files marked and skipped cleanly
- ✅ State persisted so scheduler survives restarts

---

## Remote Commands Supported

```
SCAN_QB_FILES            — trigger file scan
RUN_12H_SYNC_NOW         — run full cycle immediately
RUN_FILE_SYNC_NOW        — sync specific file_id
ENABLE_QB_FILE           — enable a file
DISABLE_QB_FILE          — disable a file
UPDATE_FILE_STORE_MAPPING — update store_code mapping
OPEN_QB_FILE             — open QB to specific file
TEST_QB_FILE_CONNECTION  — test COM connection to file
```
