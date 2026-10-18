// Topsheets: the art cut to each ski of the pair, with the wood window and
// the marks, and the pair laid flat as it would be cut.

import { COLORS } from "./colors";
import {
  markScale,
  marks,
  OUTLINE,
  TEXTURE,
  windowSpan,
  type Mark,
} from "./marks";
import { bootCenter, PARTS, type Part } from "./binding";
import { GAP, halfWidth, outline, WINDOW, type Ski } from "./ski";

type Art = CanvasImageSource & { width: number; height: number };

// The plain black topsheet: the stock pair, and the studio's blank canvas.
export function blankArt() {
  const canvas = document.createElement("canvas");
  canvas.width = 352;
  canvas.height = 2816;
  // Kept in memory rather than on the GPU: it is only ever drawn into
  // topsheets that are read back, and GPU readback is slow.
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

export type Topsheets = [HTMLCanvasElement, HTMLCanvasElement];

// Each ski's mark colour and outline ("" for none), left then right.
export interface Ink {
  marks: string[];
  outlines: string[];
}

// Each ski's mark colours as addBranding left them on its sheet.
export function inkOf(sheets: Topsheets): Ink {
  return {
    marks: sheets.map((sheet) => sheet.dataset.ink!),
    outlines: sheets.map((sheet) => sheet.dataset.outline ?? ""),
  };
}

// A topsheet covers its ski's bounding box at a fixed scale, so the outline
// cuts the art rather than squeezing it.
function sheet(ski: Ski, height: number) {
  const canvas = document.createElement("canvas");
  canvas.height = height;
  canvas.width = Math.round((height * ski.span) / ski.length);
  return canvas;
}

// The tallest a topsheet is drawn, in pixels. The studio's is about the
// art's own resolution, so the art and marks stay sharp zoomed in 3D;
// smaller copies, like the home page's rack, need far less.
export const STUDIO_HEIGHT = 4096;

export function artTopsheets(
  ski: Ski,
  art: Art,
  maxHeight = 2048,
  ink?: Ink,
): Topsheets {
  const pair = 2 * ski.span + GAP;
  // Pixels per millimetre that fill the pair, trimming the long side.
  const scale = Math.min(art.width / pair, art.height / ski.length);
  const x0 = (art.width - pair * scale) / 2;
  const y0 = (art.height - ski.length * scale) / 2;
  const height = Math.min(maxHeight, Math.round(ski.length * scale * 1.25));

  const sheets = [0, 1].map((side) => {
    const canvas = sheet(ski, height);
    // Branding reads the art back to pick a legible colour.
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      art,
      x0 + side * (ski.span + GAP) * scale,
      y0,
      ski.span * scale,
      ski.length * scale,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return canvas;
  }) as Topsheets;

  for (const sheet of sheets) {
    bleedEdges(ski, sheet);
    addWindow(ski, sheet);
  }
  addBranding(ski, sheets, ink);
  return sheets;
}

function addWindow(ski: Ski, sheet: HTMLCanvasElement) {
  const ctx = sheet.getContext("2d")!;
  const px = sheet.height / ski.length;
  const { from, to } = windowSpan(ski);
  const y0 = from * px;
  const y1 = to * px;
  const width = 2 * halfWidth(ski, (from + to) / 2);
  const cx = sheet.width / 2;
  // Strips run to the sheet edges so the outline, not the window, cuts them.
  const edges = [0];
  for (const [share] of WINDOW.strips) edges.push(edges.at(-1)! + share);
  const xAt = (u: number) =>
    u <= 0 ? 0 : u >= 1 ? sheet.width : cx + (u - 0.5) * width * px;

  ctx.save();
  WINDOW.strips.forEach(([, color], i) => {
    const x = xAt(edges[i]);
    ctx.fillStyle = color;
    ctx.fillRect(x, y0, xAt(edges[i + 1]) - x, y1 - y0);
  });

  // Fine grain running along the ski.
  let seed = 541;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  ctx.globalCompositeOperation = "multiply";
  for (let x = 0; x < sheet.width; x += Math.max(1, px * 0.6)) {
    ctx.fillStyle = `rgba(90, 60, 40, ${0.05 + 0.12 * random() ** 3})`;
    ctx.fillRect(x, y0, Math.max(1, px * 0.4), y1 - y0);
  }

  // The topsheet edge casts a little shade into the window.
  ctx.globalCompositeOperation = "source-over";
  const shade = Math.max(2, px * 2);
  const top = ctx.createLinearGradient(0, y0, 0, y0 + shade);
  top.addColorStop(0, "rgba(20, 10, 8, 0.45)");
  top.addColorStop(1, "rgba(20, 10, 8, 0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, y0, sheet.width, shade);
  const bottom = ctx.createLinearGradient(0, y1 - shade * 0.6, 0, y1);
  bottom.addColorStop(0, "rgba(20, 10, 8, 0)");
  bottom.addColorStop(1, "rgba(20, 10, 8, 0.25)");
  ctx.fillStyle = bottom;
  ctx.fillRect(0, y1 - shade * 0.6, sheet.width, shade * 0.6);
  ctx.restore();
}

// The pair cut from a piece of art and laid flat, the given height tall.
// Its topsheets are cut at twice that, as anything finer only costs time.
export function cutPair(ski: Ski, art: Art, height: number, ink?: Ink) {
  return renderFlat(
    ski,
    artTopsheets(ski, art, Math.min(2048, 2 * height), ink),
    height,
  );
}

// One ski's outline as a path, its tip at (cx, top), px pixels per mm.
export function outlinePath(ski: Ski, cx: number, top: number, px: number) {
  const path = new Path2D();
  outline(ski).forEach(([x, s], i) => {
    if (i) path.lineTo(cx + x * px, top + s * px);
    else path.moveTo(cx + x * px, top + s * px);
  });
  path.closePath();
  return path;
}

// Room above and below a flat pair for its shadow, as a share of its height.
// The pair-fill utility in styles.css lets the drawing overhang its slot by
// this much, so the skis themselves fill it.
export const PAD = 0.02;

// The height to draw a pair at so it fills a pair-fill slot, in device
// pixels.
export function fillHeight(slot: HTMLElement) {
  return Math.round((slot.clientHeight / (1 - 2 * PAD)) * devicePixelRatio);
}

// A canvas for the pair laid flat side by side, with each ski's left edge
// and outline on it.
function flatPair(ski: Ski, height: number) {
  const pad = Math.round(height * PAD);
  const px = (height - 2 * pad) / ski.length;
  const canvas = document.createElement("canvas");
  canvas.height = height;
  canvas.width = Math.round((2 * ski.span + GAP) * px + 2 * pad);
  const skis = [0, 1].map((side) => {
    const left = pad + side * (ski.span + GAP) * px;
    const path = outlinePath(ski, left + (ski.span / 2) * px, pad, px);
    return { left, path };
  });
  return { canvas, ctx: canvas.getContext("2d")!, pad, px, skis };
}

// The pair as it would be cut, laid flat side by side.
export function renderFlat(
  ski: Ski,
  sheets: Topsheets,
  height: number,
  { bindings = false } = {},
) {
  const { canvas, ctx, pad, px, skis } = flatPair(ski, height);

  sheets.forEach((sheet, side) => {
    const { left, path } = skis[side];

    ctx.save();
    ctx.shadowColor = "rgba(20, 10, 14, 0.18)";
    ctx.shadowBlur = px * 12;
    ctx.shadowOffsetY = px * 4;
    ctx.fillStyle = COLORS.white;
    ctx.fill(path);
    ctx.restore();

    ctx.save();
    ctx.clip(path);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(sheet, left, pad, ski.span * px, ski.length * px);
    ctx.restore();

    ctx.lineWidth = Math.max(1, px * 1.2);
    ctx.strokeStyle = "rgba(20, 10, 14, 0.25)";
    ctx.stroke(path);

    if (bindings) drawBinding(ctx, ski, left + (ski.span / 2) * px, pad, px);
  });

  return canvas;
}

// Just the pair's outline, dashed, for a place a pair could go.
export function dashedPair(ski: Ski, height: number) {
  const { canvas, ctx, skis } = flatPair(ski, height);
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = COLORS.muted;
  for (const { path } of skis) ctx.stroke(path);
  return canvas;
}

const FLAT_FILL: Record<Part["kind"], string> = {
  brake: "#3a3a3d",
  housing: "#1d1b1c",
  metal: "#6f7276",
  plate: "#2c2a2b",
};

// The binding from above, lowest parts first so the housings sit on top.
function drawBinding(
  ctx: CanvasRenderingContext2D,
  ski: Ski,
  cx: number,
  top: number,
  px: number,
) {
  const center = bootCenter(ski);
  ctx.save();
  ctx.shadowColor = "rgba(20, 10, 14, 0.35)";
  ctx.shadowBlur = px * 6;
  ctx.shadowOffsetY = px * 2;
  for (const part of [...PARTS].sort((a, b) => a.up[1] - b.up[1])) {
    const y = top + (center + part.along[0]) * px;
    const length = (part.along[1] - part.along[0]) * Math.cos(part.tilt ?? 0);
    ctx.fillStyle = FLAT_FILL[part.kind];
    ctx.beginPath();
    ctx.roundRect(
      cx - (part.across / 2) * px,
      y,
      part.across * px,
      length * px,
      Math.min(4, part.across / 4) * px,
    );
    ctx.fill();
  }
  ctx.restore();
}

// The image model sometimes draws the ski outline from its guide, a hair
// off the real cut, which shows as a thin line round the edge. Where it
// has, repainting a band just inside the edge from the art further in hides
// it; other art is left as it is, running right to the cut as it prints.
// Its rounded tips land furthest off, so the band runs deeper at the ends.
const EDGE_BAND = 3; // mm, along the sides
const END_BAND = 9; // mm, at the tip and tail
// How strong a line along the cut has to be, in levels of brightness, to
// count as a copied outline. The examples measure up to 7; art with a
// visible copied outline, from about 9.
const STRAY = 8;

// How strongly the art has a line following the cut just inside it: for
// each depth into the band, how far the art there differs in brightness,
// on average all the way round, from the art just past the band. Texture
// averages out; a copied outline, the same at one depth all round, doesn't.
function strayOutline(ski: Ski, data: Uint32Array, w: number, h: number) {
  const px = h / ski.length;
  const cx = w / 2;
  const depth = Math.ceil((EDGE_BAND + 1) * px);
  const lum = (v: number) =>
    (2 * (v & 255) + 5 * ((v >> 8) & 255) + ((v >> 16) & 255)) / 8;
  const sums = new Float64Array(depth);
  let n = 0;
  for (let s = 100; s < ski.length - 100; s += 2) {
    const y = Math.round(s * px) * w;
    const edge = halfWidth(ski, s) * px;
    const left = Math.ceil(cx - edge);
    const right = Math.floor(cx + edge) - 1;
    const refL = lum(data[y + left + depth + 2]);
    const refR = lum(data[y + right - depth - 2]);
    for (let d = 0; d < depth; d++) {
      sums[d] += lum(data[y + left + d]) - refL;
      sums[d] += lum(data[y + right - d]) - refR;
    }
    n += 2;
  }
  return Math.max(...sums.map((sum) => Math.abs(sum / n)));
}

function bleedEdges(ski: Ski, sheet: HTMLCanvasElement) {
  const ctx = sheet.getContext("2d", { willReadFrequently: true })!;
  const { width: w, height: h } = sheet;
  const image = ctx.getImageData(0, 0, w, h);
  const data = new Uint32Array(image.data.buffer);
  if (strayOutline(ski, data, w, h) < STRAY) return;
  const px = h / ski.length;
  const cx = w / 2;
  // Each row's art is mirrored out from just inside the band to the sheet
  // edge, and the rows at the very tip and tail mirror the rows inside
  // them, so the band keeps the art's texture rather than smearing one
  // pixel across it.
  const first = Math.ceil(END_BAND * px);
  const last = Math.floor((ski.length - END_BAND) * px);
  for (let y = first; y <= last; y++) {
    const s = (y + 0.5) / px;
    const fromEnd = Math.min(s, ski.length - s);
    const band = EDGE_BAND + 4 * Math.max(0, 1 - fromEnd / 80);
    // The narrowest the ski gets within the band's reach, so the band
    // follows the curve of the tip and tail too.
    const half = Math.min(
      halfWidth(ski, s - band),
      halfWidth(ski, s),
      halfWidth(ski, s + band),
    );
    const inner = Math.max(1, Math.floor((half - band) * px));
    const row = y * w;
    const l = Math.max(0, Math.floor(cx - inner));
    const r = Math.min(w - 1, Math.ceil(cx + inner));
    for (let x = 0; x < l; x++) {
      data[row + x] = data[row + Math.min(2 * l - x, r)];
    }
    for (let x = r + 1; x < w; x++) {
      data[row + x] = data[row + Math.max(2 * r - x, l)];
    }
  }
  for (let y = 0; y < first; y++) {
    const from = Math.min(2 * first - y, last);
    data.copyWithin(y * w, from * w, from * w + w);
  }
  for (let y = last + 1; y < h; y++) {
    const from = Math.max(2 * last - y, first);
    data.copyWithin(y * w, from * w, from * w + w);
  }
  ctx.putImageData(image, 0, 0);
}

// Contrast (WCAG) between two luminances.
const contrast = (a: number, b: number) =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

// Relative luminance (WCAG) of the pixel at i in RGBA data.
function luminanceAt(data: ArrayLike<number>, i: number) {
  const linear = (c: number) =>
    (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return (
    0.2126 * linear(data[i]) +
    0.7152 * linear(data[i + 1]) +
    0.0722 * linear(data[i + 2])
  );
}

const hexLuminance = (hex: string) =>
  luminanceAt(
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)),
    0,
  );
const onWhite = (l: number) => contrast(l, hexLuminance(COLORS.white));
const onInk = (l: number) => contrast(l, hexLuminance(COLORS.ink));

// Relative luminance of a patch of the art.
function luminance(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const { data } = ctx.getImageData(
    Math.max(0, Math.round(x)),
    Math.max(0, Math.round(y)),
    Math.max(1, Math.round(w)),
    Math.max(1, Math.round(h)),
  );
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += luminanceAt(data, i);
  return sum / (data.length / 4);
}

// White or ink for each piece of the pair's branding, given the luminance
// under each. They match when one colour reads well on all of them (WCAG
// 3:1, the bar for large graphics); on art that runs from light to dark,
// each takes whichever reads best where it sits.
function inkFor(spots: number[]) {
  const white = Math.min(...spots.map(onWhite));
  const dark = Math.min(...spots.map(onInk));
  if (Math.max(white, dark) >= 3) {
    return spots.map(() => (dark > white ? COLORS.ink : COLORS.white));
  }
  return spots.map((l) => (onInk(l) > onWhite(l) ? COLORS.ink : COLORS.white));
}

// How much of a mark can be lost in the art before it gets an outline.
// Measured on the examples, marks that read fine lose up to 17%, and ones
// that don't, 29% or more.
const BUSY = 0.25;

// The luminance of the art under each pixel of a mark, blurred so a
// fabric's weave or fine linework doesn't count as busy.
function artUnder(sheet: HTMLCanvasElement, mark: Mark, px: number) {
  // The mark's box, with room for the blur to take in what's around it.
  const pad = Math.ceil(2 * TEXTURE * px);
  const x = Math.floor(sheet.width / 2 + mark.box.x * px) - pad;
  const y = Math.floor(mark.box.y * px) - pad;
  const w = Math.ceil(mark.box.w * px) + 2 * pad;
  const h = Math.ceil(mark.box.h * px) + 2 * pad;
  const layer = () => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    return canvas.getContext("2d", { willReadFrequently: true })!;
  };

  const art = layer();
  art.filter = `blur(${TEXTURE * px}px)`;
  art.drawImage(sheet, -x, -y);
  const shape = layer();
  shape.translate(sheet.width / 2 - x, -y);
  shape.scale(px, px);
  shape.transform(...mark.matrix);
  shape.fill(new Path2D(mark.path));

  const under = art.getImageData(0, 0, w, h).data;
  const inside = shape.getImageData(0, 0, w, h).data;
  const lums: number[] = [];
  for (let i = 0; i < inside.length; i += 4) {
    if (inside[i + 3] >= 128) lums.push(luminanceAt(under, i));
  }
  return lums;
}

