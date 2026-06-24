# QB Ops Agent

QuickBooks Desktop ↔ Mi-Core OS connector, runs on **laptop1** and pushes financial data to **mi-core-primary** every 6 hours via the QuickBooks Web Connector (QBWC).

## Architecture

```
┌─────────────────┐     SOAP (QBWC)     ┌──────────────────┐    HTTP POST    ┌──────────────────┐
│ QuickBooks      │ ──────────────────▶ │ qb-ops-agent     │ ──────────────▶ │ mi-core-primary  │
│ Desktop         │ ◀──────────────────  │ (laptop1:3456)   │  X-QB-API-Key   │ (port 4001)      │
│ + QB Web Conn.  │   QBXML responses   │                  │                 │ /api/qb/ingest   │
└─────────────────┘                      └──────────────────┘                 └──────────────────┘
```

## Files

| File | Purpose |
|------|---------|
| `src/index.js` | Express server + SOAP handler for QB Web Connector |
| `src/logger.js` | Structured JSON logger |
| `src/qbHandlers.js` | QBXML query builders and response parsers |
| `src/generateQwc.js` | Generates the `.qwc` config file from `.env` |
| `src/testConnection.js` | Smoke test the agent (health + status + SOAP) |
| `src/miCoreIngest.js` | Standalone ingest server (deploy on mi-core-primary) |
| `mi-core-connector.qwc` | Pre-generated QWC config (placeholder IP) |
| `install.bat` | Windows install + first-time setup |
| `start.bat` | Windows launcher |
| `.env.example` | Environment template |

## Quick Start (laptop1)

```cmd
cd E:\Project\Master\mi-core\services\qb-ops-agent
install.bat
```

`install.bat` will:
1. Verify Node.js
2. `npm install`
3. Generate a random `QB_API_KEY` and create `.env`
4. Generate `mi-core-connector.qwc` from your IP
5. Run connection test

Then start the agent:

```cmd
start.bat
```

Or with pm2 for auto-restart:

```cmd
npm install -g pm2
pm2 start src/index.js --name qb-ops-agent
pm2 startup
pm2 save
```

## Configuration

Edit `.env`:

```bash
PORT=3456
QB_USER=mi-admin
QB_API_KEY=<your-32-char-key>
AGENT_OS_API_URL=http://<mi-core-ip>:4001
LAPTOP1_IP=<your-laptop1-ip>
QB_COMPANY_FILE=C:\ProgramData\Intuit\QuickBooks\Company Files\MI_CEO.qbw
```

## Load .qwc into QuickBooks

1. Open QuickBooks Desktop on laptop1
2. Open QB Web Connector
3. **Add an Application** → select `mi-core-connector.qwc`
4. Enter password = your `QB_API_KEY`
5. ✅ Auto-Run, schedule 6 hours
6. Click **Update Selected** to test

## mi-core-primary Setup

Add to `E:\Project\Master\mi-core\.env`:

```bash
QB_AGENT_URL=http://<laptop1-ip>:3456
QB_API_KEY=<same-key-as-above>
```

Mount the ingest endpoint in mi-core (or run `miCoreIngest.js` standalone):

```bash
node src/miCoreIngest.js
```

## Test Endpoints

```bash
# From any machine on the LAN
curl http://<laptop1-ip>:3456/health
curl http://<laptop1-ip>:3456/status

# From mi-core-primary
curl http://127.0.0.1:4001/api/connectors/quickbooks/status
```

Expected output:
```json
{ "connected": true, "last_sync": "...", "data_available": true }
```

## SOAP Flow

QBWC ↔ qb-ops-agent exchanges follow this sequence:

1. `serverVersion` → return `1.0.0`
2. `clientVersion` → return empty (compatible)
3. `authenticate` → validate user/password → return `["", companyFile]`
4. `sendRequestXML` → return QBXML query (P&L, Tax, Payroll, AR/AP aging)
5. `receiveResponseXML` → parse, forward to mi-core, return `0` (done)
6. `closeConnection` → return `ok`

## Troubleshooting

| Issue | Fix |
|-------|-----|
| QBWC can't connect to AppURL | Open port 3456 on laptop1 Windows Firewall |
| "Application not certified" | Click "Yes, always allow" — this is expected for custom apps |
| Agent offline after reboot | `pm2 startup` and `pm2 save` on laptop1 |
| IP changed | Edit `LAPTOP1_IP` in `.env`, re-run `node src/generateQwc.js`, reload .qwc |
| Auth failed | Verify `QB_USER` and `QB_API_KEY` match in both `.env` files |
| SOAP 500 errors | Check agent logs, look for XML parse errors |
