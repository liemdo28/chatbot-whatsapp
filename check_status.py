import os, subprocess, json, time

# Check screenshot counts per store
base = r"c:/Ld-project/doordash-campaign-agent/data/screenshots"
stores = ["bakudan-the-rim","bakudan-stone-oak","bakudan-bandera","raw-sushi-bar"]
print("Screenshots per store:")
for s in stores:
    p = os.path.join(base, s)
    imgs = [f for f in os.listdir(p)] if os.path.exists(p) else []
    print(f"  {s}: {len(imgs)} screenshots")

# Check recovery reports
rr = r"c:/Ld-project/test-results/dev2-recovery"
if os.path.exists(rr):
    print("\nRecovery reports:")
    for f in sorted(os.listdir(rr)):
        print(f"  {f}")
        
# Check DD agent
try:
    r = subprocess.run(["curl","-s","http://127.0.0.1:3001/health"], capture_output=True, timeout=5)
    print(f"\nDD Agent: {r.stdout[:100]}")
except Exception as e:
    print(f"\nDD Agent check failed: {e}")

# Check Review system
try:
    r2 = subprocess.run(["curl","-s","http://127.0.0.1:8000/health"], capture_output=True, timeout=5)
    print(f"Review system: {r2.stdout[:100]}")
except Exception as e:
    print(f"Review system check failed: {e}")

print("\nDone.")