// The share of a mark that would fall under 3:1 contrast in a colour.
function lostShare(under: number[], color: string) {
  const own = hexLuminance(color);
  let lost = 0;
  for (const l of under) if (contrast(l, own) < 3) lost++;
  return under.length ? lost / under.length : 0;
}

// The colours that make up a real part of the art (5% or more), pooled
// coarsely so a texture's shades count as one.
function palette(...sheets: HTMLCanvasElement[]) {
  const pools = new Map<number, { n: number; rgb: number[] }>();
  let total = 0;
  for (const sheet of sheets) {
    const small = document.createElement("canvas");
    small.width = 32;
    small.height = Math.round((32 * sheet.height) / sheet.width);
    const ctx = small.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(sheet, 0, 0, small.width, small.height);
    const { data } = ctx.getImageData(0, 0, small.width, small.height);
    total += data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const key =
        ((data[i] >> 5) << 6) | ((data[i + 1] >> 5) << 3) | (data[i + 2] >> 5);
      const pool = pools.get(key) ?? { n: 0, rgb: [0, 0, 0] };
      pool.n++;
      for (let k = 0; k < 3; k++) pool.rgb[k] += data[i + k];
      pools.set(key, pool);
    }
  }
  return [...pools.values()]
    .filter(({ n }) => n >= 0.05 * total)
    .map(({ n, rgb }) => {
      const hex = rgb.map((sum) => Math.round(sum / n).toString(16));
      return `#${hex.map((c) => c.padStart(2, "0")).join("")}`;
    });
}

