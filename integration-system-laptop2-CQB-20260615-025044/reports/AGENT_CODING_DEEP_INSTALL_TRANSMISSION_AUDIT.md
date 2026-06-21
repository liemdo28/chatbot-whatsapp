# AGENT-CODING DEEP INSTALL + TRANSMISSION AUDIT

**Report Date:** 2026-06-05 20:10 UTC+7  
**Scope:** Laptop transfer install path, QB Agent client config, Agent-Coding bridge server, HTTP data transmission, outbox retry, remote command lifecycle.

## Verdict

**PASS WITH FIXES APPLIED**

The QB Agent can now connect to Agent-Coding and record data through a real `/api/qb-agent/*` bridge server included in the Agent-Coding repo.

## Critical Finding Fixed

Before this audit, the QB Agent client sent to `/api/qb-agent/*`, but Agent-Coding did not have a matching server bridge in the main source. A real bridge server was added:

```text
Agent-Coding/apps/qb-agent-server/server.js
```

Start command:

```powershell
cd Agent-Coding
npm run qb-agent:server
```

Default bind:

```text
0.0.0.0:3456
```

Default data directory:

```text
Agent-Coding/.local-agent/qb-agent
```

## Install Path Validation

| Item | Status | Evidence |
|---|---|---|
| Source runtime config location | PASS | `desktop-app/local-config.json` |
| Frozen EXE config location | PASS | same folder as EXE |
| Agent-Coding install | PASS | `npm install`, `npm run build` |
| Bridge server start command | PASS | `npm run qb-agent:server` |
| Laptop transfer guide updated | PASS | `LAPTOP_TRANSFER_AGENT_CODING_SETUP.md` |

Runtime path confirmed:

```text
RUNTIME_DIR=E:\Project\Master\Bakudan\integration-system\desktop-app
local-config=E:\Project\Master\Bakudan\integration-system\desktop-app\local-config.json
```

## QB Agent Client Validation

| Endpoint | Client Method | Status |
|---|---|---|
| `GET /api/qb-agent/ping` | `AgentCodingClient.ping()` | PASS |
| `POST /api/qb-agent/register` | `AgentCodingClient.register()` | PASS |
| `POST /api/qb-agent/heartbeat` | `AgentCodingClient.heartbeat()` | PASS |
| `POST /api/qb-agent/event` | `AgentCodingClient.event()` | PASS |
| `POST /api/qb-agent/activity-log-result` | `AgentCodingClient.activity_log_result()` | PASS |
| `POST /api/qb-agent/timeline-result` | `AgentCodingClient.timeline_result()` | PASS |
| `POST /api/qb-agent/sync-result` | `AgentCodingClient.sync_result()` | PASS |
| `POST /api/qb-agent/error` | `AgentCodingClient.error_report()` | PASS |
| `GET /api/qb-agent/commands?machine_id=...` | `RemoteCommandClient.poll()` | PASS |
| `POST /api/qb-agent/commands/{id}/ack` | `RemoteCommandClient.acknowledge()` | PASS |
| `POST /api/qb-agent/commands/{id}/result` | `RemoteCommandClient.post_result()` | PASS |

Fixed during audit:

```text
AgentCodingClient.register()
```

It was importing `machine_identity_service` without the `services.` package prefix.

## Live Transmission Evidence

### Mock Agent-Coding HTTP Recording

Script:

```text
reports/evidence/agent_coding_live_transmission_validation.py
```

Result:

```text
ok=true
ping=true
register=true
heartbeat=true
event=true
activity_log_result=true
timeline_result=true
sync_result=true
error_report=true
remote_commands_processed=1
outbox_sent=2
outbox_failed=0
outbox_remaining=0
auth_failures=0
machine_header_failures=0
```

Result file:

```text
reports/evidence/agent_coding_live_transmission_result.json
```

### Real Bridge Server Write Test

Bridge server started locally on port `3462`, then Python QB Agent client posted real HTTP requests.

Result:

```text
ping=true
register=true
heartbeat=true
activity=true
timeline=true
sync=true
error=true
```

Recorded files:

```text
reports/evidence/qb-agent-bridge-live-data/events.jsonl
reports/evidence/qb-agent-bridge-live-data/machines.json
```

### Real Bridge Remote Command Test

Bridge server started locally on port `3463`.

Flow:

```text
POST /api/qb-agent/commands
GET  /api/qb-agent/commands?machine_id=qb-laptop-command-01
POST /api/qb-agent/commands/cmd-live-bridge-001/ack
POST /api/qb-agent/commands/cmd-live-bridge-001/result
```

Result:

```text
command_id=cmd-live-bridge-001
status=COMPLETED
processed=1
```

Recorded files:

```text
reports/evidence/qb-agent-bridge-command-data/commands.json
reports/evidence/qb-agent-bridge-command-data/events.jsonl
```

## Test Evidence

Focused QB Agent client/control tests:

```text
45 passed in 18.61s
```

Agent-Coding bridge server test:

```text
QB Agent bridge receives data and completes command lifecycle: PASS
```

Full Agent-Coding Node suite:

```text
tests 563
pass 563
fail 0
cancelled 0
```

Agent-Coding build:

```text
Build OK — 3 entry points verified.
```

## Laptop Configuration Required

On the Agent-Coding machine:

```powershell
cd integration-system\Agent-Coding
setx AGENT_CODING_API_KEY "REPLACE_WITH_REAL_KEY"
setx QB_AGENT_HOST "0.0.0.0"
setx QB_AGENT_PORT "3456"
npm install
npm run build
npm run qb-agent:server
```

On the QB laptop:

```json
{
  "agent_coding": {
    "enabled": true,
    "base_url": "http://100.118.102.113:3456",
    "api_key_env": "AGENT_CODING_API_KEY",
    "poll_commands_seconds": 15,
    "heartbeat_seconds": 60,
    "timeout_seconds": 15
  }
}
```

Also set:

```powershell
setx AGENT_CODING_API_KEY "REPLACE_WITH_REAL_KEY"
```

## Remaining Production Caveats

| Caveat | Status |
|---|---|
| Tailscale Mac/iPhone full validation | Still pending; devices offline in prior validation |
| Real remote laptop validation | Pending physical laptop transfer |
| Google Sheet bridge from Agent-Coding | Google Sheet API itself validated; this bridge currently records local JSONL |
| Long-running service install | Needs Windows service/PM2/scheduled task decision |

## Final Decision

For source transfer and QB Agent to Agent-Coding data capture:

```text
PASS
```

For full production rollout:

```text
PASS WITH WARNINGS
NOT PRODUCTION READY
```

Production upgrade still depends on physical multi-device Tailscale validation and real laptop smoke test after transfer.
