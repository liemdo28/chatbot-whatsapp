"""
ClaudeVisionProvider — Claude Vision via OpenAI-compatible endpoint.

Uses the opusmax.shop proxy to call Claude Opus 4.7 for vision extraction.
Provider-agnostic: implements the same VisionProvider interface as Gemini.

Setup:
  1. Set env: CLAUDE_API_KEY (from .env OPENAI_API_KEY)
  2. Set env: CLAUDE_BASE_URL (defaults to opusmax.shop/v1)
  3. pip install openai (already installed in production)
"""

from __future__ import annotations
import base64
import json
import os
import time
from typing import Optional

from .base import FormExtraction, FieldReading


class ClaudeVisionProvider:
    name = "claude-vision"
    cost_per_form_usd = 0.005  # ~$0.005 per image on proxy

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: str = "claude-opus-4-7",
    ):
        self.api_key = api_key or os.environ.get("CLAUDE_API_KEY")
        if not self.api_key:
            raise ValueError("CLAUDE_API_KEY not set")
        self.base_url = base_url or os.environ.get(
            "CLAUDE_BASE_URL", "https://opusmax.shop/v1"
        )
        self.model = model
        self._client = None

    def _ensure_client(self):
        if self._client is None:
            from openai import OpenAI
            self._client = OpenAI(
                api_key=self.api_key,
                base_url=self.base_url,
            )
        return self._client

    def extract(
        self,
        image_bytes: bytes,
        prompt: str,
        schema: dict,
    ) -> FormExtraction:
        """Extract form readings from image using Claude Vision."""
        t0 = time.perf_counter()
        result = FormExtraction(
            store=None, date=None, shift=None, employee_name=None,
            provider=self.name,
            model=self.model,
        )

        try:
            client = self._ensure_client()

            img_b64 = base64.b64encode(self._compress_image(image_bytes)).decode("utf-8")
            data_url = f"data:image/jpeg;base64,{img_b64}"
            messages = [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": data_url},
                        },
                        {
                            "type": "text",
                            "text": f"{prompt}\n\nIMPORTANT: Output ONLY valid JSON matching this schema exactly. No markdown, no explanation, no fences.",
                        },
                    ],
                }
            ]

            response = client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0.0,
                max_tokens=4096,
            )

            result.latency_ms = int((time.perf_counter() - t0) * 1000)
            raw = response.choices[0].message.content.strip()
            result.raw_response = raw

            # Strip markdown fences if present
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3]
            raw = raw.strip()

            data = json.loads(raw)
            self._populate_extraction(result, data)

        except json.JSONDecodeError as e:
            result.error = f"json_decode: {e}"
            result.latency_ms = int((time.perf_counter() - t0) * 1000)
        except Exception as e:
            result.error = f"{type(e).__name__}: {str(e)[:300]}"
            result.latency_ms = int((time.perf_counter() - t0) * 1000)

        return result

    @staticmethod
    def _compress_image(image_bytes: bytes, max_width: int = 1024, quality: int = 85) -> bytes:
        """Compress image if >200KB for faster API upload."""
        if len(image_bytes) <= 200 * 1024:
            return image_bytes
        try:
            from PIL import Image
            import io
            img = Image.open(io.BytesIO(image_bytes))
            ratio = max_width / img.width if img.width > max_width else 1.0
            new_size = (int(img.width * ratio), int(img.height * ratio))
            resized = img.resize(new_size, Image.LANCZOS)
            buf = io.BytesIO()
            resized.save(buf, format='JPEG', quality=quality, optimize=True)
            return buf.getvalue()
        except Exception:
            return image_bytes

    @staticmethod
    def _populate_extraction(result: FormExtraction, data: dict):
        """Unpack model JSON into the structured result object."""
        result.store = data.get("store")
        result.date = data.get("date")
        result.employee_name = data.get("employee_name_10am") or data.get("employee_name")

        readings_raw = data.get("readings") or []
        SKIP_KEYS = {"store", "date", "employee_name_10am", "employee_name_4pm", "employee_name", "overall_confidence", "readings"}

        fields_found = {}

        if isinstance(readings_raw, dict):
            fields_found.update(readings_raw)
        elif isinstance(readings_raw, list):
            for r in readings_raw:
                if isinstance(r, dict) and "field_id" in r:
                    fields_found[r["field_id"]] = r

        for k, v in data.items():
            if k not in SKIP_KEYS and isinstance(v, dict) and "value" in v:
                if k not in fields_found:
                    fields_found[k] = v

        for field_id, r in fields_found.items():
            if not isinstance(r, dict):
                continue
            try:
                # Two-shift format
                v_10am = r.get("v_10am")
                v_4pm = r.get("v_4pm")
                conf_10am = float(r.get("confidence_10am") or r.get("confidence") or 0.0)
                conf_4pm = float(r.get("confidence_4pm") or 0.0)
                raw_10am = str(r.get("raw_text_10am") or r.get("raw_text") or "")
                raw_4pm = str(r.get("raw_text_4pm") or "")

                if v_10am is not None and v_10am != "":
                    v_10am = float(v_10am)
                else:
                    v_10am = None
                if v_4pm is not None and v_4pm != "":
                    v_4pm = float(v_4pm)
                else:
                    v_4pm = None

                # Legacy single-value
                legacy_val = r.get("value")
                legacy_conf = float(r.get("confidence") or 0.0)
                legacy_raw = str(r.get("raw_text") or "")

                if v_10am is not None or v_4pm is not None:
                    result.readings.append(FieldReading(
                        field_id=str(field_id),
                        value=v_10am,
                        raw_text=raw_10am,
                        confidence=conf_10am,
                        notes=str(r.get("notes") or ""),
                        shift="10AM",
                        value_4pm=v_4pm,
                        raw_text_4pm=raw_4pm,
                        confidence_4pm=conf_4pm,
                    ))
                elif legacy_val is not None and legacy_val != "":
                    result.readings.append(FieldReading(
                        field_id=str(field_id),
                        value=float(legacy_val),
                        raw_text=legacy_raw,
                        confidence=legacy_conf,
                        notes=str(r.get("notes") or ""),
                        shift="10AM",
                    ))
            except (KeyError, TypeError, ValueError):
                continue
