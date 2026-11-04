// Painting a design's parts as planned: the background, and each decal on
// its own backdrop. Each is looked over once it's painted, and painted again
// if it came out wrong: art with skis in it, a decal with no clean backdrop
// to cut it from, or words misspelled.

import { spotAspect } from "../client/decals";
import { DEFAULT_SKI, SKIS } from "../client/ski";
import type { Env } from "./env";
import { fromBase64, newId, toBase64 } from "./http";
import { ask, CHECK_MODELS, paint, type Painted } from "./openrouter";
import type { Decal, Planned, Step } from "./plan";
import {
  artCheck,
  CHECK_SCHEMA,
  decalCheck,
  editArt,
  editDecal,
  matchDecal,
  paintArt,
  paintDecal,
} from "./prompt";

// New art is painted at 1:4, wider than the pair, so there's room to slide
// it over the art in the studio. Designs from before that, and the
// examples, are 1:8; their changes keep it, so the art keeps its layout.
export const ASPECT = "1:4";

export function aspectRatio(width: number, height: number) {
  return width / height < 0.18 ? "1:8" : ASPECT;
}

// The shapes the image model paints, as width:height.
const RATIOS = [
  "1:8",
  "1:4",
  "9:16",
  "2:3",
  "3:4",
  "4:5",
  "1:1",
  "5:4",
  "4:3",
  "3:2",
  "16:9",
  "21:9",
  "4:1",
  "8:1",
];

// The shape it paints that's closest to width over height.
function nearestRatio(aspect: number) {
  const off = (ratio: string) => {
    const [w, h] = ratio.split(":").map(Number);
    return Math.abs(Math.log(w / h / aspect));
  };
  return RATIOS.reduce((best, ratio) =>
    off(ratio) < off(best) ? ratio : best,
  );
}

// A check that takes longer than this passes, rather than hold up the
// design.
const CHECK_TIME = 12_000;

// Whether a check finds the image as it should be. A check that can't be
// made passes.
async function looksRight(env: Env, image: string, question: string) {
  const answer = await ask<{ ok?: boolean }>(
    env,
    "You check images for a design studio. Reply with only the JSON asked for.",
    [
      { text: question, type: "text" },
      { image_url: { url: image }, type: "image_url" },
    ],
    { models: CHECK_MODELS, schema: CHECK_SCHEMA, timeout: CHECK_TIME },
  );
  return answer?.ok !== false;
}

// Painted until the check passes, in rounds of one or more goes at once,
// the first that passes standing. After the last round, or once the design
// has taken until its deadline, the first painted stands either way: a
// design that's a little off beats none, and beats a long wait.
async function paintChecked(
  env: Env,
  go: () => Promise<Painted | null>,
  question: string,
  deadline: number,
  { rounds = 2, width = 1 } = {},
) {
  let fallback: Painted | null = null;
  for (let round = 0; round < rounds; round++) {
    if (round && fallback && Date.now() > deadline) break;
    const goes = Array.from({ length: width }, () =>
      go().then(async (painted) => {
        if (!painted) return null;
        fallback ??= painted;
        return (await looksRight(env, painted.image, question))
          ? painted
          : null;
      }),
    );
    const passed = await firstOf(goes);
    if (passed) return passed;
    console.error("painted wrong, painting again:", question.slice(0, 100));
  }
  return fallback;
}

// The first of them to come back with something, or null once none has.
function firstOf<T>(promises: Promise<T | null>[]) {
  return new Promise<T | null>((resolve) => {
    let left = promises.length;
    for (const promise of promises) {
      promise.then(
        (value) => {
          if (value) resolve(value);
          else if (!--left) resolve(null);
        },
        () => {
          if (!--left) resolve(null);
        },
      );
    }
  });
}

interface Parent {
  image: string;
  aspect: string;
}

export function background(
  env: Env,
  { action, description, prompt }: Step["background"],
  parent: Parent | null,
  aspect: string,
  deadline: number,
) {
  if (action === "keep" && parent) {
    const [, type, base64] = parent.image.match(/^data:([^;]+);base64,(.+)$/)!;
    return Promise.resolve({ base64, image: parent.image, type } as Painted);
  }
  return paintChecked(
    env,
    () =>
      action === "edit" && parent
        ? paint(env, editArt(prompt), parent.aspect, { from: parent.image })
        : paint(env, paintArt(prompt), aspect),
    artCheck(description),
    deadline,
  );
}

async function decalImage(env: Env, id: string) {
  const object = await env.ART.get(`decals/${id}`);
  if (!object) return undefined;
  const type = object.httpMetadata?.contentType ?? "image/png";
  return `data:${type};base64,${toBase64(await object.arrayBuffer())}`;
}

// One decal, painted to the shape of its spot on the usual length: changed
// from its picture as it was, lettered like another, or new.
async function paintOne(
  env: Env,
  planned: Planned,
  deadline: number,
  lettering?: string,
) {
  const { action, backdrop, from, prompt, words } = planned;
  const shape = spotAspect(SKIS[DEFAULT_SKI], planned.at, planned.along);
  const aspect = nearestRatio(shape);
  const before =
    action === "edit" && from ? await decalImage(env, from) : undefined;
  return paintChecked(
    env,
    () =>
      before
        ? paint(env, editDecal(prompt, backdrop, shape), aspect, {
            from: before,
            size: "1K",
          })
        : lettering
          ? paint(env, matchDecal(prompt, words, backdrop, shape), aspect, {
              from: lettering,
              size: "1K",
            })
          : paint(env, paintDecal(prompt, backdrop, shape), aspect, {
              size: "1K",
            }),
    decalCheck(backdrop, words),
    deadline,
    // Words come out misspelled often enough to try two at once.
    { width: words ? 2 : 1 },
  );
}

// The decals as planned, each saved under its own id. Kept decals stay
// where they are, shared by every version that has them. New words are
// lettered like the design's other words: ones kept from before, or else
// the first painted now, which the rest wait for.
export async function paintDecals(
  env: Env,
  planned: Planned[],
  deadline: number,
) {
  const kept = planned.find(
    (each) => each.words && each.action === "keep" && each.from,
  );
  const leader = kept
    ? undefined
    : planned.find((each) => each.words && each.action === "paint");
  const led = leader && paintOne(env, leader, deadline);
  const lettering = kept
    ? decalImage(env, kept.from!)
    : led?.then((painted) => painted?.image);

  return Promise.all(
    planned.map(async (each): Promise<Decal | null> => {
      const { action, from, prompt, ...decal } = each;
      if (action === "keep" && from) return { ...decal, id: from };
      const painted =
        each === leader
          ? await led!
          : await paintOne(
              env,
              each,
              deadline,
              decal.words && action === "paint" ? await lettering : undefined,
            );
      if (!painted) return null;
      const id = newId();
      await env.ART.put(`decals/${id}`, fromBase64(painted.base64), {
        httpMetadata: { contentType: painted.type },
      });
      return { ...decal, id };
    }),
  );
}