// How much of a mark one of the art's own colours can lose and still fill
// it in place of white or ink.
const READS = 0.05;

// Each mark's fill: the art colour that loses least on both marks, if one
// reads on both, so the marks look part of the design; failing that, each
// mark's own best art colour, or white or ink where none reads.
function fillsFor(under: number[][], colors: string[], spots: number[]) {
  const scored = colors.map((color) => ({
    color,
    lost: under.map((lums) => lostShare(lums, color)),
  }));
  const best = (score: (lost: number[]) => number) =>
    scored
      .filter(({ lost }) => score(lost) <= READS)
      .sort((a, b) => score(a.lost) - score(b.lost))[0]?.color;

  const both = best((lost) => Math.max(...lost));
  if (both) return under.map(() => both);
  const plain = inkFor(spots);
  return under.map((_, i) => best((lost) => lost[i]) ?? plain[i]);
}

// The colour to outline a mark in: the art's colour that stands out most
// from its fill, or, failing one that reaches 3:1, white or ink.
function outlineColor(colors: string[], fill: string) {
  const mark = hexLuminance(fill);
  let best = {
    contrast: 3,
    hex: onWhite(mark) > onInk(mark) ? COLORS.white : COLORS.ink,
  };
  for (const hex of colors) {
    const stands = contrast(hexLuminance(hex), mark);
    if (stands >= best.contrast) best = { contrast: stands, hex };
  }
  return best.hex;
}

