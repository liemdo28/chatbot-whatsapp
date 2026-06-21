# D5 Pilot Runbook — Bandera Road (B3)

**Target:** 24h live pilot at Bandera Road
**Status:** Ready to execute

---

## Pre-flight Checklist

- [ ] Vision LLM server running on port 5502
- [ ] `USE_VISION_LLM_PIPELINE=true` in .env
- [ ] Gateway restarted (node src/index.js)
- [ ] Send test image to LD Agent-Logtest → verify reply
- [ ] Check server logs for `[VISION_LLM] Extraction successful`

## Activate for B3 Only

To activate ONLY for Bandera Road (B3 Kitchen Log), edit `.env`:

```
USE_VISION_LLM_PIPELINE=true
VISION_LLM_GROUPS=B3 Kitchen Log
```

(Or if the pipeline runs for ALL groups, keep as-is — fallback ensures no crash)

## Monitoring (24h)

Every form received:
1. Check WhatsApp reply format in B3 Kitchen Log
2. Check audit DB: `SELECT * FROM food_safety_submissions ORDER BY id DESC LIMIT 5`
3. Check logs: `grep "VISION_LLM" logs/*.log`

## Rollback

If bot crashes or misbehaves:
```
# In .env, comment out:
# USE_VISION_LLM_PIPELINE=true
```
Restart gateway → reverts to PaddleOCR instantly.

## End of 24h — Metrics to Collect

| Metric | Count |
|---|---|
| Forms processed | ___ |
| CONFIRM first try | ___ |
| EDIT needed | ___ |
| MANUAL needed | ___ |
| MANAGER escalated | ___ |
| Bot crash | ___ |
| Avg latency | ___s |
| Accuracy (CEO verify) | ___% |

---

# D6 — Roll out 3 stores + cleanup (Only after D5 passes)

## Rollout to B1 (Rim) + B2 (Stone Oak)

After 24h pilot at B3 passes (≥90% CONFIRM in 1 try):

1. No code change needed — pipeline already runs for all groups when flag is ON
2. Monitor B1 + B2 groups for 48h
3. Collect same metrics as D5

## Cleanup — Remove Old Pipeline (Only after D6 passes)

Files to remove/comment out:
- `paddleocr_bridge.js` — keep for now, remove after 2 weeks
- `src/handwriting/writerProfile.js` — merge into pipeline prompt
- `src/storeKnowledge.js` — embed in prompts.py
- `src/visionAiReviewer.js` — replaced by Vision LLM confidence
- `src/crossFieldIntelligence.js` — LLM handles this natively
- `src/foodSafetyDecisionEngine.js` — simplified to just alert routing

Architecture doc update:
- Update `docs/architecture.md` to reflect single-call Vision LLM pipeline
- Remove references to 5-layer enrichment pipeline
