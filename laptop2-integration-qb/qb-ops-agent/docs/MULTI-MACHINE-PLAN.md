# Multi-Machine Plan

## Overview

Agent OS is designed to manage multiple `qb-ops-agent` instances across different Windows machines, each potentially running different QuickBooks company files.

## Machine Registry

Each machine is uniquely identified by `machine_id` (UUID v5 of hostname + hardware ID). The registry in Agent OS stores:

```json
{
  "machine_id": "a1b2c3d4-...",
  "hostname": "qb-pc-office",
  "windows_username": "liemdo",
  "os_version": "Windows_NT 10.0",
  "ip_address": "192.168.1.100",
  "agent_version": "1.0.0",
  "quickbooks_version": "QuickBooks 2024",
  "registered_at": "2026-06-02T00:00:00Z",
  "last_seen_at": "2026-06-02T12:00:00Z",
  "status": "online"
}
```

## Company File Registry

Each machine reports its own configured company files:

```json
{
  "company_file_id": "e5f6g7h8-...",
  "company_name": "Bakudan Ramen Co.",
  "company_file_path": "C:\\QB\\BakudanRamen.QBW",
  "machine_id": "a1b2c3d4-...",
  "status": "configured",
  "assigned_store": "Main Store",
  "assigned_department": "Accounting",
  "last_opened_at": "2026-06-02T08:00:00Z",
  "last_checked_at": "2026-06-02T12:00:00Z"
}
```

## Heartbeat Protocol

Each machine sends heartbeat every 60s:
- If Agent OS receives no heartbeat from a `machine_id` for 3 intervals → mark `offline`
- Dashboard shows machine online/offline badge
- Offline machines trigger alert on dashboard

## Duplicate Machine Name Handling

Hostname collision (e.g., two machines both named `OFFICE-PC`) is resolved by:
1. `machine_id` — guaranteed unique (includes hardware ID)
2. Dashboard shows full machine details (hostname + IP + username) for disambiguation

## Example Multi-Machine Setup

| Machine | Hostname | QB Company Files |
|---|---|---|
| Machine A | qb-pc-office | BakudanRamen.QBW |
| Machine B | qb-pc-manager | ManagerReports.QBW |
| Machine C | qb-pc-backoffice | BackOffice.QBW |

Each machine runs its own `qb-ops-agent` instance with the same codebase but different `.env` config (same API URLs, different optional overrides).

## Startup on Multiple Machines

1. Copy project folder to each machine
2. Run `install-windows-service.ps1` on each machine
3. Each instance registers independently with Agent OS
4. CEO sees all machines in dashboard Accounting Ops → QB Machines
