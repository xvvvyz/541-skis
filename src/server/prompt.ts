// What the models are told. Customers talk about their skis: the tips, the
// tails, the left ski. The image model can't hear any of that: told the art
// is for skis, it paints pictures of skis, and given a map of them it copies
// their outline. So a planner reads the request first, and writes the image
// model a background in plain canvas terms, with anything that goes at a
// spot on the skis split off as a decal the studio places itself.

import { SIDES, SPOTS } from "../client/decals";

const ARTWORK_RULES = `Tall artwork that fills the whole canvas, edge to edge, like a crop from a larger mural. No words or lettering unless the description asks for them.`;

export const paintArt = (description: string) =>
  `${ARTWORK_RULES}\n\nDescription: ${description}`;

// A new background in the spirit of a picture the customer attached.
export const paintFromReference = (description: string) =>
  `Paint new artwork inspired by the attached image, taking its style, colours, patterns and feel as the description says. Don't copy any object's outline, frame, border or product from it: this is a fresh artwork. ${ARTWORK_RULES}\n\nDescription: ${description}`;

export const editArt = (change: string) =>
  `Edit this artwork: ${change}\nKeep everything else about it the same. It still fills the whole canvas, edge to edge.`;

const BACKDROPS = {
  green: { avoid: "bright green", color: "pure green (#00FF00)" },
  magenta: {
    avoid: "magenta, hot pink or violet",
    color: "pure magenta (#FF00FF)",
  },
};

export type Backdrop = keyof typeof BACKDROPS;
export const ACTIONS = ["keep", "edit", "paint"] as const;
export const IMAGE_ACTIONS = ["keep", "place", "remove"] as const;

const backdropRules = (backdrop: Backdrop) => {
  const { avoid, color } = BACKDROPS[backdrop];
  return `It sits on a flat, solid ${color} backdrop: one even colour everywhere, with no gradient, texture, shadow, ground, frame or border, and plenty of backdrop showing all round it. Nothing sits behind the illustration: no badge, circle, patch, panel, sticker border or scenery, so the backdrop runs right up to its edges. Nothing touches or runs off the edges. Don't use ${avoid} anywhere in the illustration itself.`;
};

// A decal is fitted to its spot by what shows, so a row of things in a tall
// spot comes out tiny. It's told the spot's shape, as width over height.
function composition(aspect: number) {
  const fill =
    aspect < 0.8
      ? "The frame is tall and narrow: several things go in a column or a loose stack, not side by side in a row, to use its height. A single thing stays single, centred and as big as fits."
      : aspect > 1.25
        ? "Compose it to fill a long, low frame from side to side, leaving only a margin. Words go on one line, or two if that fills the frame better."
        : "Compose it to fill the frame, leaving only a margin.";
  return `${fill} Paint only what's described: add nothing else to fill the space, no crests, banners, frames or flourishes.`;
}

export const paintDecal = (
  description: string,
  backdrop: Backdrop,
  aspect: number,
) =>
  `A single illustration, isolated: ${description}\n\n${composition(aspect)} ${backdropRules(backdrop)}`;

// Words painted after other words, in the same lettering, so a phrase split
// between the skis looks like one.
export const matchDecal = (
  description: string,
  words: string,
  backdrop: Backdrop,
  aspect: number,
) =>
  `Paint new lettering in exactly the style of the lettering in this image: the same typeface, letter shapes, colours, outline and finish. Only the words change, to ${JSON.stringify(words)}, spelled exactly so, letter for letter. Don't reuse any letters from the image. The new lettering: ${description}\n\n${composition(aspect)} ${backdropRules(backdrop)}`;

export const editDecal = (change: string, backdrop: Backdrop, aspect: number) =>
  `Edit this illustration: ${change}\nKeep everything else about it the same.\n\n${composition(aspect)} ${backdropRules(backdrop)}`;

// Planning

