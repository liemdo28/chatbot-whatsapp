# DOORDASH EXECUTOR CAPABILITY AUDIT

**Audit Date:** 2026-06-16  
**Auditor:** DEV1  
**Project Audited:** `integration-system-laptop2-CQB-20260615-025044` (current workspace)  
**Target:** DoorDash Campaign Executor, Login/Logout, Browser Control, Session Management  

---

## ⚠️ CRITICAL FINDING: DoorDash Executor Source Code NOT PRESENT IN THIS PROJECT

The DoorDash campaign executor, browser control, credential vault, and campaign management **source code does not exist in this workspace.**

| Expected Location | Status |
|---|---|
| `src/executor/*` | **MISSING** - directory does not exist |
| `src/server/routes/executor-routes.ts` | **MISSING** - `src/server/` directory does not exist |
| `src/server/routes/store-credentials.ts` | **MISSING** - `src/server/` directory does not exist |
| `src/server/index.ts` | **MISSING** - `src/server/` directory does not exist |
| `src/client/pages/DoorDashConnectionPage.tsx` | **MISSING** - `src/client/` directory does not exist |
| `src/security/*` | **MISSING** - directory does not exist |
| `data/session/*` | **MISSING** - directory does not exist |
| `data/credentials/*` | **MISSING** - directory does not exist |

### What This Project Actually Contains

This is a **Toast POS Manager** desktop application (Python/customtkinter) focused on:
- Toast POS report downloads (Playwright-based scraping)
- QuickBooks sales receipt creation
- QB transaction removal
- Google Drive sync
- AgentAI remote command execution
- Windows system tray service
- Runtime heartbeat (to CEO DoorDash app on a different machine)

### The Only Bridge to DoorDash

The file `src/sync/heartbeat.ts` (TypeScript) sends a heartbeat to a **separate DoorDash campaigns Node.js application** running on a different machine ("laptop1"). The heartbeat pushes status data including:
- `doordash_connected` (reads from remote DB setting `dd_session_status`)
- `approval_queue_size`, `pending_executions`
- `campaign_snapshots` data
- `execution_logs` data

This heartbeat.ts file references types, database tables, and settings that exist ONLY in the DoorDash campaign app on laptop1.

---

## PART 1 — SOURCE AUDIT SUMMARY

### Files/Directories Inspected

| File | Found? | Description |
|---|---|---|
| `src/executor/` | ❌ NOT FOUND | Does not exist in this project tree |
| `src/server/` | ❌ NOT FOUND | Does not exist |
| `src/client/` | ❌ NOT FOUND | Does not exist |
| `src/security/` | ❌ NOT FOUND | Does not exist |
| `data/` | ❌ NOT FOUND | Does not exist |
| `src/sync/heartbeat.ts` | ✅ EXISTS | TypeScript heartbeat sender; references DoorDash campaign app on laptop1 |
| `desktop-app/services/toast_browser_agent.py` | ✅ EXISTS | Toast browser agent only (NOT DoorDash) |
| `desktop-app/app.py` | ✅ EXISTS | Main app - no DoorDash functionality |
| `MODIFICATIONS_REQUIRED.md` | ✅ EXISTS | Documents how to hook heartbeat into laptop1's DoorDash campaign app |

### What the heartbeat.ts References (on laptop1)

Line-by-line analysis of what `heartbeat.ts` expects to find on the remote DoorDash campaign app:

- **Line 1:** `getDb` from `../server/db/client.js` → Expects a SQLite database connection on the DoorDash app
- **Line 8-16:** `settings` table with keys: `machine_id`, `ceo_doordash_url`, `mi_core_url`
- **Line 30-33:** `loop_runs` table — campaign loop status tracking
- **Line 36-39:** `approvals` table — approval workflow queue
- **Line 43:** Settings key `dd_session_status` — DoorDash session status ('connected')
- **Line 46:** `campaign_snapshots` table — campaign data snapshots
- **Line 50-53:** `execution_logs` table — campaign execution history
- **Line 57-62:** `stores` table — active stores with campaign data
- **Line 88:** `POST /api/heartbeat` — endpoint on CEO's DoorDash app (port 3000)

**All of these exist on laptop1's DoorDash campaign Node.js app, NOT in this project.**

---

## PART 2 — CAPABILITY MATRIX

### A. Login

