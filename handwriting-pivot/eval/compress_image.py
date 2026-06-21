from PIL import Image
import os

img = Image.open(os.path.join(os.path.dirname(__file__), 'test_form.jpg'))
print(f'Original: {os.path.getsize(os.path.join(os.path.dirname(__file__), "test_form.jpg"))} bytes, {img.size}')

ratio = 1024 / img.width if img.width > 1024 else 1.0
new_size = (int(img.width * ratio), int(img.height * ratio))
resized = img.resize(new_size, Image.LANCZOS)

out = os.path.join(os.path.dirname(__file__), 'test_form_sm.jpg')
resized.save(out, quality=85, optimize=True)
print(f'Resized: {os.path.getsize(out)} bytes, {resized.size}')
