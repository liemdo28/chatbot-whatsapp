# DEV1 — QuickBooks Setup Completion Report

**Task:** DEV1 TASK — QuickBooks Connector Setup (P0)  
**Status:** ✅ Code complete, deployment pending (laptop1 / mi-core-primary access required)  
**Date:** 2026-06-23  
**Branch location:** `services/qb-ops-agent/`

---

## What was built

A complete Node.js QB Web Connector agent that bridges QuickBooks Desktop on **laptop1** to Mi-Core OS on **mi-core-primary**. All code is local and ready to deploy once the physical installation steps (Steps 1-6 of the original task) are run by hand.

### Files created (12 total)

```
services/qb-ops-agent/
├── package.json                          # express + xml2js + dotenv
├── .env.example                          # env template with all required vars
├── mi-core-connector.qwc                 # pre-built QWC file (replace 192.168.1.100)
├── install.bat                           # Windows one-click installer
├── start.bat                             # Windows launcher
├── README.md                             # full deploy + ops guide
├── DEV1_QUICKBOOKS_SETUP_COMPLETION_REPORT.md
└── src/
    ├── index.js                          # Express + SOAP server (main entry)
    ├── logger.js                         # Structured JSON logger
    ├── qbHandlers.js                     # QBXML query builders + response parser
    ├── generateQwc.js                    # Generates .qwc from .env
    ├── testConnection.js                 # Smoke test (health + status + SOAP auth)
    └── miCoreIngest.js                   # Standalone ingest endpoint (deploy on mi-core)
```

---

## Mapping to original task steps

| Step | Task description | What was built | Status |
|------|------------------|----------------|--------|
| 1 | Install QB Web Connector on laptop1 | Manual install required (Intuit download) | ⏳ Pending physical install |
| 2 | Create `.qwc` file | `mi-core-connector.qwc` + `src/generateQwc.js` | ✅ Done (IP placeholder, will be replaced by `install.bat`) |
| 3 | Start QB Ops Agent on laptop1 | `install.bat`, `start.bat`, `src/index.js` (pm2-friendly) | ✅ Done — needs `install.bat` run on laptop1 |
| 4 | Load .qwc into QBWC | Already a manual step (no code needed) | ⏳ Pending physical load |
| 5 | Add env vars to mi-core | Documented in README; `src/miCoreIngest.js` provides the endpoint | ✅ Done — needs deploy to mi-core-primary |
| 6 | Test the connection | `src/testConnection.js` validates health, status, SOAP auth | ✅ Done — run after deploy |

---

## What the agent does

1. **Listens on port 3456** (configurable via `PORT`) for incoming QBWC SOAP requests
2. **Validates client version** (requires QBWC ≥ 2.2.0.30)
3. **Authenticates** via username (`mi-admin`) + password (`QB_API_KEY`)
4. **Returns QBXML queries** for the financial data we need:
   - P&L (current month to date)
   - Sales Tax Summary
   - Payroll Summary
   - AR Statement (A/R aging)
   - AP Statement (A/P aging)
5. **Receives QBXML response** and forwards to mi-core at `AGENT_OS_API_URL/api/qb/ingest`
6. **Exposes**:
   - `GET /health` — service liveness
   - `GET /status` — connector status (for mi-core health check)
   - `POST /api/qb/webhook` — SOAP endpoint (QBWC calls this)

## What the mi-core side does

`src/miCoreIngest.js` (deploy to `mi-core-primary`):

1. `GET /api/connectors/quickbooks/status` → returns `{ connected, last_sync, data_available }`
2. `POST /api/qb/ingest` → receives raw QBXML, stores, parses (TODO: hook up DB)
3. `GET /api/connectors/quickbooks/reports` → returns parsed P&L / Tax / Payroll / AR / AP

The endpoint can be:
- Mounted as middleware in the existing mi-core Express app, **or**
- Run standalone: `node src/miCoreIngest.js` (default port 4001)

---

## Configuration required before deploy

The agent needs these values populated in `.env` on laptop1:

```bash
PORT=3456
QB_USER=mi-admin
QB_API_KEY=<generate-32-char-key>      # generate via: node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
AGENT_OS_API_URL=http://<mi-core-ip>:4001
QB_COMPANY_FILE=C:\ProgramData\Intuit\QuickBooks\Company Files\MI_CEO.qbw
LAPTOP1_IP=<your-laptop1-lan-ip>       # replace the 192.168.1.100 in mi-core-connector.qwc
LOG_LEVEL=info
```

`install.bat` auto-generates `QB_API_KEY` and prompts for the rest via Notepad.

---

## Deployment instructions (run on laptop1, in order)

```cmd
REM 1. Install QB Web Connector (Intuit download — outside this repo)

REM 2. Copy/sync this folder to laptop1
cd C:\path\to\qb-ops-agent

REM 3. Run installer (one time)
install.bat

REM 4. Start the agent
start.bat

REM 5. Open QuickBooks Desktop, open QB Web Connector, load mi-core-connector.qwc
REM    Password = your QB_API_KEY from .env
REM    Auto-Run = ON, schedule 6 hours
```

## Deployment instructions (run on mi-core-primary)

```cmd
REM Add to E:\Project\Master\mi-core\.env:
QB_AGENT_URL=http://<laptop1-ip>:3456
QB_API_KEY=<same-as-above>

REM Mount the ingest endpoint
REM Option A: Run standalone
cd C:\path\to\qb-ops-agent
node src/miCoreIngest.js

REM Option B: Mount in existing mi-core Express app
const qbIngest = require('./qb-ops-agent/src/miCoreIngest');
app.use(qbIngest);

REM Restart mi-core
pm2 restart mi-core
```

---

## Verification

```bash
# 1. From laptop1 — agent health
curl http://localhost:3456/health
# → { "status": "ok", "service": "qb-ops-agent", "uptime": 12.3 }

# 2. From mi-core-primary — connector status
curl http://127.0.0.1:4001/api/connectors/quickbooks/status
# → { "connected": true, "last_sync": "...", "data_available": true }

# 3. From any machine on the LAN — run the smoke test
cd services/qb-ops-agent
node src/testConnection.js
# → [PASS] GET /health
# → [PASS] GET /status
# → [PASS] POST /api/qb/webhook (authenticate)
```

---

## Handoff checklist

- [ ] QB Web Connector installed on laptop1
- [ ] `install.bat` run on laptop1, `.env` populated
- [ ] `qb-ops-agent` running on port 3456 on laptop1
- [ ] `mi-core-connector.qwc` loaded into QBWC + password set + auto-run ON
- [ ] `miCoreIngest.js` deployed on mi-core-primary
- [ ] `QB_AGENT_URL` + `QB_API_KEY` added to mi-core .env
- [ ] `pm2 restart mi-core`
- [ ] `GET /api/connectors/quickbooks/status` returns `connected: true`
- [ ] Smoke test `node src/testConnection.js` passes all 3 checks
- [ ] Ping @liem when done

---

## Known limitations / TODO

- `miCoreIngest.js` currently stores raw XML in memory. Production should persist to DB and parse into structured reports.
- The QBXML response parser in `qbHandlers.js` extracts rows generically; specific report schemas (P&L line items, tax buckets) need a follow-up mapping pass.
- No retry/queue on mi-core ingest failure — currently logs the error and lets next QBWC cycle retry.
- Single QuickBooks company file per agent (QBFS). Multi-company would need multiple instances on different ports.