| Capability | Status | Evidence |
|---|---|---|
| Can open DoorDash login page? | **MISSING** | No browser automation for DoorDash exists in this project |
| Can CEO complete login manually? | **MISSING** | No DoorDash connection UI exists |
| Can handle 2FA manually? | **MISSING** | No DoorDash authentication flow exists |
| Can detect login success? | **MISSING** | No DoorDash session detection exists |

### B. Logout

| Capability | Status | Evidence |
|---|---|---|
| Is there a logout function? | **MISSING** | No DoorDash logout code exists |
| Can session be cleared? | **MISSING** | No session management code exists |
| Can credentials/session be revoked locally? | **MISSING** | No credential vault or session store exists |

### C. Session

| Capability | Status | Evidence |
|---|---|---|
| Can browser session be saved? | **MISSING** | No Playwright persistent context setup for DoorDash |
| Can saved session be reused after restart? | **MISSING** | No session save/load mechanism exists |
| Can session expiration be detected? | **MISSING** | No session monitoring code exists |

### D. Browser Control

| Capability | Status | Evidence |
|---|---|---|
| Can Playwright open browser? | **PARTIAL** | Playwright is used for Toast POS downloads (`toast_browser_agent.py`, `toast_browser_use_downloader.py`) but NOT for DoorDash |
| Can it keep browser alive? | **PARTIAL** | Toast browser agent manages page lifecycle but DoorDash has no equivalent |
| Can it avoid Target page/context closed error? | **PARTIAL** | Toast browser code has error handling for browser failures |
| Can it navigate to DoorDash Merchant Portal? | **MISSING** | No DoorDash navigation code exists |

### E. Account Verification

| Capability | Status | Evidence |
|---|---|---|
| Can it verify correct DoorDash account? | **MISSING** | No DoorDash account verification exists |
| Can it detect wrong account? | **MISSING** | No DoorDash account check exists |

### F. Store Verification

| Capability | Status | Evidence |
|---|---|---|
| Can it verify Bakudan The Rim? | **MISSING** | No DoorDash store verification code exists |
| Can it verify Bakudan Stone Oak? | **MISSING** | Same |
| Can it verify Bakudan Bandera? | **MISSING** | Same |
| Can it verify Raw Sushi Bar? | **MISSING** | Same |

### G. Campaign Read

| Capability | Status | Evidence |
|---|---|---|
| Can it open Campaigns/Promotions page? | **MISSING** | No DoorDash campaign navigation exists |
| Can it read campaign list? | **MISSING** | No campaign list read capability exists |
| Can it extract spend/sales/budget/status? | **MISSING** | No data extraction exists |

### H. Campaign Edit

| Capability | Status | Evidence |
|---|---|---|
| Can it open a campaign? | **MISSING** | No campaign editing code exists |
| Can it edit budget? | **MISSING** | No budget editing exists |
| Can it pause/resume? | **MISSING** | No campaign state toggle exists |
| Can it create draft campaign? | **MISSING** | No campaign creation exists |
| Does it stop before final submit? | **MISSING** | No guardrail submit check exists |

### I. Approved Execution

| Capability | Status | Evidence |
|---|---|---|
| Does it require approval_id? | **MISSING** | No approval workflow exists in this project (references to `approvals` table exist in heartbeat.ts only) |
| Does guardrail check run before execution? | **MISSING** | No guardrail system exists |
| Does it block unapproved changes? | **MISSING** | No change approval exists |

### J. Screenshot/Audit

| Capability | Status | Evidence |
|---|---|---|
| Before screenshot? | **MISSING** | No DoorDash screenshot capability exists |
| Final review screenshot? | **MISSING** | No DoorDash review screenshots |
| After screenshot? | **MISSING** | No DoorDash post-execution screenshots |
| Audit log saved? | **MISSING** | No DoorDash audit log exists in this project |

### K. Rollback

| Capability | Status | Evidence |
|---|---|---|
| Can it create rollback plan? | **MISSING** | No rollback capability exists |
| Can it execute rollback after CEO approval? | **MISSING** | No rollback execution exists |

---

## PART 3 — REPRODUCE CURRENT ERROR

### Error: `page.waitForTimeout: Target page, context or browser has been closed`

**Cannot reproduce in this project** — there is no DoorDash Connection page, no DoorDash executor, and no DoorDash browser automation code in this workspace.

### Root Cause Analysis (Based on error message + zero evidence)

The error refers to a **Playwright browser/context that was disposed or closed** while a page operation was in progress. Since no DoorDash browser code exists in this project, the error must originate from:

