"""Automated login execution for DoorDash and Toast."""
import subprocess
import json
import time
import sys
import os

REPORT_DIR = r"c:\Ld-project\test-results\live-op"
os.makedirs(REPORT_DIR, exist_ok=True)

def curl(url, method="GET", data=None, timeout=310):
    cmd = ["curl", "-s", "-X", method, url]
    if data:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(data)]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    try:
        return json.loads(r.stdout) if r.stdout else {}
    except:
        return {"raw": r.stdout[:500], "rc": r.returncode}

# ── DoorDash Auto-Login ──────────────────────────────────────────────────────────
stores = ["bakudan-the-rim", "bakudan-stone-oak", "bakudan-bandera", "raw-sushi-bar"]
dd_results = {}

print("\n=== DOORASH AUTO LOGIN ===\n")
for store in stores:
    print(f"Triggering login for {store}...")
    r = curl(f"http://127.0.0.1:3001/api/login/{store}", method="POST", timeout=310)
    success = r.get("success", False)
    twoFa = r.get("twoFaRequired", False)
    msg = r.get("message", "no message")[:120]
    screenshot = r.get("screenshotPath", "")
    print(f"  success={success} twoFa={twoFa} msg={msg}")
    print(f"  screenshot={screenshot}")
    dd_results[store] = {"success": success, "twoFa": twoFa, "message": msg, "screenshot": screenshot}
    time.sleep(2)

# ── Toast Login ────────────────────────────────────────────────────────────────
print("\n=== TOAST LOGIN ===\n")
toast_result = curl("http://127.0.0.1:3001/api/toast/login", method="POST", timeout=60)
print(f"Toast result: {str(toast_result)[:300]}")

# ── Google OAuth Token Check ────────────────────────────────────────────────
print("\n=== GOOGLE TOKEN CHECK ===\n")
token_file = r"c:\Users\hoang\Downloads\google token\Request Response.txt"
if os.path.exists(token_file):
    print(f"Token file found: {token_file}")
    content = open(token_file).read()
    has_business = "business.manage" in content
    print(f"Has business.manage scope: {has_business}")
else:
    print("Token file not found")
    has_business = False

# ── Save results ────────────────────────────────────────────────────────────
results = {
    "doordash": dd_results,
    "toast": toast_result,
    "google_business_scope": has_business,
}
with open(os.path.join(REPORT_DIR, "auto_login_results.json"), "w") as f:
    json.dump(results, f, indent=2)
print(f"\nResults saved to {REPORT_DIR}")
print("\nSummary:")
for store, r in dd_results.items():
    print(f"  {store}: success={r['success']} twoFa={r['twoFa']}")
print(f"  Google business.manage: {has_business}")