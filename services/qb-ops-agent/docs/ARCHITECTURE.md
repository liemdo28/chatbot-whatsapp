# Architecture — qb-ops-agent

## Overview

`qb-ops-agent` is a Windows-first Node.js/TypeScript agent that monitors QuickBooks Desktop installations, tracks configured company files, and reports status to **Agent OS** and **dashboard.bakudanramen.com**.

## Component Map

```
Windows QB Machine
  └── qb-ops-agent (Node.js service)
        ├── src/agent/         ← Identity, heartbeat, startup lifecycle
        ├── src/quickbooks/     ← QB detection, company file registry, QBXML stub
        ├── src/workflows/      ← Phase 1 monitoring workflows
        ├── src/api/            ← Agent OS + Dashboard HTTP clients
        ├── src/storage/        ← SQLite local cache, Winston logger
        └── src/security/        ← Token mgmt, AES-256-GCM encryption
              ↓
        Agent OS (http://127.0.0.1:3456/api)
              ↓
        dashboard.bakudanramen.com
              ↓
        CEO Dashboard
```

## Phase Strategy

### Phase 1 — Monitoring (current)
- Machine detection + heartbeat
- QuickBooks running/installed detection via registry + tasklist
- Company file registry (configured paths, file existence check)
- Workflow status reporting (all workflows return `needs_user` until SDK integrated)
- Outbound queue for offline Agent OS retry
- No data modification

### Phase 2 — Assisted Read-Only
- QuickBooks SDK / QBXML integration via Web Connector
- Run safe read-only queries (CompanyQuery, AccountQueryRq, etc.)
- User confirmation prompts before any write action
- `ENABLE_QB_WRITE_ACTIONS=false` enforced

### Phase 3 — Controlled Automation
- Requires explicit QA approval
- Never auto-post transactions without approved workflow
- All write actions logged to audit trail

## Machine Identity

Each agent instance generates a stable `machine_id` using:
1. `node-machine-id` for hardware uniqueness
2. `os.hostname()` for network identity
3. UUID v5 namespace for stable deterministic ID

This machine_id is persisted in SQLite and survives reinstalls.

## Data Flow

1. Agent boots → reads `.env` → generates/stores machine token
2. Heartbeat sent every 60s (configurable) to both Agent OS and Dashboard
3. Workflow cycle runs every 15 min (configurable) for all tracked company files
4. Results sent to Agent OS → Dashboard
5. If Agent OS unreachable → payloads queued locally → flushed on next cycle

## Local Database (SQLite)

All tables use `machine_id` as the join key. Agent OS remains source of truth for reporting; local DB is a read-through cache.

Tables: `machines`, `company_files`, `workflow_runs`, `action_logs`, `outbound_queue`, `settings`.

## Security Notes

- Machine token stored in `.machine_token` with mode 0o600
- No QB credentials stored in plain text
- Winston log sanitizer strips sensitive keys (`password`, `token`, `amount`, etc.)
- AES-256-GCM utilities provided for future credential vault integration
- Phase 1: no QB data ever read or written

## Multi-Machine Support

Each machine:
- Has a unique `machine_id`
- Reports its own set of company files
- Heartbeat includes `hostname`, `ip_address`, `windows_username`
- Agent OS dashboard deduplicates by `machine_id`
