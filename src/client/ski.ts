// The models and their shape. Everything here is in millimetres, measured
// from the tip (s = 0) to the tail (s = length).

import outline175 from "./shapes/175.json";
import outline185 from "./shapes/185.json";
import outline193 from "./shapes/193.json";

export type SkiId = "193" | "185" | "175";

// A design has no length of its own: it's the same art at every length.
export const DEFAULT_SKI: SkiId = "185";

export function skiId(value: unknown): SkiId {
  return value === "175" || value === "193" ? value : DEFAULT_SKI;
}

// A ski's outline, traced from the shop's CNC files for its base: half-widths
// from tip to tail, each at a share of the length (see scripts/outline.py).
type Shape = { widths: number[][] };

export interface Ski {
  id: SkiId;
  length: number;
  radius: number;
  shape: Shape;
  // Widths measured from the outline, to the mm, as quoted on the site.
  tip: number;
  waist: number;
  tail: number;
  // The widest the outline gets, unrounded, which sets each ski's strip
  // wherever the pair is laid out.
  span: number;
}

function model(id: SkiId, length: number, radius: number, shape: Shape): Ski {
  const width = (from: number, to: number, narrowest = false) => {
    const halves = shape.widths
      .filter(([u]) => u >= from && u <= to)
      .map(([, half]) => half);
    return 2 * (narrowest ? Math.min(...halves) : Math.max(...halves));
  };
  return {
    id,
    length,
    radius,
    shape,
    span: width(0, 1),
    tail: Math.round(width(0.7, 1)),
    tip: Math.round(width(0, 0.4)),
    waist: Math.round(width(0.3, 0.8, true)),
  };
}

export const SKIS: Record<SkiId, Ski> = {
  "193": model("193", 1930, 19, outline193),
  "185": model("185", 1850, 19, outline185),
  "175": model("175", 1750, 17, outline175),
};

// The 541 signature: a slim window cut through the topsheet near the tail,
// showing the core strips underneath. The same on every model: where it sits,
// in mm from the tail, and the strips across it from edge to edge, as shares
// of the ski's width.
export const WINDOW = {
  fromTail: 367,
  strips: [
    [0.06, "#7b6a61"],
    [0.28, "#dfbd8c"],
    [0.32, "#8e7a6f"],
    [0.28, "#dfbd8c"],
    [0.06, "#7b6a61"],
  ],
  width: 20,
} as const;

// What a pair costs, plain or with a custom topsheet.
export const PRICE = "$1,500";

// Space between the pair, both laid flat and in 3D, so artwork that runs
// across both skis lines up the same way everywhere.
export const GAP = 18;

// The biggest pair's length and width side by side, in mm. Previews frame
// it, so every length is drawn at one scale and shows its real size.
export const LARGEST = {
  length: Math.max(...Object.values(SKIS).map((ski) => ski.length)),
  width: Math.max(...Object.values(SKIS).map((ski) => 2 * ski.span + GAP)),
};

// Half the ski's width s mm from the tip. The outline keeps its ends, so a
// flat tail stays flat.
export function halfWidth(ski: Ski, s: number) {
  const { widths } = ski.shape;
  const u = s / ski.length;
  if (u < 0 || u > 1) return 0;
  const hi = widths.findIndex(([v]) => v >= u);
  if (hi <= 0) return widths[0][1];
  const [[u0, w0], [u1, w1]] = [widths[hi - 1], widths[hi]];
  return w0 + ((w1 - w0) * (u - u0)) / (u1 - u0);
}

// Height of the base above flat snow: early-rise tip, a little tail rise
// and a few millimetres of camber underfoot.
export function baseHeight(ski: Ski, s: number) {
  const L = ski.length;
  const tip = 0.15 * L;
  const tail = 0.07 * L;

  if (s < tip) return 46 * ((tip - s) / tip) ** 2.3;
  if (s > L - tail) return 22 * ((s - (L - tail)) / tail) ** 2.3;
  return 3 * Math.sin((Math.PI * (s - tip)) / (L - tip - tail));
}

export function thickness(ski: Ski, s: number) {
  const u = Math.min(1, Math.max(0, (s / ski.length - 0.02) / 0.96));
  return 3.5 + 11 * Math.sin(Math.PI * u) ** 0.6;
}

// Samples along the length, packed tighter at the ends where the outline
// turns quickly.
export function stations(ski: Ski, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    return (
      ski.length * (t - (0.85 * Math.sin(2 * Math.PI * t)) / (2 * Math.PI))
    );
  });
}

export function outline(ski: Ski, count = 240) {
  const s = stations(ski, count);
  const right = s.map((y) => [halfWidth(ski, y), y] as const);
  const left = s.map((y) => [-halfWidth(ski, y), y] as const).reverse();
  return [...right, ...left];
}
