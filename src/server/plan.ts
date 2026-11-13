// A design's plan: the background, in canvas terms, and its decals. It's
// kept with the design so a change can be planned from it.

import { MIN_SIZE, SIDES, SPOTS, type Layer } from "../client/decals";
import type { Env } from "./env";
import { ask, PLAN_MODELS } from "./openrouter";
import {
  ACTIONS,
  IMAGE_ACTIONS,
  PLAN_RULES,
  PLAN_SCHEMA,
  type Backdrop,
} from "./prompt";

export interface Decal extends Layer {
  // The picture as it stands, for planning changes to it.
  description: string;
  backdrop: Backdrop;
  // The words it shows, if any, to check its spelling.
  words: string;
}

export interface Plan {
  // The background as it stands.
  art: string;
  // How many times it's been edited since it was painted. Each edit
  // repaints the last, and wears it a little.
  edited?: number;
  decals: Decal[];
}

type Action = (typeof ACTIONS)[number];

// A decal as the planner asks for it: the one it's from kept, changed or
// painted over, or a new one.
export type Planned = Omit<Decal, "id"> & {
  from: string | null;
  action: Action;
  prompt: string;
};

// What becomes of one of the customer's own images (uploads.ts).
export interface PlannedImage extends Omit<Layer, "id"> {
  id: string;
  action: (typeof IMAGE_ACTIONS)[number];
  scale: number;
}

// What the planner says to do.
export interface Step {
  background: { action: Action; prompt: string; description: string };
  decals: Planned[];
  images: PlannedImage[];
}

// What the planner is told of the customer's images, and of decals they've
// moved by hand, by id, as uploads.ts describes them.
export interface ByHand {
  images: object[];
  moved: Record<string, object>;
}

// A plan for designs from before there were plans, or examples: the art
// is all background.
export function planFrom(prompt: string, edits: string[] = []): Plan {
  return {
    art: [prompt, ...edits.map((edit) => `Then changed: ${edit}`)].join("\n"),
    decals: [],
    edited: edits.length,
  };
}

// The plan with only the decals still on the design, as the studio lists
// them, or null when none have been taken off by hand. None are added.
export function keptDecals(plan: Plan, kept: unknown): Plan | null {
  if (!Array.isArray(kept)) return null;
  const ids = new Set(kept);
  const decals = plan.decals.filter((decal) => ids.has(decal.id));
  return decals.length < plan.decals.length ? { ...plan, decals } : null;
}

// Without a plan, the prompt goes to the image model as it was typed, as it
// did before there were plans, and any decals stay as they are.
export function unplanned(prompt: string, current?: Plan): Step {
  return {
    background: {
      action: current ? "edit" : "paint",
      description: current ? `${current.art}\nThen changed: ${prompt}` : prompt,
      prompt,
    },
    decals: (current?.decals ?? []).map(({ id, ...decal }) => ({
      ...decal,
      action: "keep",
      from: id,
      prompt: "",
    })),
    images: [],
  };
}

// The plan a design is saved with once its step is painted.
export function planAfter(step: Step, decals: Decal[], current?: Plan): Plan {
  const { action, description } = step.background;
  const edited = current?.edited ?? 0;
  return {
    art: description,
    decals,
    edited: action === "paint" ? 0 : action === "edit" ? edited + 1 : edited,
  };
}

// Words that get the image model painting skis. "Skier" and "ski lift" are
// fine; the skis themselves aren't.
const SKI_WORDS =
  /\b(skis|snowboards?|topsheets?|bindings?|(?:the|each|both|a|one|left|right|your|my) ski)\b/i;

// What the image model would be told, if the step were painted.
function toldOf({ background, decals }: Step) {
  const told = decals
    .filter((decal) => decal.action !== "keep")
    .map((decal) => decal.prompt);
  if (background.action !== "keep") {
    told.push(background.prompt, background.description);
  }
  return told;
}

