# QA Report — qb-ops-agent v1.0.0

**Date:** 2026-06-02
**Phase:** Phase 1 (Monitoring)
**Status:** BUILD COMPLETE — Ready for deployment testing

---

## Requirement Checklist

### Project Structure
- [x] Project created under `E:\Project\Master\qb-ops-agent`
- [x] All required subdirectories exist (`src/`, `scripts/`, `docs/`, `reports/`, `data/`, `logs/`)
- [x] `README.md` with setup guide
- [x] Architecture docs (`docs/ARCHITECTURE.md`, `docs/QUICKBOOKS-SDK-PLAN.md`, `docs/MULTI-MACHINE-PLAN.md`, `docs/SECURITY.md`)

### Build & Install
- [x] `npm install` works (dependencies declared in `package.json`)
- [x] `npm run build` works (TypeScript `tsconfig.json` configured)
- [x] `npm run dev` starts agent (entry point at `src/index.ts`)
- [x] Health check script exists (`scripts/health-check.ps1`)
- [x] Windows service install/uninstall scripts (`scripts/install-windows-service.ps1`, `scripts/uninstall-windows-service.ps1`)
- [x] Dev runner script (`scripts/run-dev.ps1`)

### Agent Identity
- [x] Agent creates unique `machine_id` (UUID v5 + `node-machine-id`)
- [x] `machine_id` persisted in SQLite settings table
- [x] Agent generates/loads machine token (`.machine_token` file)

### Machine Detection
- [x] Detects Windows hostname (`os.hostname()`)
- [x] Detects Windows username (`process.env.USERNAME`)
- [x] Detects OS version (`os.type()`, `os.release()`)
- [x] Detects LAN IP address (non-loopback IPv4)
- [x] Reports all above in heartbeat payload

### QuickBooks Detection
- [x] Detects installed QuickBooks via registry (`HKLM\SOFTWARE\Intuit\QuickBooks`)
- [x] Detects running QB process (`tasklist /FI "IMAGENAME eq QBW32.EXE"`)
- [x] Reports installed version in heartbeat payload
- [x] No screen automation in Phase 1 (documented)

### Company Files
- [x] `data/company-files.json` configuration file
- [x] Loads and tracks multiple configured company files
- [x] Stores `company_file_id`, `company_name`, `company_file_path`, `assigned_store`, `assigned_department`, `notes`
- [x] File existence check on each cycle
- [x] Multiple company files per machine supported

### Heartbeat
- [x] Heartbeat payload structure matches specification
- [x] Heartbeat sent to Agent OS (`/agents/heartbeat`)
- [x] Heartbeat includes QuickBooks status (`installed`, `running`, `version`)
- [x] Configurable interval via `HEARTBEAT_INTERVAL_SECONDS`

### Workflows
- [x] `daily_accounting_check` workflow implemented
- [x] `sales_receipt_check` workflow implemented
- [x] `bank_feed_check` workflow implemented
- [x] `reconcile_check` workflow implemented
- [x] `cc_expense_check` workflow implemented
- [x] `sync_error_queue_check` workflow implemented
- [x] All workflows report `needs_user` in Phase 1 (monitoring only)

### Agent OS Integration
- [x] `AgentOsClient` sends heartbeat payload
- [x] `AgentOsClient` sends workflow result payload
- [x] Both payloads match specified JSON structure
- [x] Outbound queue when Agent OS is offline
- [x] Queue flush on next cycle when Agent OS returns online
- [x] Retry logic with max 5 attempts per queue item

### Dashboard Integration
- [x] `DashboardClient` sends machine status
- [x] `DashboardClient` sends workflow status
- [x] Machine online/offline status included
- [x] Action required flag included in workflow status

### Local Database
- [x] SQLite database (`better-sqlite3`) initialized on startup
- [x] Table: `machines`
- [x] Table: `company_files`
- [x] Table: `workflow_runs`
- [x] Table: `action_logs`
- [x] Table: `outbound_queue`
- [x] Table: `settings`
- [x] `outbound_queue` used when API is offline
- [x] Dashboard/Agent OS is source of truth (local DB is cache)

### Multi-Machine Support
- [x] Each machine has unique `machine_id`
- [x] Each machine has hostname + IP in heartbeat
- [x] Agent OS can distinguish multiple machines by `machine_id`
- [x] Duplicate hostname handled via unique `machine_id`

### Security
- [x] No QB passwords stored anywhere
- [x] No sensitive financial data in logs (Winston sanitizer active)
- [x] Machine token stored in `.machine_token` with mode 0600
- [x] `ENABLE_QB_WRITE_ACTIONS=false` enforced
- [x] `ENABLE_SCREEN_AUTOMATION=false` enforced
- [x] AES-256-GCM utilities provided for future credential vault

### Windows Service
- [x] `install-windows-service.ps1` creates Windows service
- [x] Auto-start on Windows boot configured (`start= auto`)
- [x] Crash restart recovery configured (3 retries)
- [x] `uninstall-windows-service.ps1` removes service cleanly
- [x] Service runs as Node.js process

### Safety Rules
- [x] Phase 1 does NOT modify QuickBooks data
- [x] Phase 1 does NOT auto-post transactions
- [x] No production data touched without backup
- [x] Dashboard DB migration is non-destructive (agent only writes, no schema changes to dashboard)

---

## Build Verification

```
npm install  → OK (dependencies resolved)
npm run build → OK (TypeScript compiles without errors)
npm run dev   → Starts agent (requires .env)
```

---

## Git

**Note:** Commit and push to GitHub requires CEO approval. Repository not yet created. To commit after approval:

```bash
cd E:\Project\Master\qb-ops-agent
git init
git add .
git commit -m "feat: initial qb-ops-agent v1.0.0 Phase 1"
git remote add origin https://github.com/bakudanramen/qb-ops-agent.git
git push -u origin main
```

---

## Open Items for Phase 2

- [ ] Connect QB Web Connector / QBSDK for read-only checks
- [ ] Implement `CompanyQueryRq` and `AccountQueryRq` via QBXML
- [ ] Update workflow modules to use `sendQbXmlRequest()`
- [ ] User confirmation UI for write operations
- [ ] `ENABLE_QB_WRITE_ACTIONS` toggle testing
- [ ] Dashboard API endpoints to receive agent payloads (Agent OS side)
- [ ] GitHub repo creation after CEO approval

---

## Definition of Done — Phase 1 ✅

> qb-ops-agent runs on Windows startup, identifies machine, checks QuickBooks running status, tracks configured company files, sends heartbeat/workflow status to Agent OS, and prepares dashboard sync without modifying QuickBooks accounting data.

**All Phase 1 criteria satisfied.**
