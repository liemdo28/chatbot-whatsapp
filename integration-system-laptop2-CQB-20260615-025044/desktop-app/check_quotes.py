import os

path = r'e:\Project\Master\Bakudan\integration-system\desktop-app\build_release.ps1'
with open(path, 'rb') as f:
    data = f.read()

# Find any non-ASCII bytes
non_ascii = set()
for i, b in enumerate(data):
    if b > 127:
        non_ascii.add((i, b, hex(b)))

if non_ascii:
    print(f"Non-ASCII bytes found: {len(non_ascii)}")
    for idx, byte, hx in sorted(non_ascii)[:50]:
        # Show context
        start = max(0, idx - 20)
        end = min(len(data), idx + 20)
        context = data[start:end]
        try:
            ctx_str = context.decode('utf-8-sig')
        except:
            try:
                ctx_str = context.decode('latin-1')
            except:
                ctx_str = repr(context)
        print(f"  Pos {idx}: byte={hx}, context=...{ctx_str[:60]}...")
else:
    print("No non-ASCII bytes found. File is pure ASCII/UTF-8.")

# Now check for curly quotes in decoded text
text = data.decode('utf-8-sig')
for i, ch in enumerate(text):
    if ord(ch) in (0x201C, 0x201D, 0x2018, 0x2019):
        start = max(0, i - 20)
        end = min(len(text), i + 20)
        print(f"Curly quote at pos {i}: ...{text[start:end]}...")
        break
else:
    print("No curly quotes found.")

# Check line 279 specifically (0-indexed: 278)
lines = text.split('\n')
print(f"\nTotal lines: {len(lines)}")
if len(lines) >= 279:
    line279 = lines[278]
    print(f"Line 279: {repr(line279)}")
    # Count quotes
    dq = line279.count('"')
    sq = line279.count("'")
    backtick = line279.count("`")
    print(f"  Double quotes: {dq}, Single quotes: {sq}, Backticks: {backtick}")
    # Check for smart quotes
    for c in line279:
        if ord(c) > 127:
            print(f"  Non-ASCII char at pos: {ord(c):04x} = {repr(c)}")