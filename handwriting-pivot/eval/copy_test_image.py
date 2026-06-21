import shutil
import glob
import os
import sys

base = r'C:\Ld-project\whatsapp-ai-gateway\data\evidence'
if not os.path.isdir(base):
    print(f"Directory not found: {base}")
    sys.exit(1)

files = glob.glob(os.path.join(base, '*.jpg'))
print(f"Found {len(files)} jpg files in {base}")

if not files:
    print("No images found!")
    sys.exit(1)

# Pick largest
files_with_size = [(f, os.path.getsize(f)) for f in files]
files_with_size.sort(key=lambda x: x[1], reverse=True)

src = files_with_size[0][0]
dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'test_form.jpg')
shutil.copy2(src, dst)
print(f"Copied: {src}")
print(f"  Size: {os.path.getsize(dst)} bytes")

print("\nTop 3 by size:")
for f, sz in files_with_size[:3]:
    print(f"  {sz:>10} bytes  {os.path.basename(f)}")
