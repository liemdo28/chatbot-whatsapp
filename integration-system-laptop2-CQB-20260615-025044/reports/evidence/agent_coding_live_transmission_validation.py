from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[2]
DESKTOP_APP = ROOT / "desktop-app"
sys.path.insert(0, str(DESKTOP_APP))


class RecordingAgentCodingHandler(BaseHTTPRequestHandler):
    records: list[dict] = []
    command_served = False

    def log_message(self, *_args):  # keep validation output clean
        return

    def _record(self, method: str, body: dict | None = None):
        self.__class__.records.append({
            "method": method,
            "path": self.path,
            "headers": {
                "Authorization": self.headers.get("Authorization"),
                "X-Machine-ID": self.headers.get("X-Machine-ID"),
                "X-Agent-Version": self.headers.get("X-Agent-Version"),
                "Content-Type": self.headers.get("Content-Type"),
            },
            "body": body or {},
            "received_at": datetime.now(timezone.utc).isoformat(),
        })

    def _json(self, status: int, payload: dict | list):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        self._record("GET")
        if parsed.path == "/api/qb-agent/ping":
            self._json(200, {"ok": True, "pong": True})
            return
        if parsed.path == "/api/qb-agent/commands":
            if self.__class__.command_served:
                self._json(200, {"commands": []})
            else:
                self.__class__.command_served = True
                self._json(200, {
                    "commands": [{
                        "command_id": "deep-check-cmd-001",
                        "command_type": "TEST_QB_CONNECTION",
                        "payload_json": {"source": "deep_validation"},
                        "status": "PENDING",
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    }]
                })
            return
        self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", "0") or "0"))
        body = json.loads(raw.decode("utf-8")) if raw else {}
        self._record("POST", body)
        self._json(200, {"ok": True, "received": True})


def main() -> int:
    os.environ["AGENT_CODING_API_KEY"] = "deep-validation-key"

    with tempfile.TemporaryDirectory(prefix="agent-coding-deep-check-") as tmp:
        tmp_path = Path(tmp)
        config_path = tmp_path / "local-config.json"
        config_path.write_text(json.dumps({
            "machine": {
                "machine_id": "qb-laptop-deep-check-01",
                "machine_name": "QB Laptop Deep Check",
                "store_code": "bandera",
                "store_name": "Bakudan Bandera",
                "location": "Bandera",
            },
            "agent_coding": {
                "enabled": True,
                "base_url": "placeholder-overridden-by-test",
                "api_key_env": "AGENT_CODING_API_KEY",
                "poll_commands_seconds": 1,
                "heartbeat_seconds": 1,
                "timeout_seconds": 5,
            },
        }), encoding="utf-8")

        import services.machine_identity_service as mis
        import services.reporting_outbox as ro
        from services.agent_coding_client import AgentCodingClient
        from services.remote_command_client import RemoteCommandClient
        from services.reporting_outbox import ReportingOutbox

        mis.RUNTIME_DIR = tmp_path
        mis.LOCAL_CONFIG_PATH = config_path
        ro.OUTBOX_DIR = tmp_path / "reporting-outbox"

        server = ThreadingHTTPServer(("127.0.0.1", 0), RecordingAgentCodingHandler)
        port = server.server_address[1]
        base_url = f"http://127.0.0.1:{port}"
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        try:
            client = AgentCodingClient(base_url=base_url, timeout=5)
            command_client = RemoteCommandClient(base_url=base_url, poll_seconds=1)
            outbox = ReportingOutbox(outbox_dir=tmp_path / "outbox")

            operations = {
                "ping": client.ping(),
                "register": client.register(),
                "heartbeat": client.heartbeat(qb_status="QB_READY", agent_status="running"),
                "event": client.event("DEEP_VALIDATION_EVENT", {"ok": True}),
                "activity_log_result": client.activity_log_result(
                    business_date="2026-06-05",
                    status="PASS",
                    latest_sales_receipt_date="2026-06-05",
                    latest_sales_receipt_ref="SR-DEEP-001",
                    latest_sales_receipt_amount=123.45,
                    duration_ms=1234,
                ),
                "timeline_result": client.timeline_result(
                    business_date="2026-06-05",
                    events=[{
                        "event_key": "deep-event-001",
                        "event_type": "SALES_RECEIPT",
                        "action": "Created",
                        "amount": 123.45,
                    }],
                ),
                "sync_result": client.sync_result(
                    business_date="2026-06-05",
                    status="COMPLETED",
                    transactions_synced=1,
                    errors=[],
                ),
                "error_report": client.error_report(
                    severity="warning",
                    component="deep_validation",
                    message="synthetic warning",
                    exception="",
                ),
            }

            operations["remote_commands_processed"] = command_client.process_commands()

            outbox.enqueue({
                "method": "POST",
                "path": "/api/qb-agent/heartbeat",
                "payload": {"machine_id": "qb-laptop-deep-check-01", "qb_status": "OUTBOX_FLUSH"},
            })
            outbox.enqueue({
                "method": "POST",
                "path": "/api/qb-agent/activity-log-result",
                "payload": {"machine_id": "qb-laptop-deep-check-01", "status": "OUTBOX_FLUSH"},
            })
            sent, failed = outbox.flush(client=client)
            operations["outbox_sent"] = sent
            operations["outbox_failed"] = failed
            operations["outbox_remaining"] = outbox.count()

            required_paths = [
                "/api/qb-agent/ping",
                "/api/qb-agent/register",
                "/api/qb-agent/heartbeat",
                "/api/qb-agent/event",
                "/api/qb-agent/activity-log-result",
                "/api/qb-agent/timeline-result",
                "/api/qb-agent/sync-result",
                "/api/qb-agent/error",
                "/api/qb-agent/commands?machine_id=qb-laptop-deep-check-01",
                "/api/qb-agent/commands/deep-check-cmd-001/ack",
                "/api/qb-agent/commands/deep-check-cmd-001/result",
            ]

            seen_paths = [r["path"] for r in RecordingAgentCodingHandler.records]
            auth_failures = [
                r for r in RecordingAgentCodingHandler.records
                if r["path"] != "/api/qb-agent/ping"
                and r["headers"]["Authorization"] != "Bearer deep-validation-key"
            ]
            machine_header_failures = [
                r for r in RecordingAgentCodingHandler.records
                if r["path"] != "/api/qb-agent/ping"
                and r["headers"]["X-Machine-ID"] != "qb-laptop-deep-check-01"
            ]

            result = {
                "ok": (
                    all(bool(v) for k, v in operations.items() if k not in {"remote_commands_processed", "outbox_failed", "outbox_remaining"})
                    and operations["remote_commands_processed"] == 1
                    and operations["outbox_failed"] == 0
                    and operations["outbox_remaining"] == 0
                    and not auth_failures
                    and not machine_header_failures
                    and all(path in seen_paths for path in required_paths)
                ),
                "base_url": base_url,
                "operations": operations,
                "required_paths": required_paths,
                "seen_paths": seen_paths,
                "auth_failures": auth_failures,
                "machine_header_failures": machine_header_failures,
                "records": RecordingAgentCodingHandler.records,
                "validated_at": datetime.now(timezone.utc).isoformat(),
            }
        finally:
            server.shutdown()
            server.server_close()

    out_path = Path(__file__).with_name("agent_coding_live_transmission_result.json")
    out_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
