// Decals drawn over the art on each ski, in their spots (decals.ts), with a
// keyline round any that would be lost in busy art.

import { COLORS } from "./colors";
import { contrast, hexLuminance, luminanceAt } from "./contrast";
import type { Placed } from "./cutout";
import { fitDecal, onSide } from "./decals";
import { TEXTURE } from "./marks";
import type { Ski } from "./ski";

// Where a ski is drawn: its box at (left, top), px pixels per mm.
export interface Target {
  ctx: CanvasRenderingContext2D;
  left: number;
  top: number;
  px: number;
}

// On art too busy for a decal to read against, it gets a keyline: this
// wide, in mm, in white or ink, whichever stands out more from the art
// round it. As with the marks, busy means more than this share of it would
// be under 3:1 contrast with the art beneath, judged with the art blurred
// by TEXTURE so fine linework doesn't count.
const KEYLINE = 1.4;
const BUSY = 0.35;
// The scale it's judged at, in pixels per mm, so every size of preview
// agrees.
const JUDGE = 2;

type Fit = ReturnType<typeof fitDecal>;

// One decal on one ski: side is 0 for the left ski, 1 for the right.
interface Stamp {
  decal: Placed;
  fit: Fit;
  side: number;
}

// The decals over art already drawn on each ski, left then right. They're
// drawn the same on both skis: a keyline on one is a keyline on both.
export function drawDecals(
  ski: Ski,
  decals: Placed[] | undefined,
  skis: Target[],
) {
  for (const decal of decals ?? []) {
    const fit = fitDecal(ski, decal, decal.image.width, decal.image.height);
    const on = skis.flatMap((target, side) =>
      onSide(decal, side)
        ? [
            {
              at: centerOf(target, ski, fit),
              stamp: { decal, fit, side },
              target,
            },
          ]
        : [],
    );
    if (!on.length) continue;
    const judged = on.map(({ at, stamp, target }) => judge(target, at, stamp));
    const busy = judged.some(({ lost }) => lost > BUSY);
    const under = judged.reduce((sum, { art }) => sum + art, 0) / judged.length;
    const keyline =
      contrast(under, hexLuminance(COLORS.white)) >
      contrast(under, hexLuminance(COLORS.ink))
        ? COLORS.white
        : COLORS.ink;
    for (const { at, stamp, target } of on) {
      if (busy) drawKeyline(target, at, stamp, keyline);
      draw(target.ctx, stamp, at.x, at.y, target.px);
    }
  }
}

// The decal's center on a ski, in the target's pixels.
function centerOf({ left, px, top }: Target, ski: Ski, fit: Fit) {
  return { x: left + (ski.span / 2) * px, y: top + fit.center * px };
}

// The decal centered at (x, y), px pixels per mm, turned and mirrored as
// it sits on its ski.
function draw(
  ctx: CanvasRenderingContext2D,
  { decal, fit, side }: Stamp,
  x: number,
  y: number,
  px: number,
) {
  ctx.save();
  ctx.translate(x, y);
  if (decal.along) ctx.rotate(-Math.PI / 2);
  if (decal.mirror && side) ctx.scale(-1, 1);
  ctx.imageSmoothingQuality = "high";
  const w = fit.w * px;
  const h = fit.h * px;
  ctx.drawImage(decal.image, -w / 2, -h / 2, w, h);
  ctx.restore();
}

// What the decal covers on its ski, in mm, once it's turned.
const boxOf = ({ decal, fit }: Stamp) =>
  decal.along ? { h: fit.w, w: fit.h } : { h: fit.h, w: fit.w };

function scratch(w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  return canvas.getContext("2d", { willReadFrequently: true })!;
}

// How much of the decal would be lost in the art under it, and the art's
// mean luminance there.
function judge(
  { ctx, px }: Target,
  at: { x: number; y: number },
  stamp: Stamp,
) {
  const box = boxOf(stamp);
  const art = scratch(box.w * JUDGE, box.h * JUDGE);
  const { height: h, width: w } = art.canvas;
  art.filter = `blur(${TEXTURE * JUDGE}px)`;
  art.drawImage(
    ctx.canvas,
    at.x - (box.w * px) / 2,
    at.y - (box.h * px) / 2,
    box.w * px,
    box.h * px,
    0,
    0,
    w,
    h,
  );
  const shape = scratch(w, h);
  draw(shape, stamp, w / 2, h / 2, JUDGE);

  const under = art.getImageData(0, 0, w, h).data;
  const own = shape.getImageData(0, 0, w, h).data;
  let lost = 0;
  let count = 0;
  let sum = 0;
  for (let i = 0; i < own.length; i += 4) {
    const l = luminanceAt(under, i);
    sum += l;
    if (own[i + 3] < 128) continue;
    count++;
    if (contrast(luminanceAt(own, i), l) < 3) lost++;
  }
  return { art: sum / (w * h), lost: count ? lost / count : 0 };
}

// The decal's outline grown by KEYLINE, filled in one colour, under it.
function drawKeyline(
  { ctx, px }: Target,
  at: { x: number; y: number },
  stamp: Stamp,
  color: string,
) {
  const box = boxOf(stamp);
  const grow = KEYLINE * px;
  const pad = Math.ceil(grow) + 2;
  const layer = scratch(box.w * px + 2 * pad, box.h * px + 2 * pad);
  const cx = layer.canvas.width / 2;
  const cy = layer.canvas.height / 2;
  // The decal stamped round a circle, and once in the middle.
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const angle = (2 * Math.PI * i) / steps;
    const r = i === steps ? 0 : grow;
    draw(layer, stamp, cx + r * Math.cos(angle), cy + r * Math.sin(angle), px);
  }
  layer.globalCompositeOperation = "source-in";
  layer.fillStyle = color;
  layer.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
  ctx.drawImage(layer.canvas, at.x - cx, at.y - cy);
}
