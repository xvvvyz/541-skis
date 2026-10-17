# Makes the home page's link preview, static/og/home.jpg: the headline over
# the Mt. Hood contours, with the logo above it and the footer's skyline and
# raven below. Shapes and colors come from the site's own sources, so
# rerun it when they change.
#
#   uv run --with pillow --with resvg-py python -I scripts/og.py

import io
import pathlib
import re
import tempfile
import urllib.parse
from urllib.request import urlopen

import resvg_py
from PIL import Image

W, H = 1200, 630
BASELINE = 357
# The footer's skyline, 1440 wide, scaled to span the card, with its summit
# (y 22.2) 128 px below the headline's baseline.
SCALE = W / 1440
SKYLINE = f"translate(0 {BASELINE + 128 - 22.2 * SCALE}) scale({SCALE})"

src = pathlib.Path("src")
colors = dict(re.findall(r'(\w+): "(#\w+)"', (src / "client/colors.ts").read_text()))
logo = re.search(r'LOGO =\s*"([^"]+)"', (src / "client/logo.ts").read_text())[1]
raven = re.search(r'RAVEN =\s*"([^"]+)"', (src / "client/raven.ts").read_text())[1]
hood = re.search(
    r'aria-label="Mt. Hood from Parkdale".*?</svg>',
    (src / "pages/index.html").read_text(),
    re.S,
)[0]
gradient = re.search(r"<defs>.*?</defs>", hood, re.S)[0]
fill, ridge = re.findall(r' d="([^"]+)"', hood)
# The raven's spot over the west slope, as the footer places it.
perch = re.search(r'data-raven\s+transform="([^"]+)"', hood)[1]

# The contours cover the card, faint, as on the design cards (card.ts).
topo = pathlib.Path("static/images/hood-topo.svg").read_text()
topo = topo.replace(
    "<svg ",
    f'<svg width="{W}" height="{H}" preserveAspectRatio="xMidYMid slice" opacity="0.12" ',
    1,
)

# The skyline is laid on snow, so the contours stop at the ridge as they do
# on the page, and its stroke keeps the footer's 1.5 px.
svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}">
  {gradient}
  <rect width="{W}" height="{H}" fill="{colors['snow']}"/>
  {topo}
  <g transform="translate({W / 2 - 36} 94) scale({72 / 400})">
    <circle cx="200" cy="200" r="200" fill="{colors['crimson']}"/>
    <path d="{logo}" fill="{colors['white']}"/>
  </g>
  <g font-family="Big Shoulders Display" font-weight="800" font-size="76"
     fill="{colors['ink']}" text-anchor="middle">
    <text x="{W / 2}" y="{BASELINE - 72}">The only ski</text>
    <text x="{W / 2}" y="{BASELINE}">you need.</text>
  </g>
  <g transform="{SKYLINE}">
    <path d="{fill}" fill="{colors['snow']}"/>
    <path d="{fill}" fill="url(#hood)"/>
    <path d="{ridge}" fill="none" stroke="{colors['crimson']}"
          stroke-width="{1.5 / SCALE}" stroke-linejoin="round"/>
    <path d="{raven}" fill="{colors['ink']}" transform="{perch}"/>
  </g>
  <text x="{W / 2}" y="594" font-family="Geist Mono" font-weight="500" font-size="18"
        letter-spacing="5" fill="{colors['muted']}" text-anchor="middle">541.SKI</text>
</svg>"""

# The fonts as TTFs, the format Google Fonts sends to clients it doesn't know.
query = urllib.parse.urlencode(
    [("family", "Big Shoulders Display:wght@800"), ("family", "Geist Mono:wght@500")]
)
css = urlopen(f"https://fonts.googleapis.com/css2?{query}").read().decode()
with tempfile.TemporaryDirectory() as tmp:
    for i, url in enumerate(re.findall(r"url\((\S+?)\)", css)):
        pathlib.Path(tmp, f"{i}.ttf").write_bytes(urlopen(url).read())
    png = resvg_py.svg_to_bytes(svg_string=svg, skip_system_fonts=True, font_dirs=[tmp])
out = pathlib.Path("static/og/home.jpg")
Image.open(io.BytesIO(png)).convert("RGB").save(out, quality=88, optimize=True)
print(f"{out}: {out.stat().st_size // 1024} KB")
