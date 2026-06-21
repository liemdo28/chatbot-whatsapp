# Master Source + One-Click Install Audit

**Date:** 2026-06-10
**Workspace checked:** `E:\Project\Master`
**Primary source:** `E:\Project\Master\Bakudan\integration-system`

## Verdict

**PASS WITH WARNINGS**

The laptop QB Agent source is in `Bakudan\integration-system`. The canonical central server for production-style reporting/control is `E:\Project\Master\mi-core\server` on port `4001`.

There is a real build/run confusion risk because an older PM2 service is currently listening on port `3456` from:

```text
E:\Project\Master\Agent\agent-coding-api-keys
PM2 name: antigravity-gateway
```

Do not package or target that folder for the QB laptop deployment unless explicitly replacing the central server.

## Source Classification

| Path | Classification | Use in QB laptop deploy? | Notes |
| --- | --- | --- | --- |
| `E:\Project\Master\Bakudan\integration-system` | Related, primary | YES | Desktop QB Agent, installer, reports, tests, Agent-Coding bridge evidence. |
| `E:\Project\Master\mi-core` | Related, central control | YES, server side only | Canonical `/api/qb-agent/*` endpoint, Google Sheet/reporting, approval gate, WhatsApp approval flow. |
| `E:\Project\Master\whatsapp-ai-gateway` | Related, reference pattern | NO for laptop package | Has updater/release pattern and WhatsApp approval integration; should not be copied into QB agent ZIP. |
| `E:\Project\Master\qb-ops-agent` | Related but legacy/overlap | NO | Deployment guide says disable it on QB laptops; can conflict with current integration-system agent. |
| `E:\Project\Master\Agent\agent-coding-api-keys` | Related but wrong target for this deploy | NO | Currently PM2 service on port `3456`; high risk of dev running/building against old gateway. |
| `E:\Project\Master\agent-coding-api-keys` | Related artifact/source copy | NO | Separate from canonical QB deploy. |
| `E:\Project\Master\accounting-engine` | Adjacent | NO | Not required for one-click QB Agent package. |
| `E:\Project\Master\food-safety-gateway` | Unrelated | NO | Not required for QB Agent. |
| `E:\Project\Master\RawSushi` | Unrelated business project | NO | Not required for Bakudan QB Agent. |
| `E:\Project\Master\Other` | Unrelated | NO | Do not include in deploy. |
| `E:\Project\Master\bakudan-releases` | Release artifact repo | Optional | Use only for release storage, not as source of truth. |

## Port/Runtime Findings

| Port | Current process | Source path | Risk |
| --- | --- | --- | --- |
| `4001` | `node dist/index.js` | `E:\Project\Master\mi-core\server` | Correct central server target. |
| `3456` | PM2 `antigravity-gateway` | `E:\Project\Master\Agent\agent-coding-api-keys` | Build/run confusion risk. |
| `3000` | Node dev process | `E:\Project\Master\Agent\doordash-compaigns` | Unrelated to QB Agent deploy. |

## One-Click Hidden Install Status

Added:

```text
INSTALL-ONE-CLICK-HIDDEN.bat
installer\install-agent.ps1
```

Behavior:

- Creates/uses `desktop-app\.venv`.
- Installs Python dependencies into the local venv.
- Sets both `MI_CORE_API_KEY` and `AGENT_CODING_API_KEY`, with fallback from Machine scope to User scope.
- Copies laptop config template.
- Normalizes `mi_core.base_url` and legacy `agent_coding.base_url` to the selected central URL.
- Registers Windows Scheduled Task `ToastPOSManager-Background`.
- Starts `background_agent.py` immediately using `pythonw.exe` hidden.
- No final prompt when launched through `INSTALL-ONE-CLICK-HIDDEN.bat`.

Default command:

```bat
INSTALL-ONE-CLICK-HIDDEN.bat
```

Optional command for laptop 2 or a different central URL:

```bat
INSTALL-ONE-CLICK-HIDDEN.bat qb-laptop-02 "Stone Oak" http://100.118.102.113:4001
```

## Auto-Update Status

**WARNING**

Source has auto-update components:

- `desktop-app/services/update_client.py`
- `desktop-app/services/update_downloader.py`
- `desktop-app/services/update_installer.py`
- `desktop-app/services/update_rollback_service.py`
- `desktop-app/services/update_scheduler.py`
- `mi-core/server/src/routes/integrationAgentReleases.ts`

Fixed in this audit:

- `background_agent.py` now starts `UpdateScheduler`.
- `MiCoreClient` now exposes public `get()` and `post()` methods required by update checks/events.

Control rule:

- Update checking/reporting can run automatically.
- Installation still requires admin approval. No silent auto-install is enabled by default.

## Push/Pull Data Status

**PASS WITH WARNINGS**

Push from QB Agent to central server:

- Register
- Heartbeat
- Event
- Activity log result
- Timeline result
- Sync result
- Error report
- Outbox retry

Pull from central server to QB Agent:

- Poll pending commands
- Acknowledge command
- Execute command handler
- Post command result

Central route target:

```text
http://100.118.102.113:4001/api/qb-agent/*
```

This route is served by `mi-core`. The older `Agent-Coding`/`agent-coding-api-keys` port `3456` must not be the laptop default.

## Fixes Applied

- Fixed `remote_control_scheduler.py` imports so background runtime can load package modules.
- Fixed `reporting_event_bus.py` and `reporting_outbox.py` imports.
- Fixed `machine_identity_service.py` configured-state logic to accept canonical `mi_core`.
- Added `MiCoreClient.get()` and `MiCoreClient.post()`.
- Started update scheduler from `background_agent.py`.
- Converted laptop installer to use local `.venv`.
- Added one-click hidden installer.
- Added `agent_coding` compatibility block to both laptop config templates.

## Validation

```text
38 passed
install-agent.ps1 syntax OK
build-deploy-zips.ps1 syntax OK
```

## Remaining Warnings

- QB company file path still must be real on each laptop; installer replaces username but cannot know the actual `.qbw` path.
- Tailscale Mac/iPhone validation previously remained incomplete/offline.
- The old PM2 `antigravity-gateway` on port `3456` should be stopped or clearly labeled before production rollout to avoid operator confusion.
