# Draws the home page's ski cross-section, static/images/ski-section.svg: a
# slice through the waist, deeper than life, seen a little from above and
# to the right. A 3 mm layer runs under the topsheet, poplar from each edge
# and purpleheart down the middle, over a core of upright strips. The
# strips' layout and the grain are illustrative. Colors come
# from the site's theme in src/styles.css, so rerun it when they change.
# It prints where the page's labels go, for the build section in
# src/pages/index.html.
#
#   uv run python -I scripts/section.py

import math
import pathlib
import random
import re

random.seed(541)
theme = dict(re.findall(r"--color-([\w-]+): (#\w+);", pathlib.Path("src/styles.css").read_text()))
# Only the drawing uses these, so they live here rather than in the theme.
colors = theme | {
    "abs": "#3b3537",
    "abs-side": "#2f2a2c",
    "sinter": "#141012",
    "steel": "#a4a7ab",
    "steel-side": "#84878c",
}

X0, Y0, W, H = 36, 84, 968, 160
DX, DY = 40, -28  # The slice's depth, drawn up and to the right.
TOP, BOTTOM = 132, 222  # The core's top and bottom.
# The ski's 872 wide here is about 98 mm across, so 3 mm is 27.
LAYER = 27

# The layer under the topsheet, across the core's 3 1/2" between the
# sidewalls: a 1" piece of poplar from each edge, 1 1/2" of purpleheart
# centered between them. Like the strips, it starts at 80, so the poplar
# runs 24 further, under each sidewall.
INCH = 792 / 3.5
SHEET = [("poplar", INCH + 24), ("purpleheart", 1.5 * INCH), ("poplar", INCH + 24)]

# Half the core, outside in; mirrored around a shared center strip.
HALF = [("ash", 56), ("cedar", 84), ("purpleheart", 14), ("poplar", 92),
        ("ash", 40), ("cedar", 66), ("purpleheart", 14)]
STRIPS = HALF + [("poplar", 108)] + HALF[::-1]
assert sum(w for _, w in STRIPS) == 840
# Growth-ring spacing, and the rings' opacity, for each wood's end grain.
GRAIN = {"ash": (7, 0.18), "cedar": (4, 0.12), "poplar": (6, 0.08), "purpleheart": (3, 0.25)}

# Labels beside the slice, each level with the layer it names at the
# slice's left end, and the x where its hairline ends on that layer. Core's
# line crosses the left sidewall, so it's drawn light there.
LABELS = [("Topsheet", 126, 64), ("Sidewalls", 170, 53.87), ("Core", 214, 94)]
# Labels under the slice, for the layers along its bottom, and the x where
# each one's stem rises to that bottom, on phones and on wider screens.
STEMS = [("Edges", 49, 49), ("Base", 180, 500)]

def num(v):
    return f"{v:.1f}".rstrip("0").rstrip(".")


def rings(w, h, wood):
    """Whole growth rings of a log centered off to one side, which the
    strip clips to its end grain."""
    gap, _ = GRAIN[wood]
    r0 = random.uniform(120, 420)
    cx = -r0 if random.random() < 0.5 else w + r0
    cy = random.uniform(-h / 2, h * 1.5)
    near = math.hypot(max(-cx, 0, cx - w), max(-cy, 0, cy - h))
    far = max(math.hypot(x - cx, y - cy) for x in (0, w) for y in (0, h))
    d, r = [], near + random.uniform(0, gap)
    while r < far:
        d.append(f"M{num(cx - r)} {num(cy)}a{num(r)} {num(r)} 0 1 0 {num(2 * r)} 0"
                 f"a{num(r)} {num(r)} 0 1 0 {num(-2 * r)} 0")
        r += gap * random.uniform(0.6, 1.4)
    return "".join(d)


def extrude(a, b):
    """The face swept back from the edge a–b by the slice's depth."""
    pts = [a, b, (b[0] + DX, b[1] + DY), (a[0] + DX, a[1] + DY)]
    return "M" + "L".join(f"{x} {y}" for x, y in pts) + "Z"


def strips(woods, x, y, h):
    """Wood strips side by side from x, each a nested svg that clips its
    rings."""
    out = []
    for wood, w in woods:
        _, opacity = GRAIN[wood]
        out.append(
            f'<svg x="{num(x)}" y="{y}" width="{num(w)}" height="{h}">'
            f'<rect width="{num(w)}" height="{h}" fill="{colors[wood]}"/>'
            f'<path d="{rings(w, h, wood)}" fill="none" stroke="{colors["ink"]}" '
            f'stroke-opacity="{opacity}" stroke-width="1.1"/></svg>'
        )
        x += w
    return out


core = strips(STRIPS, 80, TOP + LAYER, BOTTOM - TOP - LAYER)
core += strips(SHEET, 80, TOP, LAYER)
# The glue line under the layer, so poplar over poplar still reads as two.
core.append(f'<path d="M80 {TOP + LAYER}H920" stroke="{colors["ink"]}" stroke-opacity="0.2"/>')

parts = [
    # The top, then the right-hand end, swept back.
    (extrude((64, 120), (936, 120)), "crimson"),
    (extrude((936, 120), (936, 132)), "crimson-deep"),
    (extrude((936, 132), (960, 222)), "abs-side"),
    (extrude((960, 222), (960, 238)), "steel-side"),
]
front = [
    ("M64 132H104L80 222H40Z", "abs"),
    ("M896 132H936L960 222H920Z", "abs"),
    ("M64 120H936V132H64Z", "crimson-deep"),
    ("M58 222H942V238H58Z", "sinter"),
    # Steel edges, each with its tab tucked in under the core.
    ("M40 222H100V226H58V238H40Z", "steel"),
    ("M960 222H900V226H942V238H960Z", "steel"),
]
svg = "\n".join([
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{X0} {Y0} {W} {H}">',
    *(f'<path d="{d}" fill="{colors[c]}"/>' for d, c in parts),
    '<clipPath id="core"><path d="M104 132H896L920 222H80Z"/></clipPath>',
    '<g clip-path="url(#core)">',
    *core,
    "</g>",
    *(f'<path d="{d}" fill="{colors[c]}"/>' for d, c in front),
    "</svg>",
    "",
])
pathlib.Path("static/images/ski-section.svg").write_text(svg)

print(f"aspect-[{W}/{H}]")
for name, y, x in LABELS:
    print(f"{name}: top {(y - Y0) / H * 100:.2f}%, line ends {(x - X0) / W * 100:.2f}% in")
y = LABELS[2][1]
a, b = 64 - 24 * (y - TOP) / (BOTTOM - TOP), 104 - 24 * (y - TOP) / (BOTTOM - TOP)
print(f"Core over the sidewall: left {(a - X0) / W * 100:.2f}%, width {(b - a) / W * 100:.2f}%")
for name, *xs in STEMS:
    lefts = ", ".join(f"{(x - X0) / W * 100:.2f}%" for x in xs)
    print(f"{name}: left {lefts}, stem from {(238 - Y0) / H * 100:.2f}% down")
