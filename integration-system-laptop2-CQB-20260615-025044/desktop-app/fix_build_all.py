import os

path = r'e:\Project\Master\Bakudan\integration-system\desktop-app\build_release.ps1'
log_path = r'e:\Project\Master\Bakudan\integration-system\desktop-app\fix_log4.txt'

def log(msg):
    with open(log_path, 'a', encoding='utf-8') as f:
        f.write(msg + '\n')

log(f"Starting complete ASCII cleanup")

with open(path, 'rb') as f:
    data = f.read()

text = data.decode('utf-8-sig')
log(f"File loaded: {len(data)} bytes")

# Replace ALL non-ASCII chars in one pass
# Use a comprehensive replacement map
replacements = {
    '\u2014': '--',   # em dash
    '\u2013': '-',    # en dash
    '\u2192': '->',   # arrow right
    '\u2190': '<-',   # arrow left
    '\u2705': '[OK]', # check mark
    '\u2713': '[OK]', # check mark
    '\u274c': '[X]',  # cross mark
    '\u26a0': '[!]',  # warning
    '\ufe0f': '',     # variation selector
}

# Count non-ASCII before
before = sum(1 for ch in text if ord(ch) > 127)
log(f"Non-ASCII chars before: {before}")

# Apply all replacements
for old, new in replacements.items():
    if old in text:
        log(f"Replacing {repr(old)} (U+{ord(old):04X}) x{text.count(old)} with {repr(new)}")
        text = text.replace(old, new)

# Any remaining non-ASCII chars, replace with ?
remaining = sum(1 for ch in text if ord(ch) > 127)
log(f"Non-ASCII after replacements: {remaining}")
if remaining > 0:
    for ch in sorted(set(text), key=ord):
        if ord(ch) > 127:
            log(f"Replacing remaining U+{ord(ch):04X} with ?")
            text = text.replace(ch, '?')

# Verify
verify_count = sum(1 for ch in text if ord(ch) > 127)
log(f"Verification non-ASCII: {verify_count}")

# Write back preserving line endings
with open(path, 'w', encoding='utf-8') as f:
    f.write(text)

log(f"File written: {len(text)} chars")

# Final byte-level verification
with open(path, 'rb') as f:
    final_data = f.read()
final_non_ascii = sum(1 for b in final_data if b > 127)
log(f"Final byte verification: {final_non_ascii} non-ASCII bytes")
if final_non_ascii == 0:
    log("SUCCESS: File is pure ASCII!")

log("Done!")