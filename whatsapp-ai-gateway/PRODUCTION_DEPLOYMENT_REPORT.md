# Production Deployment Report

Generated: 2026-06-25 05:29:35 PDT

## Result

Production deployment status: PASS for service readiness.

Pilot signoff status is not decided in this report. See `FOOD_SAFETY_BOT_PRODUCTION_SIGNOFF.md`.

## Deployed Source

| Check | Result | Evidence |
| --- | --- | --- |
| Runtime source path | PASS | PM2 `exec cwd` is `C:\Ld-project\whatsapp-ai-gateway` |
| Runtime entrypoint | PASS | PM2 script path is `C:\Ld-project\whatsapp-ai-gateway\src\index.js` |
| Branch | OBSERVED | `main` |
| Git HEAD | OBSERVED | `7525a9b2a5f38e3aee9ee35cf68d17f51c423834` |
| Working tree | OBSERVED | Uncommitted changes exist, including Option C workflow files and production-readiness hardening |

## Service Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Port 3211 healthy | PASS | `GET /health` returned `status=ok`, `whatsapp=CONNECTED`, timestamp `2026-06-25T12:28:04.108Z` |
| WhatsApp connected | PASS | `GET /api/whatsapp/session` returned `status=CONNECTED`, `dbStatus=CONNECTED`, `lastError=null`, `reconnectAttempts=0`, `hasQR=false`, timestamp `2026-06-25T12:28:04.101Z` |
| Production groups visible | PASS | `/api/whatsapp/groups` returned B1, B2, and B3 kitchen groups at `2026-06-25T12:28:21.526Z` |
| Google Sheets configured | PASS | `/api/food-safety/sync-status` returned `googleSheetsConfigured=true` |
| TCP listener | PASS | `Get-NetTCPConnection -LocalPort 3211` returned `State=Listen`, owning PID `12912` |

## PM2 Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Process exists | PASS | PM2 process `food-safety-bot`, id `4` |
| Process health | PASS | `status=online`, PID `12912` |
| Auto-restart enabled | PASS | PM2 `autorestart=true` |
| Restart count | PASS | `restart_time=0`, `unstable_restarts=0` |
| PM2 saved process list | PASS | `C:\Users\hoang\.pm2\dump.pm2` updated after `pm2 save` |

## Log Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Application log writing | PASS | `logs\gateway.log` contains startup, DB init, Google Sheets init, WhatsApp auth success, and WhatsApp ready entries |
| PM2 stdout log writing | PASS | `C:\Users\hoang\.pm2\logs\food-safety-bot-out.log` contains current startup entries |
| PM2 error log | PASS | `C:\Users\hoang\.pm2\logs\food-safety-bot-error.log` has no current error output |

## Production Group Evidence

| Group | Result | WhatsApp ID |
| --- | --- | --- |
| B1 Kitchen Log | PASS | `120363349425133238@g.us` |
| B2 Kitchen Log | PASS | `120363365547218966@g.us` |
| B3 Kitchen log | PASS | `120363365820012393@g.us` |

## Notes

- The previous process listening on port 3211 was not PM2-managed and was running from `C:\Users\hoang\Downloads\source\setup-all\whatsapp-ai-gateway`.
- The active production service is now PM2-managed from `C:\Ld-project\whatsapp-ai-gateway`.
- No OCR, Vision, or AI dependency was required for these deployment checks.

