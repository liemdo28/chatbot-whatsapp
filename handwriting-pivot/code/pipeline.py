"""
Top-level pipeline — replaces Phase 5-11 of the old architecture.

Usage:
    from pipeline import FormPipeline
    from providers.gemini_flash import GeminiFlashProvider
    from providers.ollama_qwen_vl import OllamaQwen2VLProvider

    pipeline = FormPipeline(
        primary=GeminiFlashProvider(),
        fallback=OllamaQwen2VLProvider(),
    )

    result = pipeline.process(image_bytes=img, group_name="B2 Kitchen Log")
    # result has: extraction, decision, reply_text, alert_text

Integration point:
    FoodSafetyHandler in the WhatsApp bot calls pipeline.process() and posts
    result.reply_text back to the group. If result.alert_text is non-None,
    also post that to the Management Group.
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Optional
import time
import uuid

from .providers.base import VisionProvider, FormExtraction
from .schemas.stores import resolve_store, StoreSchema
from .prompts import build_prompt, build_json_schema
from .decision_engine import decide, FormDecision
from .reply import build_confirmation_reply, build_alert_message


def _select_column(extraction: FormExtraction) -> Optional[str]:
    """
    Column selection rule:
      - Only 10AM data present → "10AM"
      - Only 4PM data present  → "4PM"
      - Both present           → "4PM" (prefer the later shift)
      - Neither present        → None
    """
    has_10am = any(r.value is not None for r in extraction.readings if r.shift == "10AM")
    has_4pm = any(r.value is not None for r in extraction.readings if r.value_4pm is not None)
    # Also check if readings have 4PM data via value_4pm field
    if not has_4pm:
        has_4pm = any(r.value_4pm is not None for r in extraction.readings)
    # If shift is already "4PM" on individual readings, those are 4PM values
    if not has_4pm:
        has_4pm = any(r.shift == "4PM" and r.value is not None for r in extraction.readings)

    if has_10am and has_4pm:
        return "4PM"  # both → prefer 4PM
    if has_4pm:
        return "4PM"
    if has_10am:
        return "10AM"
    return None


@dataclass
class PipelineResult:
    trace_id: str
    extraction: FormExtraction
    decision: Optional[FormDecision]
    reply_text: str
    alert_text: Optional[str]
    total_latency_ms: int
    used_fallback: bool = False


class FormPipeline:
    """Vision LLM + decision engine + reply builder. Provider-agnostic."""

    def __init__(
        self,
        primary: VisionProvider,
        fallback: Optional[VisionProvider] = None,
        on_audit=None,
    ):
        self.primary = primary
        self.fallback = fallback
        self.on_audit = on_audit  # callable(audit_event_dict) — optional sink

    def process(
        self,
        *,
        image_bytes: bytes,
        group_name: Optional[str] = None,
    ) -> PipelineResult:
        """
        Main entry point. Takes an image; returns processed result.

        Steps:
            1. Resolve store (from group name initially; refined by header later)
            2. Build store-specific prompt + schema
            3. Call primary provider; on failure, fallback
            4. Refine store from extracted header (vision sees more than group does)
            5. Decision engine
            6. Build reply + alert messages
        """
        trace_id = f"form-{uuid.uuid4().hex[:8]}"
        t_start = time.perf_counter()

        # Step 1: tentative store resolution from group
        store_schema = resolve_store(group_name=group_name) if group_name else None
        tentative = store_schema is None
        # P0 FIX: No Bandera fallback. If group doesn't resolve, we use a
        # generic prompt (all 3 stores) and rely on Step 4 header detection.
        # Defaulting to Bandera caused wrong field IDs and thresholds for
        # non-Bandera stores (e.g., LD Agent-Logtest).
        if store_schema is None:
            from .schemas.stores import BANDERA, STONE_OAK, RIM
            # Build a merged schema for prompt building only — header will refine
            all_fields = BANDERA.fields  # same 19 fields across all stores
            store_schema = StoreSchema(
                store_name="(auto-detect)",
                store_code="AUTO",
                whatsapp_group=group_name or "",
                template_version="v3",
                fields=all_fields,
            )

        # Step 2: build prompt
        prompt = build_prompt(store_schema)
        json_schema = build_json_schema(store_schema)

        # Step 3: extract via primary; failover to fallback if available
        used_fallback = False
        extraction = self.primary.extract(image_bytes, prompt, json_schema)

        if not extraction.ok and self.fallback is not None:
            self._emit_audit({
                "trace_id": trace_id,
                "event": "primary_failed",
                "provider": self.primary.name,
                "error": extraction.error,
            })
            used_fallback = True
            extraction = self.fallback.extract(image_bytes, prompt, json_schema)

        # Step 4: Re-resolve store from the header the vision LLM read
        if extraction.store:
            verified_schema = resolve_store(header_text=extraction.store)
            if verified_schema is not None and verified_schema.store_code != store_schema.store_code:
                # The form was submitted to wrong group, or initial guess was wrong.
                # Re-run extraction with the correct schema. Worth the cost at 6 forms/day.
                self._emit_audit({
                    "trace_id": trace_id,
                    "event": "schema_corrected",
                    "from": store_schema.store_code,
                    "to": verified_schema.store_code,
                })
                store_schema = verified_schema
                prompt = build_prompt(store_schema)
                json_schema = build_json_schema(store_schema)
                extraction = (self.fallback or self.primary).extract(image_bytes, prompt, json_schema)
                tentative = False  # header resolved it
            elif verified_schema is None and tentative:
                # Group didn't resolve AND header didn't match any known store.
                # Do NOT proceed with the fallback Bandera schema — the field IDs
                # and thresholds would be wrong. Return error instead.
                self._emit_audit({
                    "trace_id": trace_id,
                    "event": "store_unresolved",
                    "group": group_name,
                    "header": extraction.store,
                })
                total_ms = int((time.perf_counter() - t_start) * 1000)
                return PipelineResult(
                    trace_id=trace_id,
                    extraction=extraction,
                    decision=None,
                    reply_text=(
                        f"⚠ Could not identify store from this form (trace {trace_id}).\n"
                        f"Group: {group_name or '(none)'} | Header read: {extraction.store}\n\n"
                        f"Please make sure the store name is visible at the top of the form, "
                        f"or reply *MANUAL* to type in the values with the store name."
                    ),
                    alert_text=None,
                    total_latency_ms=total_ms,
                    used_fallback=used_fallback,
                )
            else:
                tentative = False  # header confirmed or group was fine

        # Step 5: column selection + value swap
        # Rule: only 10AM → 10AM, only 4PM → 4PM, both → 4PM
        selected_column = _select_column(extraction)
        extraction.shift = selected_column

        # Step 5b: if 4PM selected, swap value_4pm/raw_text_4pm/confidence_4pm
        # into primary fields so the decision engine reads the correct shift.
        if selected_column == "4PM":
            for r in extraction.readings:
                if r.value_4pm is not None:
                    r.value = r.value_4pm
                    r.raw_text = r.raw_text_4pm or r.raw_text
                    # NOTE: confidence_4pm can be 0.0 (legitimate low confidence),
                    # so we must NOT use `or` which treats 0.0 as falsy.
                    # Use the 4PM confidence if it was explicitly set (> 0).
                    r.confidence = r.confidence_4pm if r.confidence_4pm > 0 else r.confidence
                # If value_4pm is None but we picked 4PM, mark as MISSING
                # (the 4PM column has no data for this field)
                elif r.shift == "10AM" and r.value is not None:
                    # Had 10AM value but no 4PM — clear it so decision engine
                    # treats this field as missing for the 4PM shift
                    r.value = None
                    r.raw_text = ""
                    r.confidence = 0.0
                    r.notes = "No 4PM reading available"

        # Step 6: decision engine
        decision = None
        if extraction.ok:
            decision = decide(extraction, store_schema)

        # Step 6: reply + alert
        if decision is not None:
            reply_text = build_confirmation_reply(decision)
            alert_text = build_alert_message(decision)
        else:
            reply_text = self._build_error_reply(extraction, trace_id)
            alert_text = None

        total_ms = int((time.perf_counter() - t_start) * 1000)

        self._emit_audit({
            "trace_id": trace_id,
            "event": "form_processed",
            "store": extraction.store,
            "provider": extraction.provider,
            "model": extraction.model,
            "used_fallback": used_fallback,
            "provider_latency_ms": extraction.latency_ms,
            "total_latency_ms": total_ms,
            "ok": extraction.ok,
            "n_readings": len(extraction.readings),
            "overall_confidence": extraction.overall_confidence,
            "needs_review": decision.needs_human_review if decision else None,
            "n_fails": len(decision.fails) if decision else None,
        })

        return PipelineResult(
            trace_id=trace_id,
            extraction=extraction,
            decision=decision,
            reply_text=reply_text,
            alert_text=alert_text,
            total_latency_ms=total_ms,
            used_fallback=used_fallback,
        )

    def _build_error_reply(self, extraction: FormExtraction, trace_id: str) -> str:
        return (
            f"⚠ I couldn't read this form (trace {trace_id}).\n"
            f"Error: {extraction.error or 'unknown'}\n\n"
            f"Please retake the photo or reply *MANUAL* to type in the values."
        )

    def _emit_audit(self, event: dict):
        if self.on_audit:
            try:
                self.on_audit(event)
            except Exception:
                pass  # audit must never break the pipeline
