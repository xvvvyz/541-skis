// A simple alpine binding to preview on the skis: toe piece, heel piece and
// brake, mounted on the boot center. For display only; never printed.

import type { Ski } from "./ski";

// Boot center, as a fraction of the length from the tip: a typical
// all-mountain line, a little behind true center.
const MOUNT_AT = 0.54;

// A medium boot sole, mm.
const SOLE = 305;

export function bootCenter(ski: Ski) {
  return ski.length * MOUNT_AT;
}

// The parts as boxes, in mm: along the ski from the boot center (toward the
// tail is positive), across from the center line, and up from the topsheet.
export interface Part {
  along: [number, number];
  across: number;
  up: [number, number];
  // Leaning back toward the tail, in radians, for the heel lever.
  tilt?: number;
  kind: "plate" | "housing" | "metal" | "brake";
}

export const PARTS: Part[] = [
  // Toe: base plate, housing, and the wings that hold the boot.
  {
    across: 64,
    along: [-SOLE / 2 - 58, -SOLE / 2 + 12],
    kind: "plate",
    up: [0, 7],
  },
  {
    across: 52,
    along: [-SOLE / 2 - 52, -SOLE / 2 - 4],
    kind: "housing",
    up: [7, 40],
  },
  {
    across: 70,
    along: [-SOLE / 2 - 10, -SOLE / 2 + 8],
    kind: "metal",
    up: [14, 34],
  },
  // A track between the pieces, then the heel and its lever.
  {
    across: 34,
    along: [-SOLE / 2 + 12, SOLE / 2 - 30],
    kind: "metal",
    up: [0, 4],
  },
  {
    across: 62,
    along: [SOLE / 2 - 30, SOLE / 2 + 78],
    kind: "plate",
    up: [0, 8],
  },
  {
    across: 58,
    along: [SOLE / 2 - 4, SOLE / 2 + 70],
    kind: "housing",
    up: [8, 58],
  },
  {
    across: 34,
    along: [SOLE / 2 + 40, SOLE / 2 + 112],
    kind: "housing",
    up: [44, 56],
    tilt: 0.35,
  },
  // Brake arms, folded up alongside the heel.
  {
    across: 96,
    along: [SOLE / 2 - 24, SOLE / 2 + 30],
    kind: "brake",
    up: [6, 14],
  },
];
