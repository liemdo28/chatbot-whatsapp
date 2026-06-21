# CEO REAL WORKING BUILD REPORT
## ToastPOSManager — Background Agent + Real App Validation

**Date:** 2026-06-05  
**Phase:** CEO Directive — Make App Really Work + Background Windows Service + QuickBooks Log System  
**Status:** IN PROGRESS — Build artifacts created, tests written, awaiting operator validation

---

## Files Created

### New Services (Phase 2)

| File | Purpose |
|------|---------|
| `desktop-app/services/app_single_instance.py` | Single-instance lock + heartbeat system |
| `desktop-app/services/windows_startup_service.py` | Windows Task Scheduler integration |
| `desktop-app/services/tray_service.py` | System tray integration with pystray |
| `desktop-app/services/agent_command_queue.py` | UI↔Agent command queue communication |
| `desktop-app/services/background_agent_service.py` | Background agent orchestration |
| `desktop-app/background_agent.py` | Entry point for `--background` mode |

### Modified Files

| File | Change |
|------|--------|
| `desktop-app/launcher.py` | Added `--background`, `--install-startup`, `--uninstall-startup` handlers |
| `desktop-app/app.py` | Added system tray init, close behavior, agent status badge |
| `desktop-app/ToastPOSManager.spec` | Added background agent to hidden imports |
| `desktop-app/local-config.example.json` | Added `background_agent` block + `expected_company_name` |

### New Tests (Phase 10)

| File | Coverage |
|------|---------|
| `tests/test_app_single_instance.py` | Lock acquire/release, stale lock cleanup, heartbeat read/write |
| `tests/test_agent_command_queue.py` | Command write/read/complete/fail, supported commands list |
| `tests/test_background_agent_service.py` | Service start/stop, status dict, state constants, mock QB |
| `tests/test_windows_startup_service.py` | Install/uninstall, schtasks calls, XML generation |

---

## Configuration Added

### local-config.example.json — new `background_agent` block

```json
{
  "background_agent": {
    "enabled": true,
    "start_with_windows": true,
    "heartbeat_seconds": 60,
    "restart_on_crash": true
  }
}
```

### local-config.example.json — updated `quickbooks` block

```json
{
  "quickbooks": {
    "enabled": true,
    "auto_open_on_app_start": true,
    "auto_connect_company_file": true,
    "allow_company_switch": false,
    "startup_timeout_seconds": 120,
    "exe_path": "",
    "company_file": "",
    "expected_company_name": "Bakudan Ramen",
    "password_key": "pass1"
  }
}
```

---

## Background Agent Architecture

### Entry Points

```
ToastPOSManager.exe --ui          → Launch GUI (detect agent, observe mode)
ToastPOSManager.exe --background   → Launch headless agent
ToastPOSManager.exe --install-startup  → Install Windows Task Scheduler task
ToastPOSManager.exe --uninstall-startup → Remove scheduled task
```

### State Machine

```
AGENT_OFF → AGENT_STARTING → AGENT_RUNNING → AGENT_STOPPING → AGENT_STOPPED
                                            ↓
                                    QB_CLOSED / QB_OPENING / QB_CONNECTING / QB_READY / QB_WRONG_CO / QB_BLOCKED
                                            ↓
                            LOG_WAITING / LOG_RUNNING / LOG_DONE / LOG_FAILED
                                            ↓
                        TIMELINE_WAITING / TIMELINE_RUNNING / TIMELINE_DONE / TIMELINE_FAILED
                                            ↓
                                    AUTO_SYNC (Off / Waiting / Running / Done / Failed)
```

### Heartbeat File: `runtime/agent-heartbeat.json`

```json
{
  "status": "AGENT_RUNNING",
  "started_at": "2026-06-05T09:00:00Z",
  "last_heartbeat_at": "2026-06-05T09:05:00Z",
  "pid": 12345,
  "mode": "background",
  "qb_status": "QB_READY",
  "activity_log_status": "Done",
  "timeline_status": "Done",
  "auto_sync_status": "Off",
  "last_error": ""
}
```

### Lock File: `runtime/background-agent.lock`

```json
{
  "pid": 12345,
  "started_at": "2026-06-05T09:00:00Z",
  "mode": "background"
}
```

### Command Queue: `runtime/agent-commands/`

```
runtime/agent-commands/cmd-20260605-001.json   (PENDING → PROCESSING → COMPLETED)
runtime/agent-commands/cmd-20260605-002.json
runtime/agent-command-results/cmd-20260605-001.json  (result output)
```

### Supported Commands

| Command | Description |
|---------|-------------|
| `OPEN_QB_NOW` | Trigger QB startup service |
| `TEST_QB_CONNECTION` | Run QB connection test |
| `GENERATE_ACTIVITY_LOG_NOW` | Force activity log generation |
| `GENERATE_TIMELINE_NOW` | Force timeline generation |
| `RUN_AUTO_SYNC_NOW` | Trigger auto sync |
| `OPEN_LOG_FOLDER` | Open logs folder in Explorer |
| `STOP_AGENT` | Stop the background agent |
| `RESTART_AGENT` | Restart signal |

