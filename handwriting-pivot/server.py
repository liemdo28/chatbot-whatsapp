"""
Vision LLM HTTP Bridge Server
=============================
Receives form images via HTTP POST, runs FormPipeline, returns JSON.
Sits alongside PaddleOCR as a drop-in replacement.

Run:
    python server.py --port 5502

The Node.js gateway calls this via vision_llm_bridge.js.
"""
import argparse
import base64
import json
import os
import sys
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

# Add parent so imports work
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from code.pipeline import FormPipeline
from code.providers.gemini_flash import GeminiFlashProvider

pipeline = None


class VisionHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        # Accept both / and /extract
        global pipeline
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self._respond(400, {"error": "Invalid JSON"})
            return

        image_b64 = data.get('image_b64')
        group_name = data.get('group_name', '')
        if not image_b64:
            self._respond(400, {"error": "Missing image_b64"})
            return

        t0 = time.time()
        try:
            image_bytes = base64.b64decode(image_b64)
            result = pipeline.process(
                image_bytes=image_bytes,
                group_name=group_name,
            )
            elapsed = time.time() - t0

            response = {
                "success": result.extraction.ok and not result.extraction.error,
                "store": result.extraction.store,
                "date": result.extraction.date,
                "shift": result.extraction.shift,
                "selected_column": result.extraction.shift,
                "employee_name": result.extraction.employee_name,
                "overall_confidence": result.extraction.overall_confidence,
                "trace_id": result.trace_id,
                "latency_ms": result.total_latency_ms,
                "elapsed_s": round(elapsed, 2),
                "provider": result.extraction.provider,
                "model": result.extraction.model,
                "readings": [
                    {
                        "field_id": r.field_id,
                        "value": r.value,
                        "raw_text": r.raw_text,
                        "confidence": r.confidence,
                        "notes": r.notes,
                    }
                    for r in result.extraction.readings
                ],
                "reply_text": result.reply_text,
                "alert_text": result.alert_text,
                "items": [
                    {
                        "id": r.field_id,
                        "field_id": r.field_id,
                        "label": r.field_id,
                        "value": r.value,
                        "detectedValue": r.value,
                        "confidence": r.confidence,
                        "raw_text": r.raw_text,
                        "notes": r.notes,
                    }
                    for r in result.extraction.readings
                ],
            }
            if result.extraction.error:
                response["error"] = result.extraction.error

            self._respond(200, response)

        except Exception as e:
            elapsed = time.time() - t0
            self._respond(500, {
                "success": False,
                "error": str(e)[:500],
                "elapsed_s": round(elapsed, 2),
            })

    def do_GET(self):
        if self.path == '/health':
            self._respond(200, {"status": "ok", "provider": "gemini-flash"})
        else:
            self._respond(404, {"error": "Not found"})

    def _respond(self, code, data):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data, default=str).encode('utf-8'))


def main():
    global pipeline
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=5502)
    args = parser.parse_args()

    model = os.environ.get('VISION_LLM_MODEL', 'gemini-2.0-flash')
    primary = GeminiFlashProvider(model=model)

    # Optional Claude Vision fallback
    fallback = None
    if os.environ.get('CLAUDE_API_KEY') or os.environ.get('CLAUDE_BASE_URL'):
        try:
            from code.providers.claude_vision import ClaudeVisionProvider
            fallback = ClaudeVisionProvider()
            print(f"Claude Vision fallback configured (model={fallback.model})")
        except Exception as e:
            print(f"Warning: Could not load Claude Vision provider: {e}")

    pipeline = FormPipeline(primary=primary, fallback=fallback)
    print(f"Vision LLM Bridge running on port {args.port} (model={model}, fallback={'claude-vision' if fallback else 'none'})")
    server = HTTPServer(('127.0.0.1', args.port), VisionHandler)
    server.serve_forever()


if __name__ == '__main__':
    main()
