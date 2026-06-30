# qb-ops-agent

QuickBooks Desktop monitoring agent for Windows. Reports machine/QuickBooks status and workflow results to **Agent OS** and **dashboard.bakudanramen.com**.

---

## Setup

### 1. Prerequisites

- Windows 10/11
- Node.js 18+ ([download](https://nodejs.org))
- QuickBooks Desktop installed (optional, for QB detection)

### 2. Install Dependencies

```powershell
cd E:\Project\Master\qb-ops-agent
npm install
```

### 3. Configure Environment

```powershell
cp .env.example .env
# Edit .env with your settings
```

### 4. Configure Company Files

Edit `data\company-files.json` to list your QuickBooks company files:

```json
[
  {
    "company_file_path": "C:\\QB\\BakudanRamen.QBW",
    "company_name": "Bakudan Ramen",
    "assigned_store": "Main Store",
    "assigned_department": "Accounting",
    "notes": "Production company file"
  }
]
```

### 5. Build TypeScript

```powershell
npm run build
```

### 6. Run in Development

```powershell
# Option A — PowerShell helper
.\scripts\run-dev.ps1

# Option B — direct
npm run dev
```

### 7. Install as Windows Service

```powershell
# Must run as Administrator
.\scripts\install-windows-service.ps1
```

To start the service:
```powershell
Start-Service -Name "QB Ops Agent"
```

---

## Configuration

All settings in `.env`:

| Variable | Default | Description |
|---|---|---|
| `AGENT_NAME` | `qb-ops-agent` | Agent identifier |
| `AGENT_ENV` | `local` | Environment tag |
| `AGENT_OS_API_URL` | `http://127.0.0.1:3456/api` | Agent OS endpoint |
| `DASHBOARD_API_URL` | `https://dashboard.bakudanramen.com/api` | Dashboard endpoint |
| `MACHINE_TOKEN` | *(auto-generated)* | Auth token for this machine |
| `LOCAL_DB_PATH` | `./data/qb-ops-agent.sqlite` | SQLite database path |
| `HEARTBEAT_INTERVAL_SECONDS` | `60` | Heartbeat frequency |
| `WORKFLOW_CHECK_INTERVAL_MINUTES` | `15` | Workflow check frequency |
| `ENABLE_QB_WRITE_ACTIONS` | `false` | Allow QB write operations |
| `ENABLE_SCREEN_AUTOMATION` | `false` | Allow screen automation |
| `LOG_LEVEL` | `info` | Log verbosity |
| `LOG_DIR` | `./logs` | Log directory |

---

## Architecture

```
Windows QB Machine
  └── qb-ops-agent (Node.js service)
        ├── agent/      — Identity, heartbeat, startup
        ├── quickbooks/ — QB detection, company files, QBXML
        ├── workflows/  — Phase 1 monitoring checks
        ├── api/        — Agent OS + Dashboard HTTP clients
        ├── storage/    — SQLite cache, Winston logger
        └── security/   — Token mgmt, AES-256-GCM
              ↓
        Agent OS
              ↓
        dashboard.bakudanramen.com
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full details.

---

## Phases

| Phase | Status | Description |
|---|---|---|
| **Phase 1** | ✅ Active | Monitoring only. Machine detection, heartbeat, QB process check, workflow status reporting. |
| **Phase 2** | 📋 Planned | QB SDK/QBXML integration for read-only checks. User confirmation required. |
| **Phase 3** | 📋 Planned | Controlled automation only after QA approval. No auto-posting without explicit approval. |

---

## Scripts

| Script | Purpose |
|---|---|
| `scripts/install-windows-service.ps1` | Install as Windows auto-start service |
| `scripts/uninstall-windows-service.ps1` | Remove Windows service |
| `scripts/run-dev.ps1` | Dev runner with env loading |
| `scripts/health-check.ps1` | Verify all components are working |

---

## Safety Rules

- **Phase 1 does not modify any QuickBooks data**
- No QB passwords stored in plain text
- No sensitive financial data in logs
- `ENABLE_QB_WRITE_ACTIONS=false` enforced unless explicitly overridden
- Screen automation blocked in Phase 1

---

## Health Check

```powershell
.\scripts\health-check.ps1
```

Checks: Node.js, npm install, TypeScript build, machine token, QB process, hostname, SQLite DB, logs dir, company files config, Windows service.

---

## Uninstall

```powershell
.\scripts\uninstall-windows-service.ps1
```

---

## Multi-Machine

Each Windows machine runs its own `qb-ops-agent` instance. Each instance:
- Has a unique `machine_id` (UUID v5, stable across reinstalls)
- Reports its own company files
- Heartbeat includes hostname + IP for identification

See [docs/MULTI-MACHINE-PLAN.md](docs/MULTI-MACHINE-PLAN.md).
