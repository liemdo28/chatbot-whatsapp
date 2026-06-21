import os

path = r'e:\Project\Master\Bakudan\integration-system\desktop-app\build_release.ps1'
log_path = r'e:\Project\Master\Bakudan\integration-system\desktop-app\fix_log2.txt'

def log(msg):
    with open(log_path, 'a', encoding='utf-8') as f:
        f.write(msg + '\n')

log(f"Starting minimal fix - only emoji chars")

with open(path, 'rb') as f:
    data = f.read()

text = data.decode('utf-8-sig')
log(f"File loaded: {len(data)} bytes")

# Only fix specific unicode chars that are emojis in function definitions
# Leave dashes and arrows inside comments as-is
fixes = {
    '\u2014': '--',   # em dash in comments only (line 2)
    '\u2192': '->',   # arrow in comments only (line 2)
    '\u2713': '[OK]', # check mark in function ok()
    '\u2717': '[X]',  # X mark in function fail()
    '\u2705': '[OK]', # white check mark
    '\u274c': '[X]',  # cross mark
    '\u26a0': '[!]',  # warning sign
}

# Apply only to lines 9, 10, 11, 49
lines = text.split('\n')
target_lines = {9, 10, 11, 49}  # 1-indexed
fix_count = 0
for i in range(len(lines)):
    if (i + 1) in target_lines:
        for old, new in fixes.items():
            if old in lines[i]:
                count = lines[i].count(old)
                log(f"Line {i+1}: replacing {repr(old)} x{count} with {repr(new)}")
                lines[i] = lines[i].replace(old, new)
                fix_count += count

log(f"Total replacements: {fix_count}")

# Reassemble and write back (keep original line endings)
result = '\n'.join(lines)

# Check for remaining non-ASCII
remaining = [ch for ch in result if ord(ch) > 127]
log(f"Remaining non-ASCII chars: {len(remaining)}")
for ch in remaining:
    log(f"  U+{ord(ch):04X}: in context: ...{result[result.index(ch)-10:result.index(ch)+10]}...")

# Write back as-is (keep original encoding)
with open(path, 'w', encoding='utf-8') as f:
    f.write(result)

log(f"File written: {len(result)} chars")
log("Done!")