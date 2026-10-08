"""Draws the app icon (route line with points on dark tile) as PNGs."""
from PIL import Image, ImageDraw
import os

out = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
os.makedirs(out, exist_ok=True)

def icon(size):
    s = 4  # supersampling
    S = size * s
    img = Image.new('RGB', (S, S), (14, 18, 24))
    d = ImageDraw.Draw(img)
    # subtle grid
    for i in range(1, 6):
        p = S * i // 6
        d.line([(p, 0), (p, S)], fill=(26, 32, 42), width=max(1, S // 256))
        d.line([(0, p), (S, p)], fill=(26, 32, 42), width=max(1, S // 256))
    pts = [(0.20, 0.74), (0.40, 0.56), (0.58, 0.62), (0.78, 0.30)]
    pts = [(x * S, y * S) for x, y in pts]
    d.line(pts, fill=(255, 159, 10), width=S // 16, joint='curve')
    r = S // 17
    for i, (x, y) in enumerate(pts):
        fill = (255, 255, 255) if 0 < i < len(pts) - 1 else (255, 159, 10)
        d.ellipse([x - r, y - r, x + r, y + r], fill=fill, outline=(14, 18, 24), width=S // 64)
    return img.resize((size, size), Image.LANCZOS)

for size, name in [(192, 'icon-192.png'), (512, 'icon-512.png'), (180, 'apple-touch-icon.png')]:
    icon(size).save(os.path.join(out, name))
print('ok')