// The marks (see marks.ts), in the given ink or as pickInk chooses. Each
// sheet keeps its mark's fill in data-ink and its outline's colour, if any,
// in data-outline, for the print file and the gallery.
function addBranding(ski: Ski, sheets: Topsheets, ink?: Ink) {
  const px = sheets[0].height / ski.length;
  const { marks: fills, outlines } = ink ?? pickInk(ski, sheets, px);
  marks(ski).forEach((mark, i) => {
    const canvas = sheets[i];
    const ctx = canvas.getContext("2d")!;
    canvas.dataset.ink = fills[i];
    canvas.dataset.outline = outlines[i];
    const path = new Path2D(mark.path);
    ctx.save();
    ctx.translate(canvas.width / 2, 0);
    ctx.scale(px, px);
    ctx.transform(...mark.matrix);
    if (outlines[i]) {
      ctx.lineJoin = "round";
      ctx.lineWidth = OUTLINE / markScale(mark);
      ctx.strokeStyle = outlines[i];
      ctx.stroke(path);
    }
    ctx.fillStyle = fills[i];
    ctx.fill(path);
    ctx.restore();
  });
}

// Fills as fillsFor picks, with both marks outlined if the art under either
// is too busy for its fill alone.
function pickInk(ski: Ski, sheets: Topsheets, px: number): Ink {
  const placed = marks(ski).map((mark, i) => {
    const canvas = sheets[i];
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const { box } = mark;
    const spot = luminance(
      ctx,
      canvas.width / 2 + box.x * px,
      box.y * px,
      box.w * px,
      box.h * px,
    );
    return { canvas, spot, under: artUnder(canvas, mark, px) };
  });
  const fills = fillsFor(
    placed.map(({ under }) => under),
    palette(...sheets),
    placed.map(({ spot }) => spot),
  );
  const busy = placed.some(({ under }, i) => lostShare(under, fills[i]) > BUSY);
  return {
    marks: fills,
    outlines: placed.map(({ canvas }, i) =>
      busy ? outlineColor(palette(canvas), fills[i]) : "",
    ),
  };
}
