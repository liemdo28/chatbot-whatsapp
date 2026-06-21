# Laptop Transfer + Agent-Coding Connection Setup

Use this when moving the source ZIP to another laptop.

## 1. Extract

Extract the ZIP so the folder is:

```text
integration-system
```

## 2. Install Dependencies

Desktop app Python dependencies:

```powershell
cd integration-system\desktop-app
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Agent-Coding Node dependencies:

```powershell
cd integration-system\Agent-Coding
npm install
npm run build
```

Start the Agent-Coding QB Agent bridge on the Agent-Coding/CEO machine:

```powershell
cd integration-system\Agent-Coding
setx AGENT_CODING_API_KEY "REPLACE_WITH_REAL_KEY"
setx QB_AGENT_HOST "0.0.0.0"
setx QB_AGENT_PORT "3456"
npm run qb-agent:server
```

The bridge records incoming QB Agent data under:

```text
Agent-Coding\.local-agent\qb-agent
```

## 3. Configure QB Agent to Connect to Agent-Coding

Create:

```text
integration-system\desktop-app\local-config.json
```

Start from `desktop-app\local-config.example.json`, then update this section:

```json
{
  "machine": {
    "machine_id": "qb-laptop-01",
    "machine_name": "QB Laptop 01",
    "store_code": "bandera",
    "store_name": "Bakudan Bandera",
    "location": "Bandera"
  },
  "agent_coding": {
    "enabled": true,
    "base_url": "http://100.118.102.113:3456",
    "api_key_env": "AGENT_CODING_API_KEY",
    "poll_commands_seconds": 15,
    "heartbeat_seconds": 60,
    "timeout_seconds": 15
  },
  "google_sheet_reporting": {
    "mode": "centralized",
    "write_from": "agent-coding",
    "enabled_on_qb_agent": false
  }
}
```

If the Agent-Coding server runs on a different Tailscale IP, replace:

```text
http://100.118.102.113:3456
```

## 4. Set API Key

Set the same API key expected by Agent-Coding:

```powershell
setx AGENT_CODING_API_KEY "REPLACE_WITH_REAL_KEY"
```

Open a new PowerShell window after running `setx`.

## 5. Validate Connection

From `integration-system\desktop-app`:

```powershell
.\.venv\Scripts\python.exe -c "from services.agent_coding_client import AgentCodingClient; c=AgentCodingClient(); print('ping=', c.ping()); print('register=', c.register()); print('heartbeat=', c.heartbeat(qb_status='QB_READY'))"
```

Expected:

```text
ping= True
register= True
heartbeat= True
```

If the laptop is offline or Agent-Coding is unreachable, events are queued in:

```text
desktop-app\runtime\reporting-outbox
```

They will retry when the connection is restored.