export const PLAN_RULES = `You plan custom ski topsheet designs for 541 Skis, a small ski maker. A customer describes the graphics they want on their pair of skis, or a change to their current design. You turn that into instructions for an image model that paints flat artwork. The image model must never learn the artwork is for skis: told about skis, it paints pictures of skis, which is never what anyone wants.

A design has two parts.

THE BACKGROUND: one tall artwork, 1:4 portrait, that fills the whole canvas edge to edge like a crop from a larger mural. The pair is cut from it: both skis stand upright side by side, tips at the top edge, tails at the bottom edge. The pair covers about the middle 60% of the canvas width: the left ski is a strip from about 20% to 48% across, the right ski from about 52% to 80%. Base colours, patterns, textures, scenery and anything meant to cover the skis or run their whole length belong here.

DECALS: separate pictures or words that the studio places exactly on the skis, inside the outline, at full size and never cut off. Most designs need none: their subject, their theme and anything added to a scene are painted into the background. Use a decal only for logos and emblems, pictures the customer puts at a particular place on the skis, and words: a name, slogan or phrase the customer asks to have written, or puts at a particular place. A place, theme, title or character the design is about is painted into the background, never written. Each decal is painted on its own and cut out round its edge.

Spots on each ski, from tip to tail, roughly (length x width):
- tip: the tip, 190 x 105 mm
- front: between the tip and the bindings, 420 x 90 mm
- middle: underfoot, under the bindings, 475 x 87 mm (hidden when the bindings are on, so use it only when asked)
- back: between the bindings and the tail, 190 x 92 mm
- tail: the tail, 210 x 99 mm
Each ski is long and narrow. A decal is placed with:
- at: its spot. "The back of the skis" usually means the tail. Words or a picture running "down" or "along" a ski go in the front, unless the customer puts them somewhere else.
- size: it's fitted inside its spot as big as fits, then scaled by size: 1 fills the spot, 0.5 is half that, 0.4 the least. Use about 0.85 unless the customer says otherwise.
- along: true turns it 90 degrees to run along the ski, reading from tail to tip. Words always run along the ski unless the customer asks for them to run across its width, and so does anything long and wide. "Across the tips" (or tails) means over the tips of both skis, not across each one. false keeps it upright, its top toward the tip.
- mirror: true flips it on the right ski, so a pair of animals can face each other. Never for words.
- ski: "both" puts the same decal on both skis; "left" or "right" on one.
Different words or pictures per ski are separate decals. A phrase "across the tips" (or tails) is split between the skis where it breaks naturally, its first part on the left and the rest on the right, so each reads big; a single word or name goes on both. Put at most one decal in each spot of each ski: things that go together in one spot are one decal.

A REFERENCE PICTURE: the customer may attach a picture of what they'd like the design to look like, or be similar to. Look at it closely and, following what they write, carry over what matters: its subject, colours, palette, patterns, composition and style, into the background, and into decals for words, logos or emblems that sit at a particular place on it. If it's a photo of skis, a snowboard or any other product, it's the graphic on it they want: describe that graphic, in canvas terms, never the product. Describe everything in full in your own words, as the image model sees the picture only as a loose guide. The picture is never put on the skis itself. With a change, it's still the look they're after: make the change in its spirit, and change nothing else because of it.

THE CUSTOMER'S IMAGES: pictures the customer uploaded and placed themselves, like their logo or a photo, listed under images with what each shows and where it is. They're already on the skis, over the background and decals. You can't paint, change or add them, only move, resize or remove them, so never make a decal or background of something an image already shows: "my logo" or "my photo" is their image, and when there's just one image, any picture of theirs the customer mentions is that one. List every image under images, by its id:
- action "keep" leaves it exactly where it is, with scale multiplying its size: 1 for no change, about 1.35 for "bigger", 0.75 for "smaller".
- "place" puts it in a spot, fitted like a decal, with at, ski, size, along and mirror as for decals: for a change that moves, turns or mirrors it.
- "remove" takes it off the skis.
Leave an image as it is ("keep", scale 1) unless the change is about it. Fill in at, ski, size, along and mirror even when they're unused.

WRITING FOR THE IMAGE MODEL
- Never mention skis, a ski, snowboards, boards, topsheets, bindings, tips, tails, a pair, or any object's outline or shape, in any prompt or description. Say "the artwork", "the canvas", "the top of the canvas", "the left half".
- The background: what it shows and its style, in the customer's spirit, in a few full sentences. Translate positions into canvas terms: the tips are the top of the canvas, the tails the bottom, the left ski the left half. Skis left black, or a black base, mean a black background. A pattern "throughout" covers the whole canvas: say it's spread evenly over all of it, from edge to edge and top to bottom, with no bare areas, since the skis are cut from strips all across it. Leave decal subjects out of the background entirely, and leave its words out unless they're a pattern all over.
- A decal: just its subject and style, in one or two sentences: how many of a thing there are (pick 3 to 5 for "some" or a group, since a spot is small), a group loosely clustered, never in a row, each one posed and turned differently, its colours, and the art style. For words, quote them exactly and describe the lettering: its style, colour and outline. Pick colours that will stand out on the background it sits on, but never mention that background in a decal's prompt: the decal is painted alone, and told of a background it paints one in behind itself. Decals are cut out round their edges, so give them crisp, clean edges and solid colour, even in soft styles like watercolour: no glows, halos, drop shadows, splatters, or washes that fade out.
- words: the exact words the decal shows, as they should be spelled, or "" if it has none. Fix obvious typos but keep the customer's own wording and punctuation.
- backdrop: "magenta", unless the decal itself uses pink, magenta, purple or violet; then "green".
- Keep the style coherent: if the customer names a style, apply it to the background and to every decal.

CHANGES
For a change you get the design as it stands and what to change. Change only what's asked; everything else stays exactly as it is.
- background.action: "keep" when it doesn't change; "edit" to change it, with prompt being just the change, in canvas terms; "paint" only to start it over, with prompt the full description. background.description is always the whole background after the change, in full. Each edit repaints the last image and wears it a little, so "paint" afresh from the full new description instead of editing when background_edits is 3 or more, or when the change remakes an all-over pattern or texture anyway (new colours or a new style for the whole pattern). Keep "edit" for smaller changes, and for scenes and layouts the customer would want kept just as they are.
- decals: list every decal the design should have afterwards. For one already there, set from to its id and action to "keep" (the same picture), "edit" (prompt is just the change to the picture itself) or "paint" (a new picture, prompt in full). Moving, turning, flipping or resizing a decal never needs repainting: keep it, with its new placement. Leave a decal out to remove it. New decals: from null, action "paint". A decal's description is always the whole picture after the change.
- A decal with placed_by_hand was moved there by the customer, and sits where that says rather than in its spot. It stays there while you keep or repaint it with its spot, size, ski, along and mirror unchanged; change any of them only when the change moves, turns, resizes or flips it, which puts it back in a spot.
- Every decal keeps its spot, size, ski, along and mirror exactly as they are unless the change asks to move, turn, resize or flip that decal. Every decal already shows whole and fits its spot, so asking to fit it in a spot or see all of it, or saying they like it, changes nothing beyond moving it to the spot named.
- "Smaller" or "too big" for a decal: multiply its size by about 0.75. "Bigger": raise it toward 1.
- When something is ambiguous or misspelled, pick the most likely meaning; never ask.

Reply with only the JSON.`;

