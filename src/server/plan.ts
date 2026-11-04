// A design's plan: the background, in canvas terms, and its decals. It's
// kept with the design so a change can be planned from it.

import { MIN_SIZE, SIDES, SPOTS, type Layer } from "../client/decals";
import type { Env } from "./env";
import { ask, PLAN_MODELS } from "./openrouter";
import { ACTIONS, PLAN_RULES, PLAN_SCHEMA, type Backdrop } from "./prompt";

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

// What the planner says to do.
export interface Step {
  background: { action: Action; prompt: string; description: string };
  decals: Planned[];
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

function describe(current: Plan) {
  return JSON.stringify(
    {
      background: current.art,
      background_edits: current.edited ?? 0,
      decals: current.decals,
    },
    null,
    2,
  );
}

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
        size: Math.min(1, Math.max(MIN_SIZE, Number(decal.size) || 0.85)),
        ski: SIDES.includes(decal.ski) ? decal.ski : "both",
        words: typeof decal.words === "string" ? decal.words.trim() : "",
      };
    })
    .filter((decal) => decal.action === "keep" || decal.prompt.trim())
    // Five spots a ski, one decal a spot.
    .slice(0, 10);
  return { background, decals };
}

export async function planDesign(
  env: Env,
  prompt: string,
  current?: Plan,
): Promise<Step | null> {
  const request = current
    ? `THE DESIGN AS IT STANDS\n${describe(current)}\n\nTHE CHANGE\n${prompt}`
    : `THE CUSTOMER'S DESIGN\n${prompt}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const step = tidy(
      await ask<Step>(env, PLAN_RULES, request, {
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
