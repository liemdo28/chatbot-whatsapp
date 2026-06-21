"""
Real QB Agent API server — CEO production readiness proof.
Features: heartbeat -> Google Sheet + SQLite + activity log + dashboard.
Run: python reports\evidence\qb_agent_real_server.py
"""
from __future__ import annotations
import json
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
import uvicorn

# ── Google Sheets ─────────────────────────────────────────────────────────────
try:
    from google.auth.transport.requests import Request as _Req
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build
    GOOGLE_AVAILABLE = True
except ImportError:
    GOOGLE_AVAILABLE = False

ROOT = Path(r"e:\Project\Master\Bakudan\integration-system")
TOKEN = ROOT / "token_sheets_validation.json"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
SHEET_ID = "11-JIK7KkjcsrSMaaX2V0knd-CdjR8Y9xbydWWxG70Wg"
SHEET_URL = "https://docs.google.com/spreadsheets/d/11-JIK7KkjcsrSMaaX2V0knd-CdjR8Y9xbydWWxG70Wg/edit"
SHEET_TAB = "QB Ops Live"

_sheets = None

def get_sheets():
    global _sheets
    if not GOOGLE_AVAILABLE:
        return None
    if _sheets:
        return _sheets
    creds = None
    if TOKEN.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN), SCOPES)
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(_Req())
    if not creds or not creds.valid:
        flow = InstalledAppFlow.from_client_secrets_file(str(ROOT / "credentials.json"), SCOPES)
        creds = flow.run_local_server(port=0)
    _sheets = build("sheets", "v4", credentials=creds)
    return _sheets

def ensure_sheet_tab():
    """Create the QB Ops Live tab if it doesn't exist."""
    sheets = get_sheets()
    if not sheets:
        return False
    try:
        # Try to add tab (ignore if already exists)
        sheets.spreadsheets().batchUpdate(
            spreadsheetId=SHEET_ID,
            body={
                "requests": [{"addSheet": {"properties": {"title": SHEET_TAB}}}]
            },
        ).execute()
    except Exception:
        pass  # Tab already exists
    return True

def append_sheet_row(values):
    sheets = get_sheets()
    if not sheets:
        return {"error": "sheets service not available"}
    ensure_sheet_tab()
    try:
        result = sheets.spreadsheets().values().append(
            spreadsheetId=SHEET_ID,
            range=f"{SHEET_TAB}!A:G",
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body={"values": [values]},
        ).execute()
        return result
    except Exception as e:
        return {"error": str(e)}

# ── SQLite DB ────────────────────────────────────────────────────────────────
DB = ROOT / "reports" / "evidence" / "qb_agent.db"
DB.parent.mkdir(parents=True, exist_ok=True)

def init_db():
    conn = sqlite3.connect(str(DB))
    conn.execute("""
        CREATE TABLE IF NOT EXISTS heartbeats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT, machine_id TEXT, qb_status TEXT,
            local_ip TEXT, tailnet_ip TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS commands (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            command_id TEXT, status TEXT,
            created_at TEXT, completed_at TEXT, result TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS machines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            machine_id TEXT UNIQUE, last_seen TEXT,
            qb_status TEXT, tailnet_ip TEXT, online INTEGER
        )
    """)
    conn.commit()
    conn.close()

init_db()

def upsert_machine(machine_id, qb_status, tailnet_ip):
    conn = sqlite3.connect(str(DB))
    now = datetime.now(timezone.utc).isoformat()
    conn.execute("""
        INSERT INTO machines (machine_id, last_seen, qb_status, tailnet_ip, online)
        VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(machine_id) DO UPDATE SET
            last_seen=excluded.last_seen,
            qb_status=excluded.qb_status,
            tailnet_ip=excluded.tailnet_ip,
            online=1
    """, (machine_id, now, qb_status, tailnet_ip))
    conn.commit()
    conn.close()

def get_machines():
    conn = sqlite3.connect(str(DB))
    rows = conn.execute(
        "SELECT machine_id, last_seen, qb_status, tailnet_ip, online FROM machines ORDER BY last_seen DESC"
    ).fetchall()
    conn.close()
    return rows

# ── Activity log ──────────────────────────────────────────────────────────────
ACTIVITY_LOG = ROOT / "reports" / "evidence" / "qb_agent_activity_log.jsonl"

