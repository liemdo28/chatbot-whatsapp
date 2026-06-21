import os

path = r'e:\Project\Master\Bakudan\integration-system\desktop-app\build_release.ps1'
with open(path, 'rb') as f:
    data = f.read()

text = data.decode('utf-8-sig')
lines = text.split('\n')
print(f"Total lines: {len(lines)}")

# Check for non-ASCII chars in each line
for i, line in enumerate(lines, 1):
    for j, ch in enumerate(line):
        if ord(ch) > 127:
            print(f"Line {i}, col {j}: U+{ord(ch):04X} ({ch!r}) in: {line[:80]}")
            break