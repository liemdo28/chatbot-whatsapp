import os

path = r'e:\Project\Master\Bakudan\integration-system\desktop-app\build_release.ps1'
log_path = r'e:\Project\Master\Bakudan\integration-system\desktop-app\fix_log3.txt'

def log(msg):
    with open(log_path, 'a', encoding='utf-8') as f:
        f.write(msg + '\n')

log(f"Starting final cleanup")

with open(path, 'rb') as f:
    data = f.read()

text = data.decode('utf-8-sig')
log(f"File loaded: {len(data)} bytes")

# Fix U+FE0F (variation selector - causes PS parser issues)
# and clean up comment block (line 2)
lines = text.split('\n')

fixes_in_comments = {
    '\u2014': '--',  # em dash
    '\u2192': '->',  # arrow right
}

# Only fix comment lines
for i, line in enumerate(lines):
    stripped = line.lstrip()
    if stripped.startswith('<#') or stripped.startswith('#'):
        for old, new in fixes_in_comments.items():
            if old in line:
                line = line.replace(old, new)
        lines[i] = line

# Remove all U+FE0F (variation selectors - these break PS parsing)
text = '\n'.join(lines)
if '\ufe0f' in text:
    log(f"Removing U+FE0F variation selectors")
    text = text.replace('\ufe0f', '')

# Check for remaining non-ASCII
remaining = [ch for ch in text if ord(ch) > 127]
log(f"Remaining non-ASCII chars: {len(remaining)}")
for ch in remaining:
    log(f"  U+{ord(ch):04X}: {repr(ch)}")

# Write back preserving original line endings
with open(path, 'w', encoding='utf-8') as f:
    f.write(text)

log(f"File written: {len(text)} chars")

# Verify
with open(path, 'rb') as f:
    verify = f.read()
non_ascii = sum(1 for b in verify if b > 127)
log(f"Verification: {non_ascii} non-ASCII bytes remaining")
if non_ascii == 0:
    log("SUCCESS: File is pure ASCII!")
log("Done!")