def write_activity(event_type, data):
    entry = {"ts": datetime.now(timezone.utc).isoformat(), "type": event_type, "data": data}
    with open(ACTIVITY_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
    return entry

# ── FastAPI app ──────────────────────────────────────────────────────────────
app = FastAPI(title="QB Agent Real Server")

class HeartbeatPayload(BaseModel):
    machine_id: str
    qb_status: str = "UNKNOWN"
    local_ip: str = ""
    tailnet_ip: str = ""
    timestamp: str = ""

class CommandResult(BaseModel):
    command_id: str
    status: str
    result: dict = {}

class ActivityLogPayload(BaseModel):
    store_id: str
    date: str
    status: str
    qb_status: str
    sync_mode: str = "auto"
    issues: list = []
    warnings: list = []
    runtime_seconds: int = 0
    machine_id: str = ""

@app.get("/health")
def health():
    return {"ok": True, "server": "QB Agent Real Server", "google": GOOGLE_AVAILABLE}

# ── QB Agent -> Agent-Coding ──────────────────────────────────────────────────
@app.post("/api/qb-agent/heartbeat")
async def heartbeat(payload: HeartbeatPayload, request: Request):
    ts = datetime.now(timezone.utc).isoformat()
    client_host = request.client.host if request and request.client else "unknown"

    conn = sqlite3.connect(str(DB))
    conn.execute(
        "INSERT INTO heartbeats (ts, machine_id, qb_status, local_ip, tailnet_ip) VALUES (?,?,?,?,?)",
        (ts, payload.machine_id, payload.qb_status,
         payload.local_ip, payload.tailnet_ip or client_host)
    )
    conn.commit()
    conn.close()

    upsert_machine(payload.machine_id, payload.qb_status, payload.tailnet_ip or client_host)
    write_activity("heartbeat", {"machine_id": payload.machine_id, "qb_status": payload.qb_status})

    sheet_row = [ts, payload.machine_id, payload.qb_status, "heartbeat", "OK", ""]
    sheet_result = append_sheet_row(sheet_row)

    return {
        "ok": True, "received": ts,
        "sheet_updated": "error" not in sheet_result,
        "sheet_url": SHEET_URL,
    }

@app.post("/api/qb-agent/activity-log-result")
async def activity_log(payload: ActivityLogPayload, request: Request):
    ts = datetime.now(timezone.utc).isoformat()
    machine_id = payload.machine_id or "unknown"

    entry = write_activity("activity_log", {
        "store_id": payload.store_id, "date": payload.date,
        "status": payload.status, "qb_status": payload.qb_status,
        "runtime_seconds": payload.runtime_seconds,
    })

    sheet_row = [ts, machine_id, payload.qb_status, "activity_log",
                 payload.status,
                 f"store={payload.store_id}, date={payload.date}, runtime={payload.runtime_seconds}s"]
    sheet_result = append_sheet_row(sheet_row)

    return {"ok": True, "logged": entry, "sheet_updated": "error" not in sheet_result}

@app.post("/api/qb-agent/sync-result")
async def sync_result(payload: dict, request: Request):
    ts = datetime.now(timezone.utc).isoformat()
    entry = write_activity("sync_result", payload)
    sheet_row = [ts, payload.get("machine_id","?"), payload.get("qb_status","?"),
                 "sync_result", "OK", json.dumps(payload)]
    sheet_result = append_sheet_row(sheet_row)
    return {"ok": True, "sheet_updated": "error" not in sheet_result}

# ── Agent-Coding -> QB Agent ──────────────────────────────────────────────────
@app.get("/api/qb-agent/commands")
def poll_commands():
    cmd_id = f"cmd-{int(time.time())}"
    return {
        "commands": [{
            "command_id": cmd_id,
            "command_type": "TEST_QB_CONNECTION",
            "payload": {"note": "Production readiness validation command"},
            "status": "PENDING",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }]
    }

@app.post("/api/qb-agent/commands/ack")
async def ack_command(payload: CommandResult, request: Request):
    ts = datetime.now(timezone.utc).isoformat()
    conn = sqlite3.connect(str(DB))
    conn.execute(
        "INSERT INTO commands (command_id, status, result, completed_at) VALUES (?,?,?,?)",
        (payload.command_id, payload.status, json.dumps(payload.result), ts)
    )
    conn.commit()
    conn.close()

    entry = write_activity("command_result", {
        "command_id": payload.command_id, "status": payload.status, "result": payload.result,
    })

    sheet_row = [ts, "agent-coding", "SERVER", "command_ack",
                 payload.status, f"cmd={payload.command_id}"]
    sheet_result = append_sheet_row(sheet_row)

    return {"ok": True, "acknowledged": True, "sheet_updated": "error" not in sheet_result}

# ── Dashboard ──────────────────────────────────────────────────────────────────
@app.get("/dashboard", response_class=HTMLResponse)
def dashboard():
    machines = get_machines()
    conn = sqlite3.connect(str(DB))
    hb_count = conn.execute("SELECT COUNT(*) FROM heartbeats").fetchone()[0]
    cmd_count = conn.execute("SELECT COUNT(*) FROM commands").fetchone()[0]
    last_hb = conn.execute(
        "SELECT ts, machine_id, qb_status FROM heartbeats ORDER BY id DESC LIMIT 5"
    ).fetchall()
    last_cmds = conn.execute(
        "SELECT command_id, status, completed_at FROM commands ORDER BY id DESC LIMIT 5"
    ).fetchall()
    conn.close()

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    machine_rows = ""
    for m in machines:
        ago = "?"
        try:
            last = datetime.fromisoformat(m[1])
            delta = (datetime.now(timezone.utc) - last).total_seconds()
            ago = f"{int(delta)}s ago"
        except Exception:
            pass
        color = "#34d399" if m[4] == 1 else "#ef4444"
        status_text = "ONLINE" if m[4] == 1 else "OFFLINE"
        machine_rows += (
            f"<tr><td style='color:{color};font-weight:700'>{m[0]}</td>"
            f"<td>{m[2]}</td><td>{m[3]}</td><td>{ago}</td>"
            f"<td style='color:{color};font-weight:700'>{status_text}</td></tr>"
        )

    hb_rows = ""
    for h in last_hb:
        hb_rows += (
            f"<tr><td>{h[0]}</td><td>{h[1]}</td>"
            f"<td style='color:#34d399'>{h[2]}</td></tr>"
        )

    cmd_rows = ""
    for c in last_cmds:
        color = "#34d399" if c[1] == "COMPLETED" else "#fbbf24"
        cmd_rows += (
            f"<tr><td>{c[0]}</td>"
            f"<td style='color:{color}'>{c[1]}</td><td>{c[2]}</td></tr>"
        )

    if not machine_rows:
        machine_rows = "<tr><td colspan='5' style='color:#64748b'>No machines yet</td></tr>"
    if not hb_rows:
        hb_rows = "<tr><td colspan='3' style='color:#64748b'>No heartbeats yet</td></tr>"
    if not cmd_rows:
        cmd_rows = "<tr><td colspan='3' style='color:#64748b'>No commands yet</td></tr>"

    html = f"""<!DOCTYPE html>
<html><head>
<meta charset="utf-8"/>
<title>QB Agent Dashboard</title>
<style>
  body{{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px;margin:0}}
  h1{{color:#60a5fa;margin-bottom:4px}} .subtitle{{color:#64748b;font-size:13px;margin-bottom:24px}}
  .grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px}}
  .card{{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px}}
  .val{{font-size:32px;font-weight:700;color:#60a5fa}}
  .label{{color:#64748b;font-size:12px;margin-top:4px}}
  h2{{color:#94a3b8;font-size:13px;text-transform:uppercase;letter-spacing:.8px;margin:24px 0 12px;border-bottom:1px solid #334155;padding-bottom:8px}}
  table{{width:100%;border-collapse:collapse;font-size:13px}}
  th{{text-align:left;color:#64748b;padding:8px;border-bottom:1px solid #334155}}
  td{{padding:8px;border-bottom:1px solid #1e293b}}
  a{{color:#60a5fa}}
  .sheet-link{{margin-top:24px;padding:16px;background:#1e293b;border-radius:8px;border:1px solid #334155}}
  .sheet-link a{{font-size:14px;font-weight:600}}
  .sheet-link div{{color:#64748b;font-size:12px;margin-top:4px}}
</style>
</head><body>
<h1>QB Agent Dashboard</h1>
<div class="subtitle">Real QB Agent Server &mdash; {now_str} &mdash; <a href="{SHEET_URL}" target="_blank">Open Google Sheet</a></div>

<div class="grid">
  <div class="card"><div class="val">{hb_count}</div><div class="label">Total Heartbeats</div></div>
  <div class="card"><div class="val">{cmd_count}</div><div class="label">Commands Processed</div></div>
  <div class="card"><div class="val">{len(machines)}</div><div class="label">Machines Tracked</div></div>
</div>

<h2>Machines (Online / Offline)</h2>
<table>
  <tr><th>Machine</th><th>QB Status</th><th>Tailscale IP</th><th>Last Seen</th><th>Status</th></tr>
  {machine_rows}
</table>

<h2>Recent Heartbeats</h2>
<table>
  <tr><th>Timestamp</th><th>Machine</th><th>QB Status</th></tr>
  {hb_rows}
</table>

<h2>Recent Commands</h2>
<table>
  <tr><th>Command ID</th><th>Status</th><th>Completed At</th></tr>
  {cmd_rows}
</table>

<div class="sheet-link">
  <a href="{SHEET_URL}" target="_blank">Open Google Sheet: Bakudan QB Remote Ops Report</a>
  <div>Live data written by QB Agent heartbeat and command results</div>
</div>
</body></html>"""
    return html

# ── Run ──────────────────────────────────────────────────────────────────────
def run():
    ensure_sheet_tab()
    uvicorn.run(app, host="100.118.102.113", port=49300, log_level="warning")

if __name__ == "__main__":
    run()
