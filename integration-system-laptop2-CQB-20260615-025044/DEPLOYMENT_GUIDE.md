# Two-Laptop QB Agent + Mi-core Deployment Guide
**Date:** 2026-06-09  
**Architecture:**
```
CEO PC  ──  Mi-core (port 4001)  ←── Laptop 1 (qb-laptop-01)
                                 ←── Laptop 2 (qb-laptop-02)
```

---

## STEP 1 — Set Up Mi-core on CEO PC

### 1a. Install dependencies
```powershell
cd E:\Project\Master\mi-core\server
npm install
```

### 1b. Configure .env
Edit `E:\Project\Master\mi-core\server\.env`:
```env
MI_PORT=4001
HOST=0.0.0.0          # bind to all interfaces (required for laptops to connect)
MOBILE_ACCESS=1
MI_CORE_API_KEY=xicB1Iyn9i1LFIjC13d74HqDxKpx4ZGtWkpbp9ZfwouQLFTBMipQ2eobdlqu4s6d   # same key used on both laptops

# Google Sheets (fill in after creating spreadsheet)
GOOGLE_SHEET_ID=your-google-sheet-id-here
# GOOGLE_SERVICE_ACCOUNT_JSON=base64-encoded-service-account-json
```

### 1c. Build and start Mi-core
```powershell
cd E:\Project\Master\mi-core\server
npm run build
npm run start
# OR for development:
npm run dev
```

### 1d. Verify Mi-core is accessible
From CEO PC:
```powershell
curl http://localhost:4001/api/qb-agent/ping
# Expected: {"ok":true,"server":"mi-core","timestamp":"..."}
```

Get Tailscale IP of CEO PC:
```powershell
tailscale ip -4
# Example: 100.118.102.113
```

From a different machine (Tailscale connected):
```powershell
curl http://100.118.102.113:4001/api/qb-agent/ping
```

---

## STEP 2 — Set Up Google Sheets

### 2a. Create the spreadsheet
1. Go to https://sheets.google.com
2. Create a new spreadsheet: "QB Agent Dashboard"
3. Copy the spreadsheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit`

### 2b. Set up authentication (Service Account recommended)
1. Go to https://console.cloud.google.com
2. Create or select a project
3. Enable Google Sheets API
4. Create a Service Account → download JSON key
5. Share the spreadsheet with the service account email
6. Base64-encode the JSON:
   ```powershell
   $json = Get-Content "service-account.json" -Raw
   [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)) | clip
   ```
7. Paste into Mi-core `.env` as `GOOGLE_SERVICE_ACCOUNT_JSON=`

### 2c. Set GOOGLE_SHEET_ID in Mi-core .env and restart

---

## STEP 3 — Install QB Agent on Laptop 1

### 3a. Copy installer
Transfer `release/ToastPOSManagerSetup.exe` to Laptop 1.

> If no EXE yet: copy the `integration-system` folder and run directly:
> ```powershell
> cd E:\integration-system\desktop-app
> pip install -r requirements.txt
> python main.py --first-run
> ```

### 3b. Set environment variable
```powershell
# Run as admin or add to System Environment Variables
[System.Environment]::SetEnvironmentVariable("MI_CORE_API_KEY", "xicB1Iyn9i1LFIjC13d74HqDxKpx4ZGtWkpbp9ZfwouQLFTBMipQ2eobdlqu4s6d", "Machine")
```

### 3c. Copy config template
```powershell
copy "config-templates\laptop-01-local-config.json" "local-config.json"
```
Edit `local-config.json`:
- Replace `REPLACE_WITH_CEO_PC_TAILSCALE_IP` with actual Tailscale IP (e.g. `100.118.102.113`)
- Replace `REPLACE_WITH_USERNAME` with Windows username
- Replace `REPLACE_WITH_ACTUAL_PATH` with actual QB company file path

### 3d. Verify connection from Laptop 1
```powershell
curl -H "Authorization: Bearer xicB1Iyn9i1LFIjC13d74HqDxKpx4ZGtWkpbp9ZfwouQLFTBMipQ2eobdlqu4s6d" http://100.118.102.113:4001/api/qb-agent/ping
```

### 3e. Run first-time sync test
```powershell
python main.py --run-sync-now
```

---

## STEP 4 — Install QB Agent on Laptop 2

Same as Step 3 but use `config-templates/laptop-02-local-config.json` with:
- `machine_id`: `qb-laptop-02`
- `store_code`: `stone_oak`
- Correct QB file path for Stone Oak

---

## STEP 5 — Verify Both Laptops Are Connected

Check Mi-core dashboard:
```
http://localhost:4001/api/qb-agent/machines
```
Expected: two machines listed (`qb-laptop-01`, `qb-laptop-02`)

Check heartbeats:
```
http://localhost:4001/api/qb-agent/status
```

---

## STEP 6 — Send Remote Commands from CEO PC

### Trigger 12h sync on Laptop 1:
```powershell
curl -X POST http://localhost:4001/api/qb-agent/commands `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer your-api-key" `
  -d '{"machine_id":"qb-laptop-01","command_type":"RUN_12H_SYNC_NOW","payload":{}}'
```

### Scan QB files on Laptop 2:
```powershell
curl -X POST http://localhost:4001/api/qb-agent/commands `
  -H "Authorization: Bearer your-api-key" `
  -H "Content-Type: application/json" `
  -d '{"machine_id":"qb-laptop-02","command_type":"SCAN_QB_FILES","payload":{}}'
```

---

## STEP 7 — Disable qb-ops-agent (if running)

On any QB laptop where `qb-ops-agent` (Node.js) is installed:
```powershell
# Check if running
Get-Process -Name "node" | Where-Object { $_.CommandLine -like "*qb-ops-agent*" }

# Stop it
Stop-Process -Name "node" -Force

# Remove from startup if installed as scheduled task
schtasks /Delete /TN "qb-ops-agent" /F 2>$null
```

The `qb-ops-agent` project connects to the OLD server at port 3456.
It must NOT run alongside `integration-system` on the same laptop.

---

## STEP 8 — Confirm Google Sheet Updates

After a sync cycle runs, open the Google Sheet and verify:
- `Dashboard` tab: both machine rows updated
- `Machines` tab: both machines registered
- `QB Files` tab: files from both laptops listed
- `12H Sync Cycles` tab: cycle records added
- `Daily Activity Log` tab: activity rows per file per date
- `Store Summary` tab: latest QB status per store

---

## Architecture Summary

```
CEO PC (Tailscale: 100.x.x.x)
├── E:\Project\Master\mi-core\server\  (npm run start, port 4001)
│   ├── /api/qb-agent/*  ← QB Agent endpoints
│   ├── data/qb-agent.db ← SQLite store
│   └── → Google Sheets  ← auto-written after each report
│
QB Laptop 1 (qb-laptop-01)
├── integration-system\desktop-app\  (ToastPOSManager.exe)
│   ├── local-config.json (mi_core.base_url = http://100.x.x.x:4001)
│   ├── MI_CORE_API_KEY env var
│   ├── background agent: heartbeat every 60s
│   └── 12h sync: reads all .QBW files → pushes to Mi-core
│
QB Laptop 2 (qb-laptop-02)
└── same as Laptop 1, machine_id = qb-laptop-02
```
