import os

path = r'e:\Project\Master\Bakudan\integration-system\desktop-app\build_release.ps1'
log_path = r'e:\Project\Master\Bakudan\integration-system\desktop-app\fix_log.txt'

def log(msg):
    with open(log_path, 'a', encoding='utf-8') as f:
        f.write(msg + '\n')

log(f"Starting fix_build_script.py")

with open(path, 'rb') as f:
    data = f.read()

text = data.decode('utf-8-sig')
original = text
log(f"File loaded: {len(data)} bytes, {len(text)} chars")

# Replacement map - includes U+FE0F (variation selector)
replacements = {
    '\u2014': '--',       # em dash
    '\u2013': '-',        # en dash
    '\u2192': '->',       # arrow right
    '\u2190': '<-',       # arrow left
    '\u2713': '[OK]',     # check mark
    '\u2717': '[X]',      # X mark
    '\u2705': '[OK]',     # white heavy check mark
    '\u274c': '[X]',      # cross mark
    '\u26a0': '[!]',      # warning
    '\u2709': '[MSG]',    # envelope
    '\u2018': "'",        # left single quote
    '\u2019': "'",        # right single quote
    '\u201c': '"',        # left double quote
    '\u201d': '"',        # right double quote
    '\u2026': '...',      # ellipsis
    '\ufe0f': '',         # variation selector - remove it
}

# Find all non-ASCII chars
non_ascii_chars = set()
for ch in text:
    if ord(ch) > 127:
        non_ascii_chars.add(ch)

log(f"Non-ASCII chars found: {len(non_ascii_chars)}")
for ch in sorted(non_ascii_chars, key=ord):
    log(f"  U+{ord(ch):04X}: (char code {ord(ch)})")

# Apply replacements
replacements_made = 0
for old, new in replacements.items():
    if old in text:
        count = text.count(old)
        log(f"Replacing U+{ord(old):04X} -> {repr(new)} ({count} occurrences)")
        text = text.replace(old, new)
        replacements_made += count

log(f"Total replacements: {replacements_made}")

# Check for remaining non-ASCII
remaining = set()
for ch in text:
    if ord(ch) > 127:
        remaining.add(ch)

if remaining:
    log(f"WARNING: {len(remaining)} non-ASCII chars remain")
    for ch in sorted(remaining, key=ord):
        log(f"  U+{ord(ch):04X} remains, replacing with ?")
        text = text.replace(ch, '?')
else:
    log("All non-ASCII chars replaced successfully")

# Convert to pure ASCII
text_ascii = text.encode('ascii', errors='replace').decode('ascii')

# Strip the UTF-8 BOM from the beginning (if present)
if text_ascii.startswith('\ufeff'):
    log("Removing UTF-8 BOM")
    text_ascii = text_ascii[1:]

# Write back as ASCII (no BOM needed for PowerShell 5.1+)
with open(path, 'w', encoding='ascii', newline='\r\n') as f:
    f.write(text_ascii)

log(f"File written. Original: {len(original)}, new: {len(text_ascii)}")

# Verify
with open(path, 'rb') as f:
    verify = f.read()
non_ascii = sum(1 for b in verify if b > 127)
log(f"Verification: {non_ascii} non-ASCII bytes remaining")
if non_ascii == 0:
    log("SUCCESS: File is now pure ASCII!")
log("Done!")