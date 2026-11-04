// Decals: pictures and words the studio places on the skis itself, rather
// than leaving them to the image model. Told where on the skis something
// goes, the model paints skis to put it on; given a spot on the canvas, it
// misses the ski the canvas is cut to. So the art is only the background,
// and each decal is painted on its own and fitted inside a spot on the ski,
// clear of the marks, the bindings and the window, so it's always seen whole.

import { bootCenter, PARTS } from "./binding";
import { marks, windowSpan } from "./marks";
import { halfWidth, type Ski } from "./ski";

// The spots on each ski, tip to tail.
export const SPOTS = ["tip", "front", "middle", "back", "tail"] as const;
export type Spot = (typeof SPOTS)[number];

export const SIDES = ["both", "left", "right"] as const;
export type Side = (typeof SIDES)[number];

export interface Layer {
  // The decal's picture, in R2 under decals/<id>, painted on a flat
  // backdrop the studio cuts away.
  id: string;
  ski: Side;
  at: Spot;
  // 1 is as big as fits the spot.
  size: number;
  // Turned to run along the ski, reading from tail to tip, for words or
  // anything wide. Otherwise upright, its top toward the tip.
  along: boolean;
  // Mirrored on the right ski, so the two can face each other.
  mirror: boolean;
}

// The smallest a decal is drawn, as a share of its spot: any smaller and
// it's lost on the ski.
export const MIN_SIZE = 0.4;

// Room kept round a decal, in mm: to each edge of the ski, which the shop
// bevels, and to the marks, bindings and window on either side of its spot.
const EDGE = 8;
const CLEAR = 12;

// Where a spot runs, in mm from the tip, and the width that's clear all
// along it.
function spotOf(ski: Ski, at: Spot) {
  const [logo, raven] = marks(ski);
  const window = windowSpan(ski);
  const center = bootCenter(ski);
  const toe = center + Math.min(...PARTS.map((part) => part.along[0]));
  const heel = center + Math.max(...PARTS.map((part) => part.along[1]));
  const logoEnd = logo.box.y + logo.box.h;
  const spans: Record<Spot, [number, number]> = {
    back: [heel + CLEAR, window.from - window.border - CLEAR],
    front: [logoEnd + CLEAR, toe - CLEAR],
    middle: [toe, heel],
    tail: [window.to + window.border + CLEAR, raven.box.y - CLEAR],
    // From where the tip has rounded out to nearly its full width.
    tip: [tipStart(ski, logo.box.y - CLEAR), logo.box.y - CLEAR],
  };
  const [from, to] = spans[at];
  let width = Infinity;
  for (let s = from; s <= to; s += 2) {
    width = Math.min(width, 2 * (halfWidth(ski, s) - EDGE));
  }
  return { from, to, width };
}

function tipStart(ski: Ski, end: number) {
  const full = 2 * halfWidth(ski, end);
  let s = 0;
  while (s < end && 2 * halfWidth(ski, s) < 0.9 * full) s++;
  return s;
}

// The decal's own width over its height that fills a spot, as it's painted:
// wide when it's turned along the ski.
export function spotAspect(ski: Ski, at: Spot, along: boolean) {
  const { from, to, width } = spotOf(ski, at);
  return along ? (to - from) / width : width / (to - from);
}

// A decal w x h (any units) fitted in its spot: its center, in mm from the
// tip on the ski's center line, and its size in mm as painted, before it's
// turned.
export function fitDecal(ski: Ski, layer: Layer, w: number, h: number) {
  const { from, to, width } = spotOf(ski, layer.at);
  const [across, down] = layer.along ? [h, w] : [w, h];
  const scale =
    Math.min(width / across, (to - from) / down) *
    Math.min(1, Math.max(MIN_SIZE, layer.size));
  return { center: (from + to) / 2, h: h * scale, w: w * scale };
}

export const onSide = (layer: Layer, side: number) =>
  layer.ski === "both" || layer.ski === (side ? "right" : "left");
