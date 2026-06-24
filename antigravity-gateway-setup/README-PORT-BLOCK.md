# Antigravity Gateway Port Blocker

## Purpose
The Antigravity Gateway runs at `http://127.0.0.1:3456` and stays active in the background
(via PM2 + Windows Scheduled Tasks). When you build code inside `Ld-project`, this gateway
can interfere with the build process (port conflicts, background network traffic, watchdog
restart noise, etc.).

This folder contains scripts to **block / unblock port 3456 at the Windows Firewall level**
without killing the gateway process.

## Files
| File | Purpose |
|------|---------|
| `gateway-port-block.ps1` | Main PowerShell script (block / unblock / status) |
| `block-gateway.bat` | Double-click to **block** port 3456 (auto-elevates as Admin) |
| `unblock-gateway.bat` | Double-click to **unblock** port 3456 + restart gateway |
| `gateway-status.bat` | Double-click to check current block status |

## Usage

### Option A: Double-click (easiest)
1. Right-click `block-gateway.bat` -> **Run as administrator** (only first time)
2. Click "Yes" on the UAC popup
3. Wait for "DONE: Port 3456 is now BLOCKED" message
4. Build your code freely
5. When done, right-click `unblock-gateway.bat` -> **Run as administrator**

### Option B: PowerShell
```powershell
# Block
powershell -NoProfile -ExecutionPolicy Bypass -File ".\gateway-port-block.ps1" -Block

# Unblock
powershell -NoProfile -ExecutionPolicy Bypass -File ".\gateway-port-block.ps1" -Unblock

# Check status
powershell -NoProfile -ExecutionPolicy Bypass -File ".\gateway-port-block.ps1" -Status
```

## What it does

**On Block:**
1. Creates 2 Windows Firewall rules:
   - `Antigravity-Gateway-BLOCK-IN` (blocks inbound TCP 3456)
   - `Antigravity-Gateway-BLOCK-OUT` (blocks outbound TCP 3456)
2. Disables the `AntigravityGatewayWatchdog` scheduled task (stops restart noise)
3. The gateway process keeps running, but no traffic can reach it

**On Unblock:**
1. Removes both firewall rules
2. Re-enables the watchdog scheduled task
3. Restarts the gateway via PM2
4. Verifies health endpoint is reachable

**On Status:**
- Shows whether port 3456 is currently blocked or not

## Important Notes
- Always run as **Administrator** (firewall rules require elevated privileges)
- The `.bat` files use `RunAs` verb to auto-prompt for elevation
- Blocking is **reversible** - just run unblock
- The gateway is **NOT killed** - it just becomes unreachable
- After unblock, the gateway auto-restarts so you can use it again immediately

## Integration with Builds
You can also call these scripts from your build pipelines:

```powershell
# In your build script
& "C:\Ld-project\antigravity-gateway-setup\gateway-port-block.ps1" -Block
try {
    # ... your build commands ...
} finally {
    & "C:\Ld-project\antigravity-gateway-setup\gateway-port-block.ps1" -Unblock
}
```

## Troubleshooting
- **"Access is denied"** = Run as Administrator
- **Port still accessible after block** = Check Windows Firewall service is running:
  `Get-Service MpsSvc | Select Status`
- **Watchdog keeps restarting** = The watchdog is disabled during block, no need to worry
