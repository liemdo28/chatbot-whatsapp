"""
OllamaQwen2VLProvider — Self-hosted Qwen2-VL via Ollama.

Why this option:
  - Fully sovereign — no data leaves the machine
  - Free marginal cost (after hardware investment)
  - Aligned with Local Agent Pro architecture (offline-only)

Hardware requirements:
  - Qwen2-VL 7B: ~16GB VRAM (RTX 4080+, Mac M2+ with 32GB RAM)
  - Qwen2-VL 2B: ~6GB VRAM (RTX 3060+, Mac M1+)

Setup:
  1. Install Ollama: https://ollama.com
  2. Pull model: `ollama pull qwen2-vl:7b`  (or qwen2-vl:2b for lower-end hardware)
  3. Verify: `ollama list | grep qwen2-vl`
  4. Configure: OLLAMA_HOST=http://127.0.0.1:11434 (default)

Trade-offs vs Gemini Flash:
  - Latency: 3-10s per image (vs 1-3s for Gemini)
  - Accuracy: ~90-93% on handwriting (vs 95%+ for Gemini)
  - Reliability: depends on your hardware uptime
  - Privacy: 100% local
"""

from __future__ import annotations
import base64
import json
import os
import time
from typing import Optional
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

from .base import FormExtraction, FieldReading


class OllamaQwen2VLProvider:
    name = "ollama-qwen2-vl"
    cost_per_form_usd = 0.0   # self-hosted
    DEFAULT_MODEL = "qwen2-vl:7b"
    DEFAULT_HOST = "http://127.0.0.1:11434"

    def __init__(
        self,
        host: Optional[str] = None,
        model: str = DEFAULT_MODEL,
        timeout_sec: int = 60,
    ):
        self.host = (host or os.environ.get("OLLAMA_HOST") or self.DEFAULT_HOST).rstrip("/")
        self.model = model
        self.timeout_sec = timeout_sec

    def extract(
        self,
        image_bytes: bytes,
        prompt: str,
        schema: dict,
    ) -> FormExtraction:
        """Extract form readings via Ollama. Always returns FormExtraction."""
        t0 = time.perf_counter()
        result = FormExtraction(
            store=None, date=None, shift=None, employee_name=None,
            provider=self.name,
            model=self.model,
        )

        # Construct the prompt with schema embedded — Ollama doesn't have
        # structured-output mode like Gemini, so we instruct via prompt.
        full_prompt = (
            prompt
            + "\n\n"
            + "Respond with ONLY a JSON object matching this schema. "
            + "No markdown fences, no commentary, no explanation. Just JSON:\n\n"
            + json.dumps(schema, indent=2)
        )

        # Encode image as base64 for Ollama's /api/generate endpoint
        b64 = base64.b64encode(image_bytes).decode("ascii")

        body = json.dumps({
            "model": self.model,
            "prompt": full_prompt,
            "images": [b64],
            "stream": False,
            "format": "json",   # Ollama JSON mode — best-effort
            "options": {
                "temperature": 0.0,
                "num_predict": 4096,
            },
        }).encode("utf-8")

        req = Request(
            f"{self.host}/api/generate",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urlopen(req, timeout=self.timeout_sec) as resp:
                raw = resp.read().decode("utf-8")

            result.latency_ms = int((time.perf_counter() - t0) * 1000)
            ollama_resp = json.loads(raw)
            response_text = ollama_resp.get("response", "")
            result.raw_response = response_text

            # Strip possible markdown fences if Qwen ignored "no markdown"
            cleaned = response_text.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("```", 2)[1]
                if cleaned.startswith("json"):
                    cleaned = cleaned[4:]
                cleaned = cleaned.rsplit("```", 1)[0].strip()

            data = json.loads(cleaned)
            self._populate_extraction(result, data)

        except HTTPError as e:
            result.error = f"http_{e.code}: {str(e)[:200]}"
            result.latency_ms = int((time.perf_counter() - t0) * 1000)
        except URLError as e:
            result.error = f"ollama_unreachable: {str(e.reason)[:200]}"
            result.latency_ms = int((time.perf_counter() - t0) * 1000)
        except json.JSONDecodeError as e:
            result.error = f"json_decode: {str(e)[:200]}"
            result.latency_ms = int((time.perf_counter() - t0) * 1000)
        except Exception as e:
            result.error = f"{type(e).__name__}: {str(e)[:300]}"
            result.latency_ms = int((time.perf_counter() - t0) * 1000)

        return result

    @staticmethod
    def _populate_extraction(result: FormExtraction, data: dict):
        result.store = data.get("store")
        result.date = data.get("date")
        result.shift = data.get("shift")
        result.employee_name = data.get("employee_name")
        result.overall_confidence = float(data.get("overall_confidence") or 0.0)

        for r in (data.get("readings") or []):
            try:
                value = r.get("value")
                if value is not None and value != "":
                    value = float(value)
                else:
                    value = None
                result.readings.append(FieldReading(
                    field_id=str(r["field_id"]),
                    value=value,
                    raw_text=str(r.get("raw_text") or ""),
                    confidence=float(r.get("confidence") or 0.0),
                    notes=str(r.get("notes") or ""),
                ))
            except (KeyError, TypeError, ValueError):
                continue
