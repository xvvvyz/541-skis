# Converts a ski outline exported from VCarve Pro (an Illustrator 3 .ai file
# holding one closed path) or from CAD as a PDF into the half-width table
# src/client/ski.ts draws the ski from.
#
#   uv run python -I scripts/outline.py path/to/193.ai > src/client/shapes/193.json
#   uv run --with pymupdf python -I scripts/outline.py path/to/193-wide.pdf > src/client/shapes/193-wide.json
#
# The table runs from tip to tail as [share of length, half-width in mm]. The
# tip is the end nearer the widest point. The files are the base, which the
# steel edges add 2 mm to on each side, so the outline is grown by that much
# all round; the step the base has near the tail, where the edges stop, is
# smoothed out first.

import math
import sys

EDGE = 2  # mm the edges add to each side of the base

PT = 25.4 / 72  # mm per point


def bezier(p0, p1, p2, p3):
    # A curve flattened into short lines, its start left off.
    return [
        tuple(
            (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b
            + 3 * (1 - t) * t**2 * c + t**3 * d
            for a, b, c, d in zip(p0, p1, p2, p3)
        )
        for t in (i / 24 for i in range(1, 25))
    ]


def read_ai(path):
    # Moves and lines (m, L, l) add a point; curves (c, v, y) are flattened
    # into short lines. Uppercase and lowercase only differ in smoothness.
    points = []
    for line in open(path, encoding="latin-1"):
        parts = line.split()
        if not parts or parts[-1].lower() not in "mlcvy":
            continue
        try:
            xy = [float(v) * PT for v in parts[:-1]]
        except ValueError:
            continue
        op = parts[-1].lower()
        pairs = list(zip(xy[::2], xy[1::2]))
        if op in "ml" and len(pairs) == 1:
            points.append(pairs[0])
        elif points and len(pairs) in (2, 3):
            p0 = points[-1]
            if op == "c" and len(pairs) == 3:
                p1, p2, p3 = pairs
            elif op == "v" and len(pairs) == 2:
                p1, (p2, p3) = p0, pairs
            elif op == "y" and len(pairs) == 2:
                (p1, p3), p2 = pairs, pairs[1]
            else:
                continue
            points += bezier(p0, p1, p2, p3)
    return points


def read_pdf(path):
    # CAD exports the outline as many short paths, alongside lines and
    # labels drawn inside it. The outline is the paths that join end to end,
    # starting from the tallest, so the rest are left out.
    import pymupdf

    paths = []
    for drawing in pymupdf.open(path)[0].get_drawings():
        points = []
        for op, *at in drawing["items"]:
            if op not in "lc":
                continue
            at = [(p.x * PT, -p.y * PT) for p in at]  # y up, as in .ai
            if op == "l":
                points += at if not points else at[1:]
            elif op == "c":
                points += (at[:1] if not points else []) + bezier(*at)
        if points:
            paths.append(points)
    if not paths:
        return []

    def near(a, b):
        return math.dist(a, b) < 0.01

    tallest = max(paths, key=lambda p: max(y for _, y in p) - min(y for _, y in p))
    paths.remove(tallest)
    points = tallest
    while not near(points[0], points[-1]):
        joined = next((p for p in paths if near(p[0], points[-1])), None)
        if joined is None:
            joined = next((p[::-1] for p in paths if near(p[-1], points[-1])), None)
            if joined is None:
                break
            paths.remove(joined[::-1])
        else:
            paths.remove(joined)
        points += joined[1:]
    # Centered across, as VCarve places it.
    xs = [x for x, _ in points]
    mid = (min(xs) + max(xs)) / 2
    return [(x - mid, y) for x, y in points]


def read(path):
    points = read_pdf(path) if path.lower().endswith(".pdf") else read_ai(path)
    if len(points) < 10:
        sys.exit(f"{path}: no outline found")
    return points


def envelope(points, top):
    # The outline's outer extent at each height: half the width across it,
    # whichever way the path winds. Notches and gaps inside an end don't
    # change it.
    segments = list(zip(points, points[1:] + points[:1]))
    rows = []
    for y in sorted({y for _, y in points}, reverse=True):
        xs = [
            x0 + (x1 - x0) * (y - y0) / (y1 - y0)
            for (x0, y0), (x1, y1) in segments
            if min(y0, y1) <= y <= max(y0, y1) and y0 != y1
        ] or [x for x, py in points if py == y]
        right = max((x for x in xs if x > 0), default=0)
        left = max((-x for x in xs if x < 0), default=0)
        rows.append((top - y, (right + left) / 2))
    return rows


def shoulder(rows, length):
    # Near the tail, the base runs a few mm wider than the sides where the
    # steel edges stop. Trims that step so the tail curves in from the sides.
    for i in range(len(rows) - 1, 0, -1):
        (s0, w0), (s1, w1) = rows[i - 1], rows[i]
        if s1 < 0.92 * length:
            break
        if w1 - w0 > 1 and s1 - s0 < 5:
            return [(s, min(w, w0) if s >= s0 else w) for s, w in rows]
    return rows


def grow(rows, by):
    # Moves every point `by` mm out along its normal, so the outline grows
    # evenly, ends included. A flat end stays flat.
    out = []
    for i, (s, w) in enumerate(rows):
        (s0, w0), (s1, w1) = rows[max(0, i - 1)], rows[min(len(rows) - 1, i + 1)]
        ds, dw = s1 - s0, w1 - w0
        norm = math.hypot(ds, dw) or 1
        out.append((s - by * dw / norm, w + by * ds / norm))
    if rows[0][1] > 1:
        out.insert(0, (rows[0][0] - by, out[0][1]))
    if rows[-1][1] > 1:
        out.append((rows[-1][0] + by, out[-1][1]))
    # Keep the table running tip to tail, starting at zero.
    kept = []
    for s, w in out:
        if not kept or s > kept[-1][0]:
            kept.append((s, max(0, w)))
    return [(s - kept[0][0], w) for s, w in kept]


def simplify(rows, tolerance=0.05):
    # Keeps only the points needed to stay within tolerance mm of the shape.
    keep = {0, len(rows) - 1}
    stack = [(0, len(rows) - 1)]
    while stack:
        a, b = stack.pop()
        (sa, wa), (sb, wb) = rows[a], rows[b]
        worst, at = 0, None
        for i in range(a + 1, b):
            s, w = rows[i]
            line = wa if sb == sa else wa + (wb - wa) * (s - sa) / (sb - sa)
            if abs(w - line) > worst:
                worst, at = abs(w - line), i
        if at is not None and worst > tolerance:
            keep.add(at)
            stack += [(a, at), (at, b)]
    return [rows[i] for i in sorted(keep)]


def main(path):
    points = read(path)
    ys = [y for _, y in points]
    top, length = max(ys), max(ys) - min(ys)
    rows = envelope(points, top)

    widest = max(rows, key=lambda r: r[1])[0]
    if widest > length / 2:  # tip at the bottom: flip so it runs tip first
        rows = [(length - s, w) for s, w in reversed(rows)]
    rows = grow(shoulder(rows, length), EDGE)
    length = rows[-1][0]
    rows = simplify(rows)

    def extreme(lo, hi, pick):
        band = [r for r in rows if lo * length <= r[0] <= hi * length]
        s, w = pick(band, key=lambda r: r[1])
        return f"{2 * w:.1f} mm at {s / length:.3f}"

    print(
        f"{path}: {length:.1f} mm long; "
        f"tip {extreme(0, 0.4, max)}, waist {extreme(0.3, 0.8, min)}, "
        f"tail {extreme(0.7, 1, max)}, ends {2 * rows[0][1]:.1f} / "
        f"{2 * rows[-1][1]:.1f} mm, {len(rows)} points",
        file=sys.stderr,
    )
    # One row a line, as prettier formats it.
    def num(v, places):
        text = f"{v:.{places}f}".rstrip("0")
        return text + "0" if text.endswith(".") else text

    rows = ",\n".join(f"    [{num(s / length, 5)}, {num(w, 2)}]" for s, w in rows)
    print(f'{{\n  "length": {length:.1f},\n  "widths": [\n{rows}\n  ]\n}}')


if __name__ == "__main__":
    main(sys.argv[1])