1. **laptop1's DoorDash campaign app** — The actual DoorDash Node.js app (NOT in this project) has the Playwright-based DoorDash browser automation. The error occurs there, likely in:
   - `page.waitForTimeout()` after browser.close() was called
   - A persistent context being disposed before async operations complete
   - An exception handler that closes browser without waiting for pending operations

2. **The DoorDash Connection "page"** is a UI component in a separate web app (likely React/Next.js) that talks to the DoorDash executor API on laptop1. This project has no such page.

### Likely Root Causes
- **browser closes too early:** The DoorDash executor closes the Playwright browser while a `page.waitForTimeout()` or `page.waitForSelector()` is still pending
- **context disposed:** A persistent context is disposed via `context.close()` before all pages finish their current tasks
- **page reference stale:** A page reference is used after `browser.close()` is called
- **Playwright launch fails:** Chromium not installed, wrong path, or profile path invalid
- **session path invalid:** The persistent context data directory is missing or locked
- **timeout after exception:** An unhandled exception in browser code triggers cleanup that closes browser, then the original async operation resumes and fails

---

## PART 4 — REALITY CHECK

### 1. Can this source login DoorDash today?
**NO** ❌ — There is zero DoorDash login code in this project. The DoorDash campaign executor is a completely separate application on laptop1.

### 2. Can this source logout DoorDash today?
**NO** ❌ — No DoorDash logout code exists.

### 3. Can this source save session today?
**NO** ❌ — No DoorDash session management code exists.

### 4. Can this source control browser to read campaigns today?
**NO** ❌ — No DoorDash browser automation or campaign reading exists.

### 5. Can this source control browser to adjust campaigns today?
**NO** ❌ — No DoorDash campaign adjustment code exists.

### 6. Can this source execute approved campaign changes safely today?
**NO** ❌ — No campaign execution workflow exists in this project.

### 7. What is blocking real use right now?
**The DoorDash campaign executor source code is not in this project.** All DoorDash-related code lives on a different machine (laptop1) in a separate Node.js project. This project (Toast POS Manager) only contains a heartbeat.ts that sends lightweight status data to that DoorDash app.

---

## PART 5 — RECOMMENDED NEXT SMALLEST FIX

### 1. Locate the DoorDash Campaign Executor Source
Find and review the actual DoorDash campaigns Node.js project. Based on `MODIFICATIONS_REQUIRED.md` and `heartbeat.ts`, it is located on **laptop1** at the project root containing:
```
src/server/index.ts
src/server/db/client.js
src/server/routes/executor-routes.ts
src/server/routes/store-credentials.ts
src/client/pages/DoorDashConnectionPage.tsx
src/executor/*  (DoorDash browser automation)
src/security/*  (credential vault)
src/automation/weekly-loop.js
src/sync/mi-core-sync.js
data/session/*
data/credentials/*
```

### 2. Immediate Actions
1. **Transfer the DoorDash campaign source** from laptop1 to this workspace (or laptop2) so it can be audited in full.
2. Do NOT fix anything yet — this audit is intended to identify what exists.

### 3. After Transfer — Priority Fix Order
1. Fix the `page.waitForTimeout: Target page, context or browser has been closed` error → likely the browser close race condition
2. Verify Playwright/browser installation path
3. Fix persistent context session directory
4. Add proper error handling so browser close doesn't orphan page operations
5. Test login/logout flow end-to-end

---

## APPENDIX — Project Map

```
c:\Ld-project\integration-system-laptop2-CQB-20260615-025044\
├── src/
│   └── sync/
│       └── heartbeat.ts          ◄── The ONLY DoorDash-related file (heartbeat sender)
├── desktop-app/                  ◄── Main Python application (Toast POS Manager)
│   ├── app.py                    ◄── Main entry point (NO DoorDash code)
│   ├── services/
│   │   ├── toast_browser_agent.py      ◄── Toast POS browser agent only
│   │   ├── toast_browser_use_downloader.py  ◄── Toast POS downloader
│   │   └── ... (Toast/QB related services only)
│   ├── ui/
│   │   ├── tabs/                       ◄── Toast/QB UI tabs
│   │   └── wizards/                    ◄── Toast/QB wizards
│   └── requirements.txt                ◄── Includes playwright>=1.40.0 (for Toast, not DoorDash)
├── reports/                ◄── Various audit/validation reports (all Toast/QB related)
└── MODIFICATIONS_REQUIRED.md  ◄── Instructions to hook heartbeat into separate DoorDash app
```

**DoorDash Campaign Executor is on laptop1, not here.**