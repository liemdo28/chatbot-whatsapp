# Scope Separation Audit
**Generated:** 2026-06-09

---

## Module Classification

### A. QB WRITE / IMPORT MODULE

> **Feature flag:** `qb_write_sync_enabled` — **DEFAULT: OFF**

These files perform QBXML write operations (AddRq, ModRq, DelRq).
They import Sales Receipts, expenses, and Toast report data INTO QuickBooks.
They are **DISABLED by default** on fresh install.

| File | Purpose |
|---|---|
| `desktop-app/qb_sync.py` | Core QB write sync — SalesReceiptAddRq, CustomerAddRq, ItemServiceAddRq |
| `desktop-app/qb_client.py` | QB COM client — delete_transaction, TxnDelRq, low-level QBXML send |
| `desktop-app/services/qb_sync_service.py` | Orchestrates sync run for a date range + store list |
| `desktop-app/services/qb_sync_preview_service.py` | Preview before write (dry-run safety gate) |
| `desktop-app/services/sync_safety_service.py` | Safety checks before allowing write sync |
| `desktop-app/services/consolidated_sync_gate.py` | Gate that prevents double-write |
| `desktop-app/services/download_reports_service.py` | Downloads Toast/marketplace CSVs for import |
| `desktop-app/services/auto_report_sync_scheduler.py` | Schedules auto-sync write operations |

---

### B. QB READ-ONLY LOG MODULE

> **Feature flag:** `qb_read_only_activity_log_enabled` — **DEFAULT: ON**

These files query QuickBooks for activity data using QBXML QueryRq only.
They **NEVER write, modify, or delete** QB data.

| File | Purpose |
|---|---|
| `desktop-app/services/qb_activity_log_service.py` | Main log generator — connects QB, runs all read-only queries |
| `desktop-app/services/qb_activity_queries.py` | QBXML QueryRq wrappers: SalesReceiptQueryRq, InvoiceQueryRq, DepositQueryRq, etc. |
| `desktop-app/services/qb_activity_timeline_queries.py` | Timeline event queries |
| `desktop-app/services/qb_activity_timeline_service.py` | Timeline generator |
| `desktop-app/services/qb_activity_log_scheduler.py` | Schedules daily activity log runs |
| `desktop-app/services/qb_activity_timeline_scheduler.py` | Schedules daily timeline runs |
| `desktop-app/services/qb_activity_history_store.py` | Local SQLite store for log history |
| `desktop-app/services/qb_file_scanner.py` | Scans drives for .QBW/.QBM/.QBB (no QB interaction) |
| `desktop-app/services/qb_file_registry.py` | Maintains list of known QB files (no QB interaction) |
| `desktop-app/services/qb_file_sync_runner.py` | Per-file read-only sync (QBXMLRP2 COM, read-only session) |
| `desktop-app/services/qb_multi_file_sync_scheduler.py` | 12h scheduler across all QB files |
| `desktop-app/services/qb_startup_service.py` | Detects/opens QB application |

---

### C. REMOTE REPORTING MODULE

> **Feature flag:** `mi_core_reporting_enabled` — **DEFAULT: ON**

These files communicate with Mi-core. No QB writes.

| File | Purpose |
|---|---|
| `desktop-app/services/mi_core_client.py` | Canonical Mi-core HTTP client (NEW — preferred) |
| `desktop-app/services/central_control_client.py` | Compat shim re-exporting MiCoreClient |
| `desktop-app/services/agent_coding_client.py` | Legacy client (still works, will be deprecated) |
| `desktop-app/services/remote_command_client.py` | Polls Mi-core for commands, acks, executes |
| `desktop-app/services/remote_control_scheduler.py` | Orchestrates heartbeat + command polling |
| `desktop-app/services/reporting_outbox.py` | Offline queue — retries Mi-core calls when offline |
| `desktop-app/services/reporting_event_bus.py` | Internal event bus for reporting events |
| `desktop-app/services/machine_identity_service.py` | Machine ID, config loading, API key resolution |

---

### D. INSTALLER / BACKGROUND MODULE

| File | Purpose |
|---|---|
| `installer/ToastPOSManager.iss` | Inno Setup 6 installer script |
| `installer/build_installer.ps1` | Build script |
| `desktop-app/ui/first_run_wizard.py` | First-run Tk wizard |
| `desktop-app/services/windows_startup_service.py` | Installs/removes Windows startup task |
| `desktop-app/services/background_agent_service.py` | Background agent lifecycle manager |
| `desktop-app/services/app_single_instance.py` | Prevents duplicate app instances |
| `desktop-app/services/tray_service.py` | System tray icon + menu |
| `desktop-app/services/feature_flags.py` | Feature flag service (NEW) |

---

## Feature Flag Config (local-config.json)

```json
{
  "features": {
    "qb_write_sync_enabled": false,
    "qb_read_only_activity_log_enabled": true,
    "mi_core_reporting_enabled": true,
    "multi_file_12h_sync_enabled": true
  }
}
```

The QB write modules check `feature_flags.qb_write_sync_enabled()` before executing.
By default this returns `False`, making the app read-only on fresh install.
