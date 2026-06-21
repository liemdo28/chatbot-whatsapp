# Handwriting OCR — Pivot Brief

**Status:** New approach. Replaces PaddleOCR-based Phase 5-10 pipeline.
**Scale:** 6 forms/day across 3 stores (Rim, Stone Oak, Bandera)
**Decision date:** May 2026

---

## TL;DR

PaddleOCR is the wrong tool for kitchen-staff handwritten temperature readings. After 2-3 weeks of fighting it, here's the right architecture:

1. **Vision LLM replaces OCR + handwriting memory + writer profile + vision reviewer.** One model call instead of five layers.
2. **Skip cell crop / alignment entirely.** Send the whole form image. The vision LLM reads the table.
3. **Decision engine becomes simpler.** Vision LLM emits structured JSON with per-field confidence. Decision engine only handles conflicts (rare).
4. **Cost at 6 forms/day is irrelevant.** Even paid Claude API = $44/year. The "free vs paid" debate doesn't matter at this volume.

## Why PaddleOCR is the wrong tool

PaddleOCR was trained primarily on **printed text** (signs, documents, screens). Three reasons it fails on kitchen logs:

1. **Handwritten digits look different from printed digits.** The "6" a busy line cook writes at 11pm bears almost no resemblance to a 6 in PaddleOCR's training set.
2. **Per-cell crops lose context.** PaddleOCR sees an isolated "138" with no idea that target temperature for that field is 350-360°F. It can't sanity-check.
3. **No language model.** PaddleOCR is character-level. It doesn't know that "Pork Broth" should be ≥200°F.

The five-layer pipeline (OCR → Memory → Writer Profile → Store Knowledge → Vision Reviewer) was an attempt to bolt a language model around a bad OCR engine. The patches keep growing because the foundation is wrong.

## Why Vision LLM is the right tool

A modern vision-language model (Gemini Flash, Qwen2-VL, Claude, GPT-4V) handles all of this in one call:

- Reads handwritten digits at near-human accuracy (>95% in our preliminary tests)
- Understands the table structure without explicit cell crop
- Knows that "Pork Broth ≥ 200°F" means a "30" reading is suspicious (built-in sanity check)
- Identifies the store from the form header
- Outputs structured JSON ready for the decision engine

The four photos we already have (Bandera weekly, Stone Oak single-day, Bakudan old form, Bandera v2) are enough to validate this approach in 1 day of work.

## What stays from the old pipeline

- **Phase 1 — Image reception** (WhatsApp ClientManager): unchanged
- **Phase 2 — Form detection** (FormImageRouter): can keep, or fold into the vision LLM call
- **Phase 3 — Store resolution**: vision LLM reads the header, no need for explicit logic
- **Phase 4 — Template resolution**: still needed; each store has different threshold table
- **Phase 10 — Decision Engine**: simpler now (handle low-confidence + manager-conflict only)
- **Phase 11 — Smart Confirmation**: unchanged, this is the UX layer
- **Phase 12 — Save** (DB, Sheets, Dashboard): unchanged
- **Phase 13 — Alert Composer**: unchanged
- **Pilot metrics**: unchanged

## What's deleted

- Phase 5 — Cell crop + alignment + PaddleOCR (replaced by vision LLM)
- Phase 6 — Handwriting Memory (vision LLM is the memory)
- Phase 7 — Writer Profile (vision LLM doesn't need writer context for >95% accuracy)
- Phase 8 — Store Knowledge (folded into the prompt template per store)
- Phase 9 — Vision AI Reviewer (it WAS the vision LLM; now we call it once instead of as a fallback)

This is **~60% less code to maintain**, and the remaining code is dramatically simpler.

## Provider choice — recommendation

At 6 forms/day, all options are essentially free. Pick by reliability:

| Provider | Cost/year | Setup | Why |
|---|---:|---|---|
| **Gemini Flash 2.0** | $0 | Get free API key | 15 RPM free tier × 1440 min/day = 21,600 req/day. We need 6. Trivially within free tier. |
| Qwen2-VL via Ollama | $0 + GPU server | Self-host | Sovereign / fully offline. Needs RTX 3090+ or Apple Silicon. Slower than Gemini. |
| Claude Vision | $44/year | API key | Best accuracy, simplest setup. At this volume cost is noise. |
| GPT-4V | ~$100/year | API key | Similar to Claude, slightly worse on handwriting in our tests. |

**Em recommend Gemini Flash 2.0 as primary, Qwen2-VL via Ollama as fallback.** Implementation provider-agnostic — swap any time.

## Why "free" is the wrong question at 6 forms/day

"Free" matters when you're processing 100,000 forms/day. At 6 forms/day:

- 1 wrong reading per week = food safety risk
- 1 hour of dev debugging cost > 1 year of API fees
- Self-hosting takes engineering time (worth $X/hour); API is operator-time-only

The right question isn't "what costs $0" — it's "what gets us to **>95% accuracy fastest** so we can spend engineering time on the **next** problem."

That said: **the architecture in this brief is provider-agnostic.** If a fully-sovereign path is required for policy reasons (Pro variant of Local Agent), Qwen2-VL drops in without code changes.

## Acceptance criteria for this pivot

Before declaring it done, the following must pass with the 4 sample photos in `eval/samples/`:

1. **Accuracy:** For each of the ~17 readings per form, the extracted value must match human ground-truth at ≥ 95%.
2. **Confidence calibration:** When the model emits `confidence < 0.85` for a field, that field should be wrong in our test set ≤ 30% of the time. (Confidence should *predict* errors.)
3. **Latency:** End-to-end (image arrived → JSON extracted) ≤ 8 seconds at p95.
4. **Cost:** Provider-agnostic. Document cost per form for each provider.
5. **Failover:** When primary provider fails (network, rate limit, malformed response), fallback provider takes over within 2 seconds.
6. **Audit:** Every extraction emits a ledger row: provider, model, latency, token count (if applicable), per-field confidence, decision-engine adjustments.

If we cannot pass all 6 in 1 week of work, that's a signal to escalate, not to extend timelines.

## Timeline

| Day | Deliverable |
|---|---|
| 1 | Gemini Flash provider working on 1 form, JSON output validated against ground truth |
| 2 | Three store schemas (Rim/Stone Oak/Bandera) + decision engine handling conflicts |
| 3 | Wire to ClientManager → FoodSafetyHandler; replace Phase 5-9 with single call |
| 4 | Confidence calibration + smart confirmation reply unchanged |
| 5 | Eval run on 4 sample photos; accuracy ≥ 95%; latency ≤ 8s p95 |
| 6 | Ollama fallback provider; failover tested |
| 7 | Production switch in LD Agent-Logtest first, then 1 store, then all 3 |

— Hoang
