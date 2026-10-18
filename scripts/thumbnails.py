# Makes the small copy of each example design that the home page's rack
# and the studio's library cut their pairs from, as <id>-sm.webp beside
# static/designs/<id>.jpg:
# 132 px wide, which is still sharp at the rack's largest size on a 3x
# phone screen.
#
#   uv run --with pillow python -I scripts/thumbnails.py

import pathlib

from PIL import Image

WIDTH = 132

for full in sorted(pathlib.Path("static/designs").glob("*.jpg")):
    if full.stem.endswith("-sm"):
        continue
    image = Image.open(full).convert("RGB")
    height = round(image.height * WIDTH / image.width)
    small = full.with_name(f"{full.stem}-sm.webp")
    image.resize((WIDTH, height), Image.LANCZOS).save(small, quality=82, method=6)
    print(f"{small.name}: {small.stat().st_size // 1024} KB")
