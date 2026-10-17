// What the image model is asked for.

import { footprint } from "../client/binding";
import { GAP, SKIS, waistAt, type Ski, type SkiId } from "../client/ski";

// Nano Banana 2.1 first, falling back to Nano Banana 2 when it is rate
// limited. They're the only models on OpenRouter that paint the 1:8 a pair
// of skis needs. 2.1 runs on our own Google AI Studio key, with billing, in
// the OpenRouter workspace; without it, OpenRouter's shared pool turns most
// requests away.
export const IMAGE_MODELS = [
  "google/gemini-nano-banana-2.1",
  "google/gemini-3.1-flash-image",
];

// The canvas the model paints, 704 x 5856 at 1:8 and 2K.
const CANVAS_ASPECT = 704 / 5856;

// Where everything lands on a canvas of the given aspect (width / height),
// as percentages, for the image model's instructions.
export function layout(ski: Ski, aspect: number) {
  const pair = 2 * ski.span + GAP;
  const height = pair / aspect;
  const y = (s: number) => (100 * ((height - ski.length) / 2 + s)) / height;
  const x = (mm: number) => (100 * mm) / pair;
  return {
    binding: footprint(ski).map(y),
    gap: [x(ski.span), x(ski.span + GAP)],
    left: { center: x(ski.span / 2), from: 0, to: x(ski.span) },
    right: {
      center: x(ski.span * 1.5 + GAP),
      from: x(ski.span + GAP),
      to: 100,
    },
    tails: y(ski.length),
    tips: y(0),
    waist: y(waistAt(ski) * ski.length),
  };
}

// Exact positions on the canvas, measured from the top-left corner. The
// main subject goes clear of the binding, which covers about the middle
// quarter of each ski, with a little room either side of it and before the
// tail. This says where to put it rather than naming the covered band: told
// about the band, the model sometimes painted it as a box or a stripe.
export function positions(id: SkiId) {
  const p = layout(SKIS[id], CANVAS_ASPECT);
  const n = (value: number) => `${Math.round(value)}%`;
  return `Exact positions, as percentages of the canvas width (x, from the left) and height (y, from the top):
- Left piece: x ${n(p.left.from)} to ${n(p.left.to)}, center line at x ${n(p.left.center)}.
- Gap between the pieces: x ${n(p.gap[0])} to ${n(p.gap[1])}.
- Right piece: x ${n(p.right.from)} to ${n(p.right.to)}, center line at x ${n(p.right.center)}.
- Top ends at y ${n(p.tips)}, narrowest point at y ${n(p.waist)}, bottom ends at y ${n(p.tails)}. Everything above y ${n(p.tips)} and below y ${n(p.tails)} is trimmed away.
Anything described as running down the middle of a piece goes on that piece's center line; anything on one piece stays inside that piece's x range.
- Put the main subject, any faces and any requested text between y ${n(p.tips)} and y ${n(p.binding[0] - 2)}, toward the top, or between y ${n(p.binding[1] + 2)} and y ${n(p.tails - 2.5)}, toward the bottom, unless the description says where they go.`;
}

// Explains the layout guide the studio sends with every request.
export const LAYOUT_RULES = `The layout guide image is a map of your canvas at exactly the proportions you are painting, and every position in it maps one to one onto your artwork.
In the guide: the two white areas are where the left and right pieces will be cut out, with their rounded ends at the top and the bottom. The grey around them gets trimmed away.
Use the guide to place things: when the description mentions the top, the bottom, the middle, the edges, the left side or the right side, put it exactly there. Keep focal points and any requested text inside the white areas. Treat the two pieces as one continuous mural unless the description asks for them to differ.
Paint across the whole canvas, including the grey areas and the narrow gap between the two pieces, so no background shows at the cut edges.
Never reproduce the guide itself: no grey or white areas from it, and no outlines, silhouettes, ghosted shapes or changes in tone where the edges of the white areas are. The artwork must flow straight across those edges as if they were not there.`;

// Nothing here is called a ski: told it was painting for skis, the model
// painted pictures of skis 5 times in 20, against 1 in 20 this way.
export const ARTWORK_RULES = `This is a print-ready graphic for a flat rectangular sheet of material. Two long pieces will be cut out of it later.
The artwork must cover 100% of the canvas. Every pixel is painted, continuing past all four edges as if cropped from a larger piece. No white or empty background, no margins, no frame, no border, no vignette, no outline or silhouette shapes, no objects standing on a background, no mockups, no products.
Compose it as one continuous tall vertical mural. Keep the most important details away from the left and right edges.
Do not add any text, letters, numbers, logos or signatures unless the description explicitly asks for specific words.`;
