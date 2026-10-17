// What the image model is told about where the skis are: a guide image
// and exact positions, the cleanup for when it copies the guide, and the
// check for when it follows it too closely.

import { COLORS } from "./colors";
import { fillHoles, toCanvas } from "./image";
import { GAP, outline, type Ski } from "./ski";
import { outlinePath } from "./topsheet";

const GUIDE_GREY = "#9c9c9c";

// Where the pair sits on a canvas of the given size, as the guide lays it
// out: the scale in px per mm, the tips' height, and each ski's center.
function placement(ski: Ski, width: number, height: number) {
  const px = width / (2 * ski.span + GAP);
  return {
    centers: [0, 1].map(
      (side) => (side * (ski.span + GAP) + ski.span / 2) * px,
    ),
    px,
    top: (height - ski.length * px) / 2,
  };
}

// A map of the canvas for the image model, at the proportions it paints:
// just the pair, in white where artTopsheets will cut it, on grey that
// gets trimmed away. The window and branding are left off so the model
// doesn't paint them in.
export function layoutGuide(ski: Ski, width = 352, height = 2928) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const { centers, px, top } = placement(ski, width, height);

  ctx.fillStyle = GUIDE_GREY;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = COLORS.white;
  for (const cx of centers) ctx.fill(outlinePath(ski, cx, top, px));
  return canvas;
}

// Artwork from the model, cleaned of any copied guide, as a JPEG.
export async function cleanArt(src: string) {
  const canvas = await toCanvas(src);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (removeGuide(image)) ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.9);
}

// The model sometimes copies the guide and paints only inside the skis,
// leaving the guide's grey around them, or white, the colour of its skis.
// Finds either where it touches the canvas border, then fills it from the
// surrounding colours, coarse to fine, so the art is full-bleed again.
// Grey or white that is part of the artwork itself is left alone. Returns
// how many pixels it filled.
function removeGuide(image: ImageData) {
  const { width: w, height: h } = image;
  const grey = borderHole(image, isGuideGrey);
  if (grey.count >= w * h * 0.01) return fill(image, grey);
  // Plenty of art has white in it, even a white ground, so white only
  // counts as the guide when it runs down the gap between the skis, at the
  // middle of the canvas, for most of its length, and mostly stays off
  // each ski's center line, a quarter of the way in from either side.
  const white = borderHole(image, isGuideWhite);
  const share = (x: number, reach = 0) =>
    columnShare(white.hole, w, h, x, reach);
  if (
    white.count &&
    share(w / 2, w * 0.02) >= 0.5 &&
    share(w / 4) < 0.4 &&
    share((3 * w) / 4) < 0.4
  ) {
    return fill(image, white);
  }
  return 0;
}

const GREY = parseInt(GUIDE_GREY.slice(1, 3), 16);

const isGuideGrey = (r: number, g: number, b: number) =>
  Math.max(r, g, b) - Math.min(r, g, b) < 10 &&
  Math.abs((r + g + b) / 3 - GREY) < 14;

const isGuideWhite = (r: number, g: number, b: number) =>
  Math.min(r, g, b) >= 249 && Math.max(r, g, b) - Math.min(r, g, b) <= 6;

// The pixels of a colour that join up with the canvas border, flood filled
// in from it.
function borderHole(
  image: ImageData,
  matches: (r: number, g: number, b: number) => boolean,
) {
  const { data, width: w, height: h } = image;
  const hole = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!hole[i] && matches(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])) {
      hole[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  let count = 0;
  while (stack.length) {
    const i = stack.pop()!;
    count++;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  return { count, hole };
}

// The share of rows where the hole comes within reach of column x.
function columnShare(
  hole: Uint8Array,
  w: number,
  h: number,
  x: number,
  reach: number,
) {
  const from = Math.round(x - reach);
  const to = Math.round(x + reach);
  let rows = 0;
  for (let y = 0; y < h; y++) {
    for (let i = y * w + from; i <= y * w + to; i++) {
      if (hole[i]) {
        rows++;
        break;
      }
    }
  }
  return rows / h;
}

// Fills the hole, grown to take in the soft edge, or the outline, where the
// model blended the guide into the art.
function fill(
  image: ImageData,
  { count, hole }: ReturnType<typeof borderHole>,
) {
  const { width: w, height: h } = image;
  for (let pass = 0; pass < 3; pass++) {
    const grown = hole.slice();
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (
          !hole[i] &&
          (hole[i - 1] || hole[i + 1] || hole[i - w] || hole[i + w])
        ) {
          grown[i] = 1;
        }
      }
    }
    hole.set(grown);
  }
  fillHoles(image, hole);
  return count;
}

// How far the model copied the guide's ski shapes into the art, or painted
// two skis on a plain background: 1 or more shows once cut. Judge the art
// before cleaning, which hides painted skis without fixing them.
export async function guideFlaws(src: string, ski: Ski, w = 352, h = 2928) {
  const canvas = await toCanvas(src, w, h);
  const image = canvas.getContext("2d")!.getImageData(0, 0, w, h);
  const { gap, tips } = drawnSkis(image);
  return Math.max(
    edgeAtCut(image, ski) / SHOWS.edge,
    Math.min(gap / SHOWS.gap, tips / SHOWS.tips),
  );
}

