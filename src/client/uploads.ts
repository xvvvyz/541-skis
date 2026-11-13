// Your own images: pictures the customer adds and places anywhere on the
// skis, stacked in order over the art and its decals, but under the window
// and the marks, which the shop prints on top. A decal moved by hand joins
// them, out of its spot. The worker checks them with this too, so it stays
// free of the browser.

import { fitDecal, SIDES, type Layer, type Side } from "./decals";
import { GAP, type Ski } from "./ski";

export interface Upload {
  // The picture, in R2 under uploads/<id>, or decals/<id> for a decal.
  id: string;
  kind?: "decal";
  ski: Side;
  // Its center: x in mm across from its ski's center line, y as a share of
  // the length from the tip, so it sits in the same spot at every length.
  x: number;
  y: number;
  // Its width in mm, before it's turned; its height follows the picture.
  w: number;
  // Turned clockwise, in degrees.
  r: number;
  // On both skis, mirrored on the right one, so the two face each other.
  mirror?: boolean;
}

export const MAX_UPLOADS = 12;
// The smallest an image is drawn, in mm across.
export const MIN_WIDTH = 8;

const within = (n: unknown, min: number, max: number): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;

// The images as sent, tidied, or null if they don't look right.
export function readUploads(value: unknown): Upload[] | null {
  if (!Array.isArray(value) || value.length > MAX_UPLOADS) return null;
  for (const item of value as Partial<Upload>[]) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !/^[\w-]{16}$/.test(item.id) ||
      !SIDES.includes(item.ski as Side) ||
      !within(item.x, -1000, 1000) ||
      !within(item.y, -1, 2) ||
      !within(item.w, MIN_WIDTH, 4000) ||
      !within(item.r, -360, 360)
    ) {
      return null;
    }
    if (item.kind !== undefined && item.kind !== "decal") return null;
  }
  return plainUploads(value as Upload[]);
}

export const uploadsKey = (uploads?: Upload[]) =>
  JSON.stringify(plainUploads(uploads));

// Just what's saved, without anything the browser has added.
export const plainUploads = (uploads: Upload[] = []): Upload[] =>
  uploads.map(({ id, kind, mirror, r, ski, w, x, y }) => ({
    id,
    ...(kind === "decal" && { kind }),
    r,
    ski,
    w,
    x,
    y,
    ...(mirror && { mirror: true }),
  }));

// The skis an image is on, 0 for the left and 1 for the right.
export const anchorsOf = ({ ski }: Upload) =>
  ski === "both" ? [0, 1] : [ski === "right" ? 1 : 0];

// The middle of a ski's strip, in mm from the left ski's left edge.
export const skiCenter = (ski: Ski, side: number) =>
  side * (ski.span + GAP) + ski.span / 2;

// One copy of an image on the pair: its center in mm, across from the left
// ski's left edge and down from the tip, whether it's mirrored, and its turn.
export function copyOf(ski: Ski, upload: Upload, anchor: number) {
  const flip = !!upload.mirror && upload.ski === "both" && anchor === 1;
  return {
    cx: skiCenter(ski, anchor) + (flip ? -upload.x : upload.x),
    cy: upload.y * ski.length,
    flip,
    r: flip ? -upload.r : upload.r,
  };
}

export type Copy = ReturnType<typeof copyOf>;

// Whether a point on the pair, in mm, falls on a copy w x h mm.
export function hits(copy: Copy, w: number, h: number, x: number, y: number) {
  const angle = (-copy.r * Math.PI) / 180;
  const dx = x - copy.cx;
  const dy = y - copy.cy;
  const u = dx * Math.cos(angle) - dy * Math.sin(angle);
  const v = dx * Math.sin(angle) + dy * Math.cos(angle);
  return Math.abs(u) <= w / 2 && Math.abs(v) <= h / 2;
}

// An image not on both skis belongs to whichever its center is over.
export function reanchor<T extends Upload>(ski: Ski, upload: T): T {
  if (upload.ski === "both") return upload;
  const [from] = anchorsOf(upload);
  const cx = skiCenter(ski, from) + upload.x;
  const to = cx > ski.span + GAP / 2 ? 1 : 0;
  if (to === from) return upload;
  return {
    ...upload,
    ski: to ? "right" : "left",
    x: cx - skiCenter(ski, to),
  };
}

// Something fitted in a spot, as a decal is, placed just where it shows
// there, in the same size, turn and mirroring. Its picture is w x h (any
// units).
export function spotUpload(
  ski: Ski,
  layer: Layer,
  w: number,
  h: number,
): Upload {
  const fit = fitDecal(ski, layer, w, h);
  return {
    id: layer.id,
    r: layer.along ? -90 : 0,
    ski: layer.ski,
    w: Math.max(MIN_WIDTH, fit.w),
    x: 0,
    y: fit.center / ski.length,
    ...(layer.mirror && { mirror: true }),
  };
}

// A decal taken out of its spot by hand.
export const freeDecal = (
  ski: Ski,
  layer: Layer,
  w: number,
  h: number,
): Upload => ({
  ...spotUpload(ski, layer, w, h),
  kind: "decal",
});

// The decals that have been moved by hand, which no longer sit in a spot.
export const freedIds = (uploads: Upload[] = []) =>
  new Set(uploads.filter((u) => u.kind === "decal").map((u) => u.id));
