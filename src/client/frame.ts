// Where the pair sits on its art, which the image model paints wider than
// the pair. Every view and the print file cut the art from here.

import { GAP, type Ski } from "./ski";

// The pair's center, as shares of the art's width and height, and its size,
// 1 being the biggest that fits. The same at every length, as the art is.
// Flipped, the art is mirrored left to right, and x is measured on that.
export interface Frame {
  x: number;
  y: number;
  size: number;
  flip?: boolean;
}

export const DEFAULT_FRAME: Frame = { size: 1, x: 0.5, y: 0.5 };

// Any smaller and the art prints too soft.
export const MIN_SIZE = 0.8;

// Art kept round the pair for the print to bleed into, in mm.
export const BUFFER = 10;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

// The pair on a piece of art: its scale in art pixels per mm, its top-left
// corner, and its box with the buffer, in art pixels. The box stays on the
// art, so each length cuts as near the frame's spot as it fits.
export function placement(
  ski: Ski,
  width: number,
  height: number,
  frame = DEFAULT_FRAME,
) {
  const pair = 2 * ski.span + GAP;
  const boxWidth = pair + 2 * BUFFER;
  const boxHeight = ski.length + 2 * BUFFER;
  const size = clamp(frame.size, MIN_SIZE, 1);
  const scale = Math.min(width / boxWidth, height / boxHeight) * size;
  const w = boxWidth * scale;
  const h = boxHeight * scale;
  const cx = clamp(frame.x * width, w / 2, width - w / 2);
  const cy = clamp(frame.y * height, h / 2, height - h / 2);
  return {
    box: { h, w, x: cx - w / 2, y: cy - h / 2 },
    scale,
    x0: cx - (pair * scale) / 2,
    y0: cy - (ski.length * scale) / 2,
  };
}

// The art to crop for a length (sx, sy, sw, sh) and the whole pixels to
// crop it to (w, h). The height sets the scale and the width rounds up into
// the buffer, so the default frame on the crop cuts the same pair, but stays
// on the art: some browsers draw nothing from a rect that runs off it.
export function cropRect(
  ski: Ski,
  width: number,
  height: number,
  frame?: Frame,
) {
  const { box } = placement(ski, width, height, frame);
  const h = Math.round(box.h);
  const k = h / box.h; // crop pixels per art pixel
  const w = Math.min(Math.ceil(box.w * k), Math.floor(width * k));
  const sw = w / k;
  return {
    h,
    sh: box.h,
    sw,
    sx: clamp(box.x - (sw - box.w) / 2, 0, Math.max(0, width - sw)),
    sy: box.y,
    w,
  };
}

// A frame moved onto the art for a length, as placement cuts it.
export function clampFrame(
  ski: Ski,
  width: number,
  height: number,
  frame = DEFAULT_FRAME,
): Frame {
  const { box } = placement(ski, width, height, frame);
  return {
    ...(frame.flip && { flip: true }),
    size: clamp(frame.size, MIN_SIZE, 1),
    x: (box.x + box.w / 2) / width,
    y: (box.y + box.h / 2) / height,
  };
}

// Mirrors the art under the pair, which stays over the same part of it.
export function flipFrame({ flip, ...frame }: Frame): Frame {
  return { ...frame, ...(!flip && { flip: true }), x: 1 - frame.x };
}

export function isFrame(value: unknown): value is Frame {
  const frame = value as Frame | null;
  const share = (n: unknown) => typeof n === "number" && n >= 0 && n <= 1;
  return (
    typeof frame === "object" &&
    frame !== null &&
    share(frame.x) &&
    share(frame.y) &&
    share(frame.size) &&
    frame.size >= MIN_SIZE &&
    (frame.flip === undefined || typeof frame.flip === "boolean")
  );
}

export function frameKey({ flip, size, x, y } = DEFAULT_FRAME) {
  return `${x},${y},${size}${flip ? ",flip" : ""}`;
}