// Where each measure starts to show, from designs labelled by eye.
const SHOWS = { edge: 0.28, gap: 0.4, tips: 0.3 };

// How much of the cut line round the tips the art steps across the same
// way, or is drawn along, beyond lines nearby: up to 0.8 for a plain copy.
function edgeAtCut(image: ImageData, ski: Ski) {
  const { width: w, height: h } = image;
  const { centers, px, top } = placement(ski, w, h);
  const at = (x: number, y: number) =>
    colourAt(
      image,
      Math.min(w - 1, Math.max(0, Math.round(x))),
      Math.min(h - 1, Math.max(0, Math.round(y))),
    );

  let near = 0;
  let far = 0;
  for (const cx of centers) {
    const points = outline(ski).map(([x, s]) => [cx + x * px, top + s * px]);
    const middle = top + (ski.length * px) / 2;
    // Round the tip, clear of the canvas edges, with outward normals.
    const line = points.flatMap(([x, y], i) => {
      const [ax, ay] = points.at(i - 1)!;
      const [bx, by] = points[(i + 1) % points.length];
      const length = Math.hypot(by - ay, ax - bx) || 1;
      let [nx, ny] = [(by - ay) / length, (ax - bx) / length];
      if (nx * (x - cx) + ny * (y - middle) < 0) [nx, ny] = [-nx, -ny];
      return y < top + 0.2 * ski.length * px && x > 6 && x < w - 6
        ? [{ nx, ny, x, y }]
        : [];
    });
    const share = (offset: number) => {
      const steps: number[][] = [];
      const ridges: number[][] = [];
      for (const { nx, ny, x, y } of line) {
        const qx = x + nx * offset;
        const qy = y + ny * offset;
        // Each side's mean colour over a short run, so texture evens out.
        const run = (sign: number) => {
          const sum = [0, 0, 0];
          for (let k = 2; k < 8; k++) {
            const c = at(qx + nx * sign * k, qy + ny * sign * k);
            for (let j = 0; j < 3; j++) sum[j] += c[j] / 6;
          }
          return sum;
        };
        const inside = run(-1);
        const outside = run(1);
        const on = at(qx, qy);
        steps.push(inside.map((c, j) => c - outside[j]));
        ridges.push(on.map((c, j) => c - (inside[j] + outside[j]) / 2));
      }
      return Math.max(consistent(steps), consistent(ridges));
    };
    near += Math.max(...[-4, -3, -2, -1, 0, 1, 2, 3, 4].map(share)) / 2;
    far += median([-30, -24, -18, -12, 12, 18, 24, 30].map(share)) / 2;
  }
  return near - far;
}

// Skis painted on a background leave a plain stripe of it down the middle,
// and the same colour round their tips. The stripe's plainness beyond each
// ski's middle (a sky is plain throughout), and the share of the top
// corners and middle in its colour (a gap merely left plain has none).
function drawnSkis(image: ImageData) {
  const { width: w, height: h } = image;
  const from = Math.round(0.15 * h);
  const to = Math.round(0.85 * h);
  // Per column, its median colour and the share of rows close to it.
  const columns = Array.from({ length: w }, (_, x) => {
    const rows = Array.from({ length: to - from }, (_, k) =>
      colourAt(image, x, from + k),
    );
    const colour = [0, 1, 2].map((j) => median(rows.map((c) => c[j])));
    const plain = rows.filter((c) => difference(c, colour) < 24).length;
    return { colour, share: plain / rows.length };
  });
  const shares = (a: number, b: number) =>
    columns.slice(Math.round(a * w), Math.round(b * w)).map((c) => c.share);
  const middle = shares(0.35, 0.65);
  const x = Math.round(0.35 * w) + middle.indexOf(Math.max(...middle));
  const gap =
    columns[x].share -
    Math.max(median(shares(0.18, 0.32)), median(shares(0.68, 0.82)));

  const spots = Array.from({ length: w }, (_, column) => column).filter(
    (column) =>
      column < 0.05 * w || column >= 0.95 * w || Math.abs(column - x) <= 3,
  );
  let hits = 0;
  let count = 0;
  for (let y = 0; y < Math.round(0.06 * h); y++) {
    for (const column of spots) {
      count++;
      if (difference(colourAt(image, column, y), columns[x].colour) < 40) {
        hits++;
      }
    }
  }
  return { gap, tips: hits / count };
}

function colourAt({ data, width }: ImageData, x: number, y: number) {
  const i = (y * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
}

function difference(a: number[], b: number[]) {
  return a.reduce((sum, c, j) => sum + Math.abs(c - b[j]), 0);
}

// The share of colour differences that are clear and point the same way as
// their mean.
function consistent(steps: number[][]) {
  const mean = [0, 1, 2].map(
    (j) => steps.reduce((sum, d) => sum + d[j], 0) / steps.length,
  );
  const length = Math.hypot(...mean) || 1;
  const clear = steps.filter(
    (d) => (d[0] * mean[0] + d[1] * mean[1] + d[2] * mean[2]) / length > 10,
  );
  return clear.length / steps.length;
}

function median(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = sorted.length / 2;
  return middle % 1
    ? sorted[Math.floor(middle)]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
