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

// One copy of a picture as it sits on a ski: its size in mm as painted,
// turned clockwise by turn radians, and mirrored if flip.
interface Stamp {
  image: CanvasImageSource & { width: number; height: number };
  w: number;
  h: number;
  turn: number;
  flip: boolean;
}

// A stamp centered at (x, y) on a target, in its pixels. Only the ones with
// judge set count toward whether it needs a keyline: a copy that runs off
// its own ski onto the other isn't judged there.
interface Placing {
  target: Target;
  x: number;
  y: number;
  stamp: Stamp;
  judge: boolean;
}

// The decals over art already drawn on each ski, left then right. With
// reuse, each keeps the keyline it last had (stampAll).
export function drawDecals(
  ski: Ski,
  decals: Placed[] | undefined,
  skis: Target[],
  reuse = false,
) {
  for (const decal of decals ?? []) {
    const fit = fitDecal(ski, decal, decal.image.width, decal.image.height);
    stampAll(
      skis.flatMap((target, side) =>
        onSide(decal, side)
          ? [
              {
                judge: true,
                stamp: {
                  flip: decal.mirror && side === 1,
                  h: fit.h,
                  image: decal.image,
                  turn: decal.along ? -Math.PI / 2 : 0,
                  w: fit.w,
                },
                target,
                x: target.left + (ski.span / 2) * target.px,
                y: target.top + fit.center * target.px,
              },
            ]
          : [],
      ),
      reuse,
    );
  }
}

// The keyline each picture last had, so a picture being dragged keeps it
// rather than reading the art back every frame.
const lastKeyline = new WeakMap<object, string | null>();

// A picture's copies, each with a keyline if the art is too busy for it to
// read on any: a keyline on one is a keyline on all. Only copies with
// judge set count; with none, it has no keyline.
export function stampAll(placings: Placing[], reuse = false) {
  const judging = placings.filter((placing) => placing.judge);
  const image = placings[0]?.stamp.image;
  let keyline: string | null = null;
  if (judging.length && image) {
    if (reuse && lastKeyline.has(image)) {
      keyline = lastKeyline.get(image)!;
    } else {
      keyline = keylineFor(judging);
      lastKeyline.set(image, keyline);
    }
  }
  for (const placing of placings) {
    const { stamp, target, x, y } = placing;
    if (keyline) drawKeyline(target, placing, stamp, keyline);
    drawStamp(target.ctx, stamp, x, y, target.px);
  }
}

// White or ink, whichever stands out more from the art round it, if the
// art is too busy for the picture alone; otherwise none.
function keylineFor(placings: Placing[]) {
  const judged = placings.map((placing) =>
    judge(placing.target, placing, placing.stamp),
  );
  if (!judged.some(({ lost }) => lost > BUSY)) return null;
  const under = judged.reduce((sum, { art }) => sum + art, 0) / judged.length;
  return contrast(under, hexLuminance(COLORS.white)) >
    contrast(under, hexLuminance(COLORS.ink))
    ? COLORS.white
    : COLORS.ink;
}

// The stamp centered at (x, y), px pixels per mm.
function drawStamp(
  ctx: CanvasRenderingContext2D,
  stamp: Stamp,
  x: number,
  y: number,
  px: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(stamp.turn);
  if (stamp.flip) ctx.scale(-1, 1);
  ctx.imageSmoothingQuality = "high";
  const w = stamp.w * px;
  const h = stamp.h * px;
  ctx.drawImage(stamp.image, -w / 2, -h / 2, w, h);
  ctx.restore();
}

// What the stamp covers on its ski, in mm, once it's turned.
function boxOf({ h, turn, w }: Stamp) {
  const [cos, sin] = [Math.abs(Math.cos(turn)), Math.abs(Math.sin(turn))];
  return { h: w * sin + h * cos, w: w * cos + h * sin };
}

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
  drawStamp(shape, stamp, w / 2, h / 2, JUDGE);

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
    drawStamp(
      layer,
      stamp,
      cx + r * Math.cos(angle),
      cy + r * Math.sin(angle),
      px,
    );
  }
  layer.globalCompositeOperation = "source-in";
  layer.fillStyle = color;
  layer.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
  ctx.drawImage(layer.canvas, at.x - cx, at.y - cy);
}
