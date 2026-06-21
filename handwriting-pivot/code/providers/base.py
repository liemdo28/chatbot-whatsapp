"""
VisionProvider — provider-agnostic interface for vision LLM form extraction.

Any provider (Gemini Flash, Qwen2-VL via Ollama, Claude, GPT-4V) implements
the same interface. The extractor doesn't care which one runs underneath.

Why this design:
  - Swap providers without touching pipeline code
  - Run multiple providers in parallel for cross-check
  - Failover when primary is down (rate limit, network, malformed response)
  - Sovereignty: switch to local-only Ollama in 1 config change
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional, Protocol
import time


@dataclass
class FieldReading:
    """One cell on the form, for one shift."""
    field_id: str              # e.g., "WALK_IN_FREEZER", "FRYER_1"
    value: Optional[float]      # the temperature for this shift, or None if illegible
    raw_text: str              # what the model literally saw
    confidence: float          # 0.0-1.0; the model's own confidence
    notes: str = ""            # model commentary (e.g., "smudged", "crossed out")
    # Two-shift support: if value_4pm is non-null, this reading has two shifts
    shift: str = "10AM"        # which shift this value belongs to: "10AM" or "4PM"
    value_4pm: Optional[float] = None  # value for 4PM shift (if model returned both)
    raw_text_4pm: str = ""
    confidence_4pm: float = 0.0


@dataclass
class FormExtraction:
    """Result of extracting one whole form image."""
    store: Optional[str]                    # "Bandera Road" | "Stone Oak" | "Rim" | None
    date: Optional[str]                     # ISO 8601 or null if illegible
    shift: Optional[str]                    # "Open" | "Mid" | "Late" | None
    employee_name: Optional[str]
    readings: list[FieldReading] = field(default_factory=list)

    # Provider metadata
    provider: str = ""
    model: str = ""
    latency_ms: int = 0
    overall_confidence: float = 0.0
    raw_response: str = ""                  # for audit/debugging
    error: Optional[str] = None             # if extraction failed entirely

    @property
    def ok(self) -> bool:
        return self.error is None and self.store is not None

    def low_confidence_fields(self, threshold: float = 0.85) -> list[FieldReading]:
        return [r for r in self.readings if r.confidence < threshold]

    def to_dict(self) -> dict:
        return {
            "store": self.store,
            "date": self.date,
            "shift": self.shift,
            "employee_name": self.employee_name,
            "readings": [
                {
                    "field_id": r.field_id,
                    "value": r.value,
                    "raw_text": r.raw_text,
                    "confidence": r.confidence,
                    "notes": r.notes,
                    "shift": r.shift,
                    "value_4pm": r.value_4pm,
                    "raw_text_4pm": r.raw_text_4pm,
                    "confidence_4pm": r.confidence_4pm,
                }
                for r in self.readings
            ],
            "provider": self.provider,
            "model": self.model,
            "latency_ms": self.latency_ms,
            "overall_confidence": self.overall_confidence,
            "ok": self.ok,
            "error": self.error,
        }


class VisionProvider(Protocol):
    """Provider interface. Implement this for each vendor."""

    name: str       # 'gemini-flash', 'ollama-qwen2-vl', 'claude', 'gpt-4v'
    cost_per_form_usd: float

    def extract(self, image_bytes: bytes, prompt: str, schema: dict) -> FormExtraction:
        """
        Send image + prompt + JSON schema to the vision model.
        Returns FormExtraction. Always returns a result — never raises.
        Failures are surfaced via FormExtraction.error.
        """
        ...


class TimingMixin:
    """Helper for providers to measure latency consistently."""

    def _timed(self, fn):
        t0 = time.perf_counter()
        try:
            result = fn()
            return result
        finally:
            self._last_latency_ms = int((time.perf_counter() - t0) * 1000)
