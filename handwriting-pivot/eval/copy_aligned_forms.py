import shutil
import os

copies = [
    (r'C:\Ld-project\whatsapp-ai-gateway\data\debug-crops\live-proof\B2\44\aligned_form.png',
     'eval/form_stone_oak.png'),
    (r'C:\Ld-project\whatsapp-ai-gateway\data\debug-crops\live-proof\B3\40\aligned_form.png',
     'eval/form_bandera.png'),
]

base = r'c:\Ld-project\handwriting-pivot'

for src, dst_rel in copies:
    dst = os.path.join(base, dst_rel)
    if os.path.exists(src):
        shutil.copy2(src, dst)
        print(f"Copied: {os.path.basename(src)} ({os.path.getsize(src)} bytes) -> {dst_rel}")
    else:
        print(f"MISSING: {src}")
