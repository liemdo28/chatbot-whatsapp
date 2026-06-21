# REAL APP WORKING VALIDATION
## Operator Validation Script — ToastPOSManager Background Agent

**Purpose:** Validate that ToastPOSManager really works on Windows with QB.

---

## System Information

```
Windows Version: _______________________________
QuickBooks Desktop Version: _____________________
Company File Path: ______________________________
Build Artifact Path: ___________________________
Validation Date: _______________________________
Operator: _____________________________________
```

---

## Phase 1: Build Verification

```powershell
# Build the EXE
cd desktop-app
.\build_release.ps1

# Verify EXE exists
dir dist\ToastPOSManager\ToastPOSManager.exe
```

- [ ] EXE built successfully: PASS/FAIL
- [ ] EXE runs without crash: PASS/FAIL

---

## Phase 2: Startup Task Registration

```powershell
# Install startup task
.\dist\ToastPOSManager\ToastPOSManager.exe --install-startup

# Verify task in Task Scheduler
schtasks /Query /TN "ToastPOSManagerBackgroundAgent" /FO LIST

# Uninstall to test
.\dist\ToastPOSManager\ToastPOSManager.exe --uninstall-startup
```

- [ ] Startup task installed: PASS/FAIL
- [ ] Startup task removed: PASS/FAIL

---

## Phase 3: Background Agent Heartbeat

```powershell
# Start background agent (in one terminal window)
.\dist\ToastPOSManager\ToastPOSManager.exe --background

# Wait 5 seconds, then check heartbeat
type runtime\agent-heartbeat.json

# In another terminal, check agent is running
tasklist | findstr ToastPOSManager
```

- [ ] Agent starts without crash: PASS/FAIL
- [ ] `runtime/agent-heartbeat.json` created: PASS/FAIL
- [ ] Heartbeat `status` = "AGENT_RUNNING": PASS/FAIL
- [ ] PID matches running process: PASS/FAIL

**Expected heartbeat:**
```json
{
  "status": "AGENT_RUNNING",
  "started_at": "2026-06-05T...",
  "last_heartbeat_at": "2026-06-05T...",
  "pid": 12345,
  "mode": "background",
  "qb_status": "QB_READY",
  "activity_log_status": "Done",
  "timeline_status": "Done",
  "auto_sync_status": "Off",
  "last_error": ""
}
```

---

## Phase 4: Single Instance Rule

```powershell
# Try to start a second agent (should fail)
.\dist\ToastPOSManager\ToastPOSManager.exe --background
```

- [ ] Second agent blocked: PASS/FAIL
- [ ] Error message shown: PASS/FAIL
- [ ] Only one agent process running: PASS/FAIL

---

## Phase 5: UI Opens While Agent Running

```powershell
# Open UI while background agent is running
.\dist\ToastPOSManager\ToastPOSManager.exe --ui

# Check taskbar - should see both processes
tasklist | findstr ToastPOSManager
```

- [ ] UI opens without error: PASS/FAIL
- [ ] Agent still running (check heartbeat): PASS/FAIL
- [ ] UI shows agent status: PASS/FAIL

---

## Phase 6: Close UI But Agent Keeps Running

```powershell
# Close the UI window (click X)
# Check that agent is STILL running
type runtime\agent-heartbeat.json
tasklist | findstr ToastPOSManager
```

- [ ] Agent still running after UI close: PASS/FAIL
- [ ] Heartbeat still updating: PASS/FAIL

---

## Phase 7: Reopen UI Reads Agent Status

```powershell
# Reopen UI
.\dist\ToastPOSManager\ToastPOSManager.exe --ui

# UI should detect and show agent status
# Look for "Agent Running" badge in UI
```

- [ ] UI detects running agent: PASS/FAIL
- [ ] UI shows current QB status: PASS/FAIL
- [ ] UI shows current log status: PASS/FAIL

---

## Phase 8: QuickBooks Connection (if QB available)

```powershell
# Configure QB in local-config.json:
# "quickbooks": {
#   "company_file": "D:\\QB\\Bakudan.qbw",
#   "expected_company_name": "Bakudan Ramen"
# }

# Check QB status in heartbeat
type runtime\agent-heartbeat.json
# qb_status should be "QB_READY"
```

- [ ] QB auto-opened: PASS/FAIL/SKIP
- [ ] QB company file connected: PASS/FAIL/SKIP
- [ ] QB status in heartbeat: PASS/FAIL/SKIP

---

## Phase 9: Activity Log Generated

```powershell
# Trigger activity log generation
# Write command: runtime/agent-commands/cmd-test.json
# {
#   "id": "cmd-test-001",
#   "type": "GENERATE_ACTIVITY_LOG_NOW",
#   "status": "PENDING"
# }

# Wait 10 seconds, check result
type runtime\agent-command-results\cmd-test-001.json

# Check log files
dir logs\qb-activity\ /s /b
```

- [ ] Command file processed: PASS/FAIL/SKIP
- [ ] Log file created: PASS/FAIL/SKIP
- [ ] JSON log valid: PASS/FAIL/SKIP
- [ ] MD log created: PASS/FAIL/SKIP

---

## Phase 10: Timeline Generated

```powershell
# Trigger timeline generation
# Write command: runtime/agent-commands/cmd-timeline.json
# {
#   "id": "cmd-timeline-001",
#   "type": "GENERATE_TIMELINE_NOW",
#   "status": "PENDING"
# }

# Check timeline files
dir logs\qb-activity\ /s /b | findstr timeline
```

- [ ] Timeline JSON created: PASS/FAIL/SKIP
- [ ] Timeline MD created: PASS/FAIL/SKIP

---

## Phase 11: No Duplicate Logs

```powershell
# Run activity log twice
# Second run should skip (deduplication)
```

- [ ] Duplicate run skipped: PASS/FAIL/SKIP

---

## Phase 12: Stop Agent Cleanly

```powershell
# Write STOP_AGENT command
# Check heartbeat stops updating
# Check process exits
```

- [ ] Agent stops cleanly: PASS/FAIL
- [ ] Lock file removed: PASS/FAIL

---

## Evidence Collection

Capture these screenshots/videos:

```
reports/evidence/real-app-working/
  01-built-exe.png          - EXE in dist folder
  02-task-scheduler.png    - Task Scheduler showing ToastPOSManager task
  03-agent-heartbeat-json.png - heartbeat.json content
  04-ui-agent-running.png  - UI showing agent running
  05-qb-open-company-file.png - QB open with correct company (if available)
  06-activity-log-json.png - activity log JSON file
  07-activity-log-md.png   - activity log Markdown file
  08-timeline-json.png     - timeline JSON file
  09-timeline-md.png       - timeline Markdown file
  10-close-ui-agent-still-running.mp4 - video of closing UI while agent runs
```

---

## Final Verdict

```
[ ] FULL PASS — All items passed
[ ] PASS WITH WARNINGS — Some items skipped or minor warnings
[ ] FAIL — Critical items failed

Details:
__________________________________________________________________
__________________________________________________________________
```

---

## Sign-off

Operator Name: ___________________
Date: ___________________
Signature: ___________________