---

## Build Output

**Build command:**
```powershell
cd desktop-app
.\build_release.ps1
```

**Expected output:**
```
desktop-app/dist/ToastPOSManager/ToastPOSManager.exe
```

**EXE paths to test:**
```
desktop-app\dist\ToastPOSManager\ToastPOSManager.exe --ui
desktop-app\dist\ToastPOSManager\ToastPOSManager.exe --background
desktop-app\dist\ToastPOSManager\ToastPOSManager.exe --install-startup
desktop-app\dist\ToastPOSManager\ToastPOSManager.exe --uninstall-startup
```

---

## Test Output

**Run tests:**
```powershell
python -m pytest tests/test_app_single_instance.py tests/test_agent_command_queue.py tests/test_background_agent_service.py tests/test_windows_startup_service.py -v
```

**Expected:** All tests pass (or skip on non-Windows environments)

---

## Safety Audit (Phase 11)

**Audit command:**
```powershell
Select-String -Path .\desktop-app\services\qb_activity*.py,.\desktop-app\background_agent.py -Pattern "AddRq|ModRq|DelRq|SalesReceiptAdd|TxnDel|TxnMod|DepositAdd|JournalEntryAdd"
```

**Forbidden patterns:**
- `SalesReceiptAdd` — QB write operation
- `TxnDel` — QB write operation
- `TxnMod` — QB write operation
- `DepositAdd` — QB write operation
- `JournalEntryAdd` — QB write operation
- `*AddRq` — all QB Add request classes
- `*ModRq` — all QB Mod request classes
- `*DelRq` — all QB Del request classes

**Expected result:** No matches (all QB operations are read-only via query-type requests)

---

## Operator Validation Checklist (Phase 9)

```
[ ] Windows version — ________________
[ ] QuickBooks Desktop version — ________________
[ ] Company file path — ________________
[ ] Build artifact path — ________________
[ ] Startup task installed: PASS/FAIL
[ ] Background agent heartbeat: PASS/FAIL
[ ] UI opens while agent running: PASS/FAIL
[ ] Close UI but agent keeps running: PASS/FAIL
[ ] Reopen UI reads agent status: PASS/FAIL
[ ] QB auto-open: PASS/FAIL
[ ] QB company connect: PASS/FAIL
[ ] Activity log generated: PASS/FAIL
[ ] Timeline generated: PASS/FAIL
[ ] No duplicate agent: PASS/FAIL
[ ] No duplicate logs: PASS/FAIL
```

### Evidence to capture

```
reports/evidence/real-app-working/
  01-built-exe.png
  02-task-scheduler.png
  03-agent-heartbeat-json.png
  04-ui-agent-running.png
  05-qb-open-company-file.png
  06-activity-log-json.png
  07-activity-log-md.png
  08-timeline-json.png
  09-timeline-md.png
  10-close-ui-agent-still-running.mp4
```

---

## Known Issues

1. **pystray** may not be installed in all environments. Tray service falls back gracefully.
2. **QuickBooks COM** requires QB Desktop to be installed and configured. Without QB, agent logs warnings but continues running.
3. **QB company file** paths must be configured in `local-config.json` for QB startup to work.
4. **Windows Task Scheduler** requires appropriate permissions. Run as admin if installation fails.
5. **Background agent** requires the `--background` flag to run headless. Without it, app launches GUI normally.

---

## Final Verdict

```
WAITING FOR REAL QB OPERATOR VALIDATION
```

**Cannot issue PASS or FULL PASS without:**
- Built EXE verified on real Windows machine
- QB Desktop available and configured
- Activity log generated with real data
- Timeline generated with real data
- Evidence screenshots/video captured

**Verdict will be upgraded to:**
- `PASS WITH WARNINGS` — when QB operator validates basic functionality
- `FULL PASS` — when all evidence is captured and all 10 validation items pass

---

## Next Steps for Operator

1. **Build the EXE:**
   ```powershell
   cd desktop-app
   .\build_release.ps1
   ```

2. **Configure local-config.json** with QB paths and company file.

3. **Test startup commands:**
   ```powershell
   .\dist\ToastPOSManager\ToastPOSManager.exe --install-startup
   .\dist\ToastPOSManager\ToastPOSManager.exe --background
   ```

4. **Verify heartbeat:**
   ```powershell
   type runtime\agent-heartbeat.json
   ```

5. **Open UI while agent running:**
   ```powershell
   .\dist\ToastPOSManager\ToastPOSManager.exe --ui
   ```

6. **Check activity logs:**
   ```powershell
   dir logs\qb-activity\ /s /b
   ```

7. **Capture evidence** in `reports/evidence/real-app-working/`

8. **Update this report** with validation results.