function describe(current: Plan, byHand: ByHand) {
  return JSON.stringify(
    {
      background: current.art,
      background_edits: current.edited ?? 0,
      decals: current.decals.map((decal) =>
        byHand.moved[decal.id]
          ? { ...decal, placed_by_hand: byHand.moved[decal.id] }
          : decal,
      ),
      images: byHand.images,
    },
    null,
    2,
  );
}

// A placement in a spot as the planner gave it, made safe to draw.
const tidyPlacement = ({ size, ski }: Pick<Layer, "size" | "ski">) => ({
  size: Math.min(1, Math.max(MIN_SIZE, Number(size) || 0.85)),
  ski: SIDES.includes(ski) ? ski : ("both" as const),
});

// The planner's answer, made safe to act on, or null if it can't be.
function tidy(step: Step | null, current?: Plan): Step | null {
  if (!step?.background || !Array.isArray(step.decals)) return null;
  const { background } = step;
  if (!ACTIONS.includes(background.action)) return null;
  // A new design has nothing to keep or edit.
  if (!current) background.action = "paint";
  if (background.action !== "keep" && !background.prompt.trim()) return null;

  const ids = new Set(current?.decals.map((decal) => decal.id));
  const decals = step.decals
    .filter((decal) => decal && SPOTS.includes(decal.at))
    .map((decal): Planned => {
      const from = decal.from && ids.has(decal.from) ? decal.from : null;
      return {
        ...decal,
        action: from ? decal.action : "paint",
        backdrop: decal.backdrop === "green" ? "green" : "magenta",
        from,
        ...tidyPlacement(decal),
        words: typeof decal.words === "string" ? decal.words.trim() : "",
      };
    })
    .filter((decal) => decal.action === "keep" || decal.prompt.trim())
    // Five spots a ski, one decal a spot.
    .slice(0, 10);
  const images = (Array.isArray(step.images) ? step.images : [])
    .filter(
      (image) =>
        image &&
        typeof image.id === "string" &&
        IMAGE_ACTIONS.includes(image.action) &&
        SPOTS.includes(image.at),
    )
    .map((image) => ({
      ...image,
      along: !!image.along,
      mirror: !!image.mirror,
      scale: Number(image.scale) || 1,
      ...tidyPlacement(image),
    }));
  return { background, decals, images };
}

export async function planDesign(
  env: Env,
  prompt: string,
  current: Plan | undefined,
  byHand: ByHand,
  // A picture the customer wants the design to look like, as a data URL,
  // for a new design or a change.
  reference?: string,
): Promise<Step | null> {
  const images = byHand.images.length
    ? `\n\nTHE CUSTOMER'S IMAGES, already on the skis\n${JSON.stringify({ images: byHand.images }, null, 2)}`
    : "";
  const request = current
    ? `THE DESIGN AS IT STANDS\n${describe(current, byHand)}\n\nTHE CHANGE\n${prompt}`
    : `THE CUSTOMER'S DESIGN\n${prompt}${images}`;
  const content = reference
    ? [
        {
          text: `${request}\n\nTHE CUSTOMER'S REFERENCE PICTURE is attached.`,
          type: "text" as const,
        },
        { image_url: { url: reference }, type: "image_url" as const },
      ]
    : request;
  for (let attempt = 0; attempt < 2; attempt++) {
    const step = tidy(
      await ask<Step>(env, PLAN_RULES, content, {
        models: PLAN_MODELS,
        schema: PLAN_SCHEMA,
        timeout: 30_000,
      }),
      current,
    );
    if (!step) continue;
    if (!toldOf(step).some((text) => SKI_WORDS.test(text))) return step;
    console.error("plan mentions skis", JSON.stringify(step));
  }
  return null;
}

// What the studio needs to place a plan's decals.
export const layersOf = (plan: Plan | null): Layer[] =>
  (plan?.decals ?? []).map(({ along, at, id, mirror, size, ski }) => ({
    along,
    at,
    id,
    mirror,
    size,
    ski,
  }));

export const layersJson = (json: string | null) =>
  layersOf(json ? JSON.parse(json) : null);
