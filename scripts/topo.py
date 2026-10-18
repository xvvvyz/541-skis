# Draws the Topo example, static/designs/topo.jpg: Mt. Hood's contours,
# traced from real elevation data (AWS Terrain Tiles, from USGS 3DEP) and
# drawn as fine white lines on the site's ink. At 1:4, like new designs,
# so the pair can be slid over the mountain. Run scripts/thumbnails.py
# after it.
#
#   uv run --with numpy --with pillow --with contourpy --with scipy python -I scripts/topo.py

import io
import math
import pathlib
from urllib.request import urlopen

import numpy as np
from contourpy import contour_generator
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter, map_coordinates

W, H = 1024, 4128
SUMMIT = (45.3736, -121.6960)
WIDE = 11_000  # metres of ground across the art
# Where the summit sits, as a share of the height from the top.
SUMMIT_AT = 0.36
INTERVAL = 50  # metres between contours
INDEX = 5  # every fifth contour is drawn heavier
INK = (26, 20, 22)
LINE = 1.1
INDEX_LINE = 2.0
# How far the heights are blurred, in art pixels, so the contours don't
# follow every rock.
SMOOTH = 4
# Drawn this many times bigger, then scaled down, for smooth lines.
SUPER = 3
ZOOM = 14
TILE = 256
TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium"


def world(lat, lon):
    """Web Mercator pixels at ZOOM."""
    n = TILE * 2**ZOOM
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


metres_per_px = 156543.03392 * math.cos(math.radians(SUMMIT[0])) / 2**ZOOM
scale = WIDE / metres_per_px / W  # world pixels per art pixel
sx, sy = world(*SUMMIT)
left = sx - W / 2 * scale
top = sy - H * SUMMIT_AT * scale

tile_x = range(int(left // TILE), int((left + W * scale) // TILE) + 1)
tile_y = range(int(top // TILE), int((top + H * scale) // TILE) + 1)
heights = np.zeros((len(tile_y) * TILE, len(tile_x) * TILE))
for j, ty in enumerate(tile_y):
    for i, tx in enumerate(tile_x):
        png = urlopen(f"{TILES}/{ZOOM}/{tx}/{ty}.png").read()
        rgb = np.asarray(Image.open(io.BytesIO(png)).convert("RGB"), dtype=float)
        heights[j * TILE : (j + 1) * TILE, i * TILE : (i + 1) * TILE] = (
            rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768
        )

ys, xs = np.mgrid[0:H, 0:W]
grid = map_coordinates(
    heights,
    [
        top - tile_y[0] * TILE + ys * scale,
        left - tile_x[0] * TILE + xs * scale,
    ],
    order=3,
)
grid = gaussian_filter(grid, SMOOTH)

image = Image.new("RGB", (W * SUPER, H * SUPER), INK)
draw = ImageDraw.Draw(image)
lines = contour_generator(z=grid)
for level in range(
    math.ceil(grid.min() / INTERVAL) * INTERVAL, int(grid.max()) + 1, INTERVAL
):
    width = INDEX_LINE if level % (INTERVAL * INDEX) == 0 else LINE
    for points in lines.lines(level):
        draw.line(
            [(x * SUPER, y * SUPER) for x, y in points],
            fill="white",
            width=round(width * SUPER),
            joint="curve",
        )

out = pathlib.Path("static/designs/topo.jpg")
image.resize((W, H), Image.LANCZOS).save(out, quality=92)
print(f"{out}: {W} x {H}, {grid.min():.0f}-{grid.max():.0f} m")
