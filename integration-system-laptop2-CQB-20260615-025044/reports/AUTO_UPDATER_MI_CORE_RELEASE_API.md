# Auto-Updater — Mi-core Release API
**Date:** 2026-06-09

---

## Endpoints

Base: `http://<CEO_PC_IP>:4001/api/integration-agent`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/releases/latest` | Public | Latest release manifest |
| `GET` | `/releases/:version` | Public | Specific version manifest |
| `POST` | `/releases` | Bearer | Publish new release |
| `POST` | `/update-events` | Bearer | Agent reports update event |
| `GET` | `/update-events?machine_id=&limit=` | Bearer | Query update history |
| `GET` | `/machines/versions` | Bearer | Per-laptop version dashboard |
| `GET` | `/downloads/:version/:filename` | Public | Download installer EXE |

---

## Publish a Release (Dev workflow)

```powershell
# After building ToastPOSManagerSetup-1.3.0.exe:

# 1. Get SHA-256
$sha = (Get-FileHash "release\ToastPOSManagerSetup-1.3.0.exe" -Algorithm SHA256).Hash

# 2. Copy EXE to Mi-core release dir
$dest = "E:\Project\Master\mi-core\data\releases\integration-system\1.3.0"
New-Item -ItemType Directory -Force $dest
Copy-Item "release\ToastPOSManagerSetup-1.3.0.exe" $dest

# 3. POST release manifest
curl -X POST http://localhost:4001/api/integration-agent/releases `
  -H "Authorization: Bearer $env:MI_CORE_API_KEY" `
  -H "Content-Type: application/json" `
  -d "{
    \"version\": \"1.3.0\",
    \"build\": \"20260609.01\",
    \"download_url\": \"http://TAILSCALE_IP:4001/api/integration-agent/downloads/1.3.0/ToastPOSManagerSetup-1.3.0.exe\",
    \"sha256\": \"$sha\",
    \"size_bytes\": $(Get-Item 'release\ToastPOSManagerSetup-1.3.0.exe').Length,
    \"release_notes\": [\"Fixed QB sync\", \"Added auto-updater\"],
    \"channel\": \"stable\"
  }"
```

---

## Check Latest Version (Agent)

```powershell
curl http://localhost:4001/api/integration-agent/releases/latest
```

Response:
```json
{
  "app": "integration-system",
  "channel": "stable",
  "version": "1.3.0",
  "build": "20260609.01",
  "published_at": "2026-06-09T09:00:00Z",
  "min_supported_version": "1.0.0",
  "download_url": "http://100.64.1.10:4001/api/integration-agent/downloads/1.3.0/ToastPOSManagerSetup-1.3.0.exe",
  "sha256": "abc123...",
  "size_bytes": 85234123,
  "release_notes": ["Fixed QB sync"],
  "requires_restart": true,
  "rollback_supported": true
}
```

---

## Update Event Flow (Agent → Mi-core)

```
Agent → POST /api/integration-agent/update-events
{
  "machine_id": "qb-laptop-01",
  "event_type": "UPDATE_CHECKED",
  "version": "1.3.0",
  "timestamp": "2026-06-09T09:00:00Z"
}
```

Mi-core stores in `ia_update_events` table and updates `ia_machine_versions`.

---

## Dashboard Query (CEO)

```powershell
# See all machine update statuses
curl -H "Authorization: Bearer $env:MI_CORE_API_KEY" \
  http://localhost:4001/api/integration-agent/machines/versions
```

Response:
```json
[
  {
    "machine_id": "qb-laptop-01",
    "current_version": "1.2.0",
    "latest_known_version": "1.3.0",
    "update_status": "AVAILABLE",
    "last_check": "2026-06-09T09:00:00Z",
    "last_update_result": "",
    "update_error": ""
  }
]
```

---

## Storage

```
E:\Project\Master\mi-core\
  data\
    releases\
      integration-system\
        1.2.0\
          manifest.json
          ToastPOSManagerSetup-1.2.0.exe   (optional)
        1.3.0\
          manifest.json
          ToastPOSManagerSetup-1.3.0.exe
    qb-agent.db   (shared SQLite — ia_update_events + ia_machine_versions tables added)
```
