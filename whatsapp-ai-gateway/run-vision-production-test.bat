@echo off
echo ============================================
echo DEV1 PRODUCTION VISION VALIDATION
echo ============================================
echo.
echo This test requires OPENAI_API_KEY to be set.
echo Do NOT hardcode the key in any file.
echo Do NOT expose the full key in any report.
echo.
set VISION_REVIEW_ENABLED=true
set VISION_PROVIDER=openai
set VISION_REVIEW_FIELDS=critical_only
set VISION_MAX_CALLS_PER_FORM=6
set VISION_TIMEOUT_MS=15000
echo Starting production vision test...
node tests\testVisionProductionLive.js
echo.
echo Done.
pause
