# Canonical Project Map
**Generated:** 2026-06-09

---

## Required Canonical Structure

```
E:\Project\Master\mi-core
  → Central dashboard + API + Google Sheet writer + Remote command hub
  → Port: 4001 (MI_PORT)
  → QB Agent API: /api/qb-agent/*
  → Auth: MI_CORE_API_KEY

E:\Project\Master\Bakudan\integration-system
  → Windows QB Agent desktop app (Python/PyInstaller)
  → Installer: release/ToastPOSManagerSetup.exe
  → Config: desktop-app/local-config.json
  → Reads QB data (read-only by default)
  → Reports to Mi-core

E:\Project\Master\_archive  (TO BE CREATED — pending CEO approval)
  → E:\Project\Master\Bakudan\Agent-Coding  (old engineering OS)
  → E:\Project\Master\qb-ops-agent          (Node.js QB agent, wrong server target)
```

---

## Actual Paths (Confirmed This Audit)

| Role | Canonical Path | Status |
|---|---|---|
| Mi-core (central server) | `E:\Project\Master\mi-core` | ✅ Confirmed |
| QB Agent (Windows desktop) | `E:\Project\Master\Bakudan\integration-system` | ✅ Confirmed |
| Archive (pending) | `E:\Project\Master\_archive` | ⚠️ To be created |

---

## Canonical Config Key Mapping

```json
// In desktop-app/local-config.json:
{
  "mi_core": {                         // NEW canonical key (preferred)
    "enabled": true,
    "base_url": "http://<TAILSCALE_IP>:4001",
    "api_key_env": "MI_CORE_API_KEY",
    "machine_id": "qb-laptop-01",
    "heartbeat_seconds": 60,
    "poll_commands_seconds": 15,
    "timeout_seconds": 15
  },
  // "agent_coding": {}                 // OLD key — still works but deprecated

  "features": {
    "qb_write_sync_enabled": false,           // OFF — CEO must enable
    "qb_read_only_activity_log_enabled": true, // ON — default
    "mi_core_reporting_enabled": true,         // ON — default
    "multi_file_12h_sync_enabled": true        // ON — default
  }
}
```

---

## Canonical Env Vars

| Var | Purpose | Status |
|---|---|---|
| `MI_CORE_API_KEY` | Auth token for Mi-core API (new) | ✅ Preferred |
| `AGENT_CODING_API_KEY` | Auth token legacy name | ⚠️ Still accepted but deprecated |

---

## Mi-core QB Agent Port Reference

| Server | Port | Purpose |
|---|---|---|
| Mi-core | 4001 | Central API, QB Agent endpoints |
| qb-ops-agent target | 3456 | OLD — "Agent OS" server (no longer used) |

> **Important:** If `qb-ops-agent` is installed on any QB laptop, it may be trying to connect to port 3456 (old Agent OS server). This must be updated or the project archived to prevent confusion.
