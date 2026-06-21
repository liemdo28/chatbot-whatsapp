"""
Tailscale real-world validation server.
Runs on port 49275 (the Tailscale-allocated port on liemdo-pc).
Validates: QB Agent → Agent-Coding (heartbeat), Agent-Coding → QB Agent (command/result).
"""
from __future__ import annotations
import json
import threading
import time
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

# outbox file deferred (optional persistence)

# ── In-memory state ──────────────────────────────────────────────────────────
last_heartbeat = None
last_command_id = None
command_result_received = None

# ── QB Agent → Agent-Coding (heartbeat endpoint) ─────────────────────────────
class QBAgentHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        print(f"[{ts}] {self.address_string()} {fmt % args}")

    def send_json(self, status: int, data: dict):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type,Authorization")
        self.end_headers()

    # ── QB Agent → Agent-Coding ────────────────────────────────────────────────
    def do_POST__heartbeat(self):
        global last_heartbeat
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode() if length else "{}"
        try:
            payload = json.loads(body)
        except Exception:
            payload = {}
        last_heartbeat = {
            "received_at": datetime.now(timezone.utc).isoformat(),
            "from_ip": self.address_string(),
            "payload": payload,
        }
        self.send_json(200, {"ok": True, "received": True})

    def do_POST__activity_log_result(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode() if length else "{}"
        try:
            payload = json.loads(body)
        except Exception:
            payload = {}
        self.send_json(200, {"ok": True})

    def do_POST__sync_result(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode() if length else "{}"
        try:
            payload = json.loads(body)
        except Exception:
            payload = {}
        self.send_json(200, {"ok": True})

    # ── Agent-Coding → QB Agent (command poll) ─────────────────────────────────
    def do_GET__commands(self):
        global last_command_id
        # Return a test command
        cmd = {
            "command_id": f"test-cmd-{int(time.time())}",
            "command_type": "TEST_QB_CONNECTION",
            "payload": {"test": True, "timestamp": datetime.now(timezone.utc).isoformat()},
            "status": "PENDING",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        last_command_id = cmd["command_id"]
        self.send_json(200, {"commands": [cmd]})

    # ── Agent-Coding → QB Agent (result return) ────────────────────────────────
    def do_POST__commands_ack(self):
        global command_result_received
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode() if length else "{}"
        try:
            payload = json.loads(body)
        except Exception:
            payload = {}
        command_result_received = {
            "received_at": datetime.now(timezone.utc).isoformat(),
            "payload": payload,
        }
        self.send_json(200, {"ok": True, "acknowledged": True})

    # ── Status ────────────────────────────────────────────────────────────────
    def do_GET__status(self):
        global last_heartbeat, last_command_id, command_result_received
        self.send_json(200, {
            "server": "Tailscale QB Agent Validation Server",
                       "port": 49299,
            "network": "Tailscale",
            "machine": "liemdo-pc",
            "tailnet_addr": "100.118.102.113",
            "last_heartbeat": last_heartbeat,
            "last_command_id": last_command_id,
            "command_result_received": command_result_received,
            "uptime": "server_running",
        })

    def do_POST(self):
        path = self.path.rstrip("/")
        if path == "/api/qb-agent/heartbeat":
            self.do_POST__heartbeat()
        elif path == "/api/qb-agent/activity-log-result":
            self.do_POST__activity_log_result()
        elif path == "/api/qb-agent/sync-result":
            self.do_POST__sync_result()
        elif path == "/api/qb-agent/commands/ack":
            self.do_POST__commands_ack()
        else:
            self.send_json(404, {"error": f"Unknown path: {path}"})

    def do_GET(self):
        path = self.path.rstrip("/")
        if path == "/api/qb-agent/commands":
            self.do_GET__commands()
        elif path == "/api/qb-agent/status":
            self.do_GET__status()
        else:
            self.send_json(404, {"error": f"Unknown path: {path}"})


def run():
    # Bind to Tailscale IP on port 49275
    host = "100.118.102.113"
    port = 49299
    server = HTTPServer((host, port), QBAgentHandler)
    print(f"Tailscale QB Agent Validation Server")
    print(f" Listening on: http://{host}:{port}")
    print(f"  Endpoints:")
    print(" POST /api/qb-agent/heartbeat        [QB Agent sends heartbeat]")
    print("    POST /api/qb-agent/activity-log-result")
    print("    POST /api/qb-agent/sync-result")
    print("    GET  /api/qb-agent/commands         [Agent-Coding polls for commands]")
    print("    POST /api/qb-agent/commands/ack     [Agent-Coding posts result]")
    print("    GET  /api/qb-agent/status           [Status check]")
    print(" Outbox: in-memory only (no file write)")
    print(f"  Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Shutting down...")
        server.shutdown()


if __name__ == "__main__":
    run()
