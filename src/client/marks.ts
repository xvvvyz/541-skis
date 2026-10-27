// Where the marks and the wood window sit on a ski, in the ski's own
// millimetres: x across from its center line, y down from the tip. The
// preview and the print file both draw from these, so they match.

import { LOGO, SLANT } from "./logo";
import { RAVEN, RAVEN_SIZE } from "./raven";
import { halfWidth, WINDOW, type Ski } from "./ski";

// A 2D transform as [a, b, c, d, e, f], the way canvas and PDF take it.
type Matrix = [number, number, number, number, number, number];

// The 541 mark near the left ski's tip, as a share of the length. Read
// across the ski, tilted so the 5's slanted stroke runs along the ski's left
// edge, with the same margin to either edge.
const LOGO_AT = 0.165;
const MARGIN = 0.12; // of the ski's width, each side

// The raven near the right ski's tail, small and upright on the center
// line: its middle in mm from the tail, and its height.
const RAVEN_SPOT = { fromTail: 85, height: 40 };

function multiply(...matrices: Matrix[]): Matrix {
  return matrices.reduce(([a, b, c, d, e, f], [g, h, i, j, k, l]) => [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f,
  ]);
}

const move = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
const turn = (angle: number): Matrix => [
  Math.cos(angle),
  Math.sin(angle),
  -Math.sin(angle),
  Math.cos(angle),
  0,
  0,
];
const grow = (by: number): Matrix => [by, 0, 0, by, 0, 0];

// On art too busy for white or ink alone to read, a mark gets an outline:
// this wide, in mm, centered on its edge.
export const OUTLINE = 2.4;
// Detail finer than this, in mm, is blurred away before judging the art
// under a mark, so a fabric's weave or fine linework doesn't count as busy.
export const TEXTURE = 2;

// The box is what the mark covers, for reading the art beneath it.
export interface Mark {
  box: { h: number; w: number; x: number; y: number };
  matrix: Matrix;
  path: string;
}

function logoMark(ski: Ski): Mark {
  const s = LOGO_AT * ski.length;
  const width = 2 * halfWidth(ski, s);
  const margin = width * MARGIN;
  const scale = (width - 2 * margin) / SLANT.width;
  const tall = (SLANT.above + SLANT.below) * scale;
  // How the left edge leans here: its drift inward per mm down the ski.
  const lean = (halfWidth(ski, s - 5) - halfWidth(ski, s + 5)) / 10;
  return {
    box: {
      h: tall,
      w: width - 2 * margin,
      x: -width / 2 + margin,
      y: s - tall / 2,
    },
    matrix: multiply(
      move(-width / 2 + margin, s),
      turn(Math.atan(-lean)),
      grow(scale),
      move(0, (SLANT.above - SLANT.below) / 2),
      turn(SLANT.angle),
      move(-SLANT.top[0], -SLANT.top[1]),
    ),
    path: LOGO,
  };
}

function ravenMark(ski: Ski): Mark {
  const scale = RAVEN_SPOT.height / RAVEN_SIZE.h;
  const box = {
    h: RAVEN_SPOT.height,
    w: RAVEN_SIZE.w * scale,
    x: (-RAVEN_SIZE.w * scale) / 2,
    y: ski.length - RAVEN_SPOT.fromTail - RAVEN_SPOT.height / 2,
  };
  return {
    box,
    matrix: multiply(move(box.x, box.y), grow(scale)),
    path: RAVEN,
  };
}

// Millimetres per unit of a mark's own path, for line widths drawn in it.
export const markScale = ({ matrix: [a, b] }: Mark) => Math.hypot(a, b);

// Each ski's mark, left then right.
export const marks = (ski: Ski) => [logoMark(ski), ravenMark(ski)];

export function windowSpan(ski: Ski) {
  const from = ski.length - WINDOW.fromTail;
  return { border: WINDOW.border, from, to: from + WINDOW.width };
}
