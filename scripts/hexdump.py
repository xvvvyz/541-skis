# Draws the Hexdump example, static/designs/hexdump.jpg: xxd-style rows of a
# day on Mt. Hood in Geist Mono, amber on charcoal, with a row holding
# "541" or "chair" picked out now and then like a selection in a debugger.
# At 1:4, like new designs, so the pair can be slid over it. Run
# scripts/thumbnails.py after it.
#
#   uv run --with pillow python -I scripts/hexdump.py

import io
import re
from urllib.request import urlopen

from PIL import Image, ImageDraw, ImageFont

W, H = 1024, 4128
TEXT = (
    "06:12 alarm. 06:40 coffee, wax, boots. 07:05 hwy 26 east. "
    "08:29 first chair. fresh corduroy. cold smoke. "
    "45.3736 N 121.6959 W. summit 11,249 ft. "
    "09:14 lap 4. legs warm. 10:02 drop in. 11:48 one more lap. "
    "12:30 chili in the lodge. 13:05 bluebird, no wind. 14:40 spring corn. "
    "15:55 last chair. 16:20 tailgate. 541. "
).encode()

SIZE, WEIGHT, LINE = 17, 420, 22
BYTES = 16  # a row
HEX_AT = 9  # characters in, after "00000541:"
TEXT_AT = HEX_AT + BYTES * 3 + 1
BG = (27, 25, 22)
# Offset, bytes and text, plain and in a picked-out row.
PLAIN = [(112, 98, 82), (222, 176, 98), (150, 186, 176)]
PICKED = [(214, 196, 172), (250, 230, 200), (236, 244, 240)]
PICKS = {b"541": (150, 74, 84), b"chair": (52, 104, 110)}

# The font as a TTF, the format Google Fonts sends to clients it doesn't know.
css = urlopen(
    f"https://fonts.googleapis.com/css2?family=Geist+Mono:wght@{WEIGHT}"
).read()
url = re.search(rb"url\((.+?)\)", css)[1].decode()
font = ImageFont.truetype(io.BytesIO(urlopen(url).read()), SIZE)
cw = font.getlength("0")

image = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(image)
rows = H // LINE + 2
x0 = (W - (TEXT_AT + BYTES) * cw) / 2
data = TEXT * (rows * BYTES // len(TEXT) + 2)
picked = set()
for r in range(rows):
    chunk = data[r * BYTES : (r + 1) * BYTES]
    y = r * LINE - 6
    # One picked-out row each pass through the text, alternating between the
    # two words, so the selections stay sparse.
    loop = r * BYTES // len(TEXT)
    word = list(PICKS)[loop % 2]
    pick = word in chunk and loop not in picked
    if pick:
        picked.add(loop)
        draw.rectangle([0, y + 1, W, y + LINE - 1], fill=PICKS[word])
    offset, hex_, text = PICKED if pick else PLAIN

    draw.text((x0, y), f"{0x541 + r * BYTES:08x}:", font=font, fill=offset)
    for i, byte in enumerate(chunk):
        x = x0 + (HEX_AT + i * 3 + 1) * cw
        draw.text((x, y), f"{byte:02x}", font=font, fill=hex_)
    ascii_ = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
    draw.text((x0 + TEXT_AT * cw, y), ascii_, font=font, fill=text)

image.save("static/designs/hexdump.jpg", quality=92)
print("static/designs/hexdump.jpg")
