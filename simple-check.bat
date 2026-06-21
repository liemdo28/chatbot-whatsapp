@echo off
python -c "import os
s='c:/Ld-project/doordash-campaign-agent/data/screenshots'
stores=['bakudan-the-rim','bakudan-stone-oak','bakudan-bandera','raw-sushi-bar']
for s in stores:
    p=os.path.join('c:/Ld-project/doordash-campaign-agent/data/screenshots',s)
    n=len([f for f in os.listdir(p)]) if os.path.exists(p) else 0
    print(s,n)"