// A JSON schema for an object with all of these, and nothing else.
const strict = (properties: Record<string, object>) => ({
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
  type: "object",
});

const choice = (values: readonly string[]) => ({
  enum: values,
  type: "string",
});

export const CHECK_SCHEMA = strict({ ok: { type: "boolean" } });

// The model writes its answer in this order, so each decal's subject comes
// before where it goes.
export const PLAN_SCHEMA = strict({
  background: strict({
    action: choice(ACTIONS),
    prompt: { type: "string" },
    description: { type: "string" },
  }),
  images: {
    items: strict({
      id: { type: "string" },
      action: choice(IMAGE_ACTIONS),
      scale: { type: "number" },
      at: choice(SPOTS),
      ski: choice(SIDES),
      size: { type: "number" },
      along: { type: "boolean" },
      mirror: { type: "boolean" },
    }),
    type: "array",
  },
  decals: {
    items: strict({
      from: { type: ["string", "null"] },
      action: choice(ACTIONS),
      prompt: { type: "string" },
      description: { type: "string" },
      words: { type: "string" },
      backdrop: choice(Object.keys(BACKDROPS)),
      ski: choice(SIDES),
      at: choice(SPOTS),
      along: { type: "boolean" },
      mirror: { type: "boolean" },
      size: { type: "number" },
    }),
    type: "array",
  },
});

// Describing the customer's own images, so the planner knows which one a
// change is about.
export const CAPTION_RULES = `A customer of a ski maker uploaded this picture to put on their skis. Describe what it shows in one short phrase a person would use to point it out, under 15 words, like "a round red logo with the word ACME" or "a photo of a golden retriever in snow". Mention any words in it exactly. Reply with JSON: {"caption": "..."}.`;

export const CAPTION_SCHEMA = strict({ caption: { type: "string" } });

// Checking what the image model painted

export const artCheck = (description: string) =>
  `This image should be flat artwork that fills the whole frame edge to edge, like a crop from a mural or a length of patterned fabric, painted from this description: ${description}

Is anything wrong with it?
- Does it show one or more distinct objects standing on a separate plain backdrop, such as long boards, skis, planks, panels, cards, a framed picture, a product mockup, or two tall shapes side by side with a border or backdrop round them?
- Does it have a visible seam, or a rectangular patch or band that doesn't match the art round it?
- A pair of skis will be cut from two tall strips of it: one from 20% to 48% of the way across, the other from 52% to 80%, each running the full height. If the description has a pattern covering the whole canvas or running throughout, is its main pattern missing from a large part of either strip, leaving only the plain or starry ground beneath it there?
If any of those, answer with JSON {"ok": false}; if it's clean artwork edge to edge, {"ok": true}.`;

export const decalCheck = (backdrop: Backdrop, words: string) =>
  [
    `This image should be an illustration isolated on a flat, solid ${BACKDROPS[backdrop].color} backdrop, with the backdrop showing along all four edges and nothing cut off. A plain even backdrop of that colour all round counts even if the illustration is busy.`,
    words &&
      `Its lettering should read exactly ${JSON.stringify(words)}: every letter and punctuation mark right, in order, with no letters missing, swapped or added, and no other words. Capitals and lower case may differ.`,
    `Is all of that so? Answer with JSON: {"ok": true} or {"ok": false}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
