import sys
path = r'e:\Project\Master\Bakudan\integration-system\desktop-app\build_release.ps1'
with open(path, 'rb') as f:
    content = f.read()
print(f'File size: {len(content)} bytes')
print(f'First 3 bytes: {content[:3]}')
text = content.decode('utf-8-sig')
lines = text.split('\n')
print(f'Lines: {len(lines)}')
problematic = []
for i, line in enumerate(lines, 1):
    # Skip comment-only and function definition lines
    stripped = line.lstrip()
    if stripped.startswith('#') or stripped.startswith('function ') or stripped.startswith('try {') or stripped.startswith('} catch') or stripped.startswith('} else {') or stripped.startswith('if ($') or stripped.startswith('}'):
        continue
    q_count = line.count('"')
    if q_count % 2 != 0:
        problematic.append(f'Line {i}: odd quotes ({q_count}): {repr(line[:120])}')

print(f'Problematic lines: {len(problematic)}')
for p in problematic[:20]:
    print(p)