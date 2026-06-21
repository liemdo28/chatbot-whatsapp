# Setup Guide

## Day 1: Run the demo (5 minutes)

No API key needed. Uses the mock provider to prove the pipeline works:

```bash
cd handwriting-pivot
python3 -m unittest tests.test_pipeline -v   # → 21/21 pass
python3 demo.py                              # → see 3 WhatsApp scenarios
```

## Day 1 — Gemini Flash setup (free tier, ~10 minutes)

1. **Get a free API key:**
   - Visit https://aistudio.google.com/apikey
   - Sign in with Google account
   - Click "Create API key" → copy it
   - Free tier: 15 requests/minute, 1,500/day. Plenty for 6 forms/day.

2. **Install + configure:**
   ```bash
   pip install google-generativeai
   export GEMINI_API_KEY=your-key-here
   ```

3. **Quick smoke test with a real form image:**
   ```python
   from code.pipeline import FormPipeline
   from code.providers.gemini_flash import GeminiFlashProvider

   with open("/path/to/stone-oak-form.jpg", "rb") as f:
       img = f.read()

   pipeline = FormPipeline(primary=GeminiFlashProvider())
   result = pipeline.process(image_bytes=img, group_name="B2 Kitchen Log")

   print(result.reply_text)
   if result.alert_text:
       print("\n---\n", result.alert_text)
   ```

   Expected: takes ~2 seconds. Returns a real WhatsApp-ready reply.

## Day 2 — Wire into FoodSafetyHandler

Replace the old Phase 5-9 pipeline call site. The new entry point is one call:

```python
# OLD (5 layers of code):
#   cells = cell_crop_and_align(image)
#   ocr_text = paddle_ocr(cells)
#   memory = handwriting_memory.lookup(ocr_text, writer, store)
#   profile = writer_profile.score(memory, writer)
#   store_knowledge.validate(profile, store)
#   if uncertain: vision_reviewer.review(image, memory)
#   decision = decision_engine.decide(...)

# NEW (one call):
result = pipeline.process(image_bytes=image, group_name=group_name)
client.send_message(group_name, result.reply_text)
if result.alert_text:
    client.send_message(MANAGEMENT_GROUP, result.alert_text)
audit_db.insert(result.trace_id, result.extraction.to_dict())
```

## Day 3 — Optional: add Ollama fallback (sovereign mode)

Useful if Gemini rate-limits or for Local Agent Pro variant where no data
can leave the network.

1. Install Ollama: https://ollama.com
2. Pull the model: `ollama pull qwen2-vl:7b` (or `qwen2-vl:2b` for weaker GPU)
3. Configure pipeline with fallback:

   ```python
   from code.providers.gemini_flash import GeminiFlashProvider
   from code.providers.ollama_qwen_vl import OllamaQwen2VLProvider

   pipeline = FormPipeline(
       primary=GeminiFlashProvider(),
       fallback=OllamaQwen2VLProvider(host="http://your-ollama-host:11434"),
   )
   ```

   When Gemini fails (rate limit, network), Ollama takes over within 2 sec.

## Day 4 — Calibrate confidence threshold

The default review threshold is 0.85. Run real forms for a week, then:
- If too many things flagged as "needs review" → raise to 0.90
- If FAILs slip through with high confidence → lower to 0.80
- The file is `code/decision_engine.py`, constant `CONFIDENCE_REVIEW_THRESHOLD`

## Cost ceiling

At 6 forms/day on Gemini Flash 2.0:
- 6 × 30 = 180 forms/month
- Free tier covers 45,000 requests/month (1,500/day × 30)
- We use 0.4% of quota → no budget concern

If volume scales to 100 forms/day:
- 3,000 forms/month
- Still 6.7% of free quota
- Still $0

If volume reaches 1,500/day (free-tier ceiling):
- Switch to paid Gemini ($0.00010 per image) → ~$45/month
- Or self-host Ollama for $0 marginal cost

## Files

```
handwriting-pivot/
├── docs/
│   └── 00-PIVOT_BRIEF.md     # The "why" doc, for dev team and CEO
├── code/
│   ├── pipeline.py            # Top-level entry point
│   ├── decision_engine.py     # Replaces old Phase 10
│   ├── reply.py               # Replaces old Phase 11
│   ├── prompts.py             # Builds store-specific prompts
│   ├── providers/
│   │   ├── base.py            # Provider-agnostic interface
│   │   ├── gemini_flash.py    # Free tier primary
│   │   └── ollama_qwen_vl.py  # Sovereign fallback
│   └── schemas/
│       └── stores.py          # Bandera/Stone Oak/Rim field definitions
├── tests/
│   └── test_pipeline.py       # 21 unit tests, all passing
├── demo.py                    # Run-this-first demo script
└── docs/02-SETUP.md           # This file
```

## What to do next

1. **Get a real form photo** (any of the 4 we already have from prior work).
2. Run it through `GeminiFlashProvider` once. Inspect the output.
3. If accuracy < 95% on the readings:
   - Check the prompt — maybe add a store-specific example
   - Try `gemini-2.0-flash-thinking-exp` (slower but more accurate)
   - Try Claude Vision as a third provider — drop-in implementation
4. If accuracy ≥ 95%: wire to ClientManager, ship to LD Agent-Logtest group,
   collect 1 week of real-world data, calibrate confidence threshold.

5. Replace the old PaddleOCR-based pipeline. Don't run them in parallel —
   one source of truth.
