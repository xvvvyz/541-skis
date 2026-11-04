import { isFrame, type Frame } from "../client/frame";
import { PRESETS } from "../client/presets";
import { SKIS, skiId, type SkiId } from "../client/ski";
import type { Env } from "./env";
import {
  error,
  fromBase64,
  hash,
  isId,
  inkJson,
  MAX_PROMPT,
  newId,
  readJson,
  siteUrl,
  toBase64,
} from "./http";
import { ASPECT, aspectRatio, background, paintDecals } from "./paint";
import { jpegInfo } from "./pdf";
import {
  layersOf,
  planAfter,
  planDesign,
  planFrom,
  unplanned,
  type Decal,
  type Plan,
} from "./plan";

const PAINT_FAILED = "The paint didn't stick. Try again in a moment.";

export async function design(request: Request, env: Env, ip: string) {
  const { success } = await env.DESIGN_LIMIT.limit({ key: ip });
  if (!success) {
    return error(429, "That's a lot of designs. Give it a minute.");
  }

  const body = await readJson(request);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";

  if (!prompt) return error(400, "Describe your design first.");
  if (prompt.length > MAX_PROMPT) return error(400, "That prompt is too long.");

  // Edits start from a saved design or an example, never an uploaded image.
  const parent =
    typeof body?.parent === "string" && body.parent
      ? await loadParent(request, env, body.parent)
      : null;
  if (body?.parent && !parent) return error(404, "That design wasn't found.");
  const frame: Frame | null =
    parent && (isFrame(body?.frame) ? body.frame : parent.frame);

  const step =
    (await planDesign(env, prompt, parent?.plan)) ??
    unplanned(prompt, parent?.plan);

  // No part is painted again after this, so a slow model can't keep a
  // customer waiting much past a minute.
  const deadline = Date.now() + 50_000;
  const [art, decals] = await Promise.all([
    background(env, step.background, parent, ASPECT, deadline),
    paintDecals(env, step.decals, deadline),
  ]);
  if (!art || decals.some((each) => !each)) return error(502, PAINT_FAILED);
  const plan = planAfter(step, decals as Decal[], parent?.plan);

  const saved = {
    edits: parent ? [...parent.edits, prompt] : [],
    frame,
    id: newId(),
    layers: layersOf(plan),
    parent: parent?.id ?? null,
    prompt: parent ? parent.prompt : prompt,
  };
  const cardToken = newId();
  const ownerToken = newId();
  try {
    await env.ART.put(`designs/${saved.id}`, fromBase64(art.base64), {
      httpMetadata: { contentType: art.type },
    });
    await env.DB.prepare(
      "INSERT INTO designs (id, parent, prompt, edits, frame, plan, model, created, card_token, owner_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        saved.id,
        saved.parent,
        saved.prompt,
        JSON.stringify(saved.edits),
        frame && JSON.stringify(frame),
        JSON.stringify(plan),
        art.model ?? null,
        Date.now(),
        cardToken,
        await hash(ownerToken),
      )
      .run();
  } catch (cause) {
    console.error("saving design failed", cause);
    return error(502, PAINT_FAILED);
  }

  return Response.json({
    ...saved,
    cardToken,
    image: art.image,
    model: art.model,
    ownerToken,
  });
}

interface Saved {
  id: string;
  parent: string | null;
  prompt: string;
  edits: string[];
  frame: Frame | null;
  plan: Plan;
  created: number;
}

async function find(env: Env, id: string): Promise<Saved | null> {
  const row = await env.DB.prepare(
    "SELECT id, parent, prompt, edits, frame, plan, created FROM designs WHERE id = ?",
  )
    .bind(id)
    .first<
      Omit<Saved, "edits" | "frame" | "plan"> & {
        edits: string;
        frame: string | null;
        plan: string | null;
      }
    >();
  if (!row) return null;
  const edits: string[] = JSON.parse(row.edits);
  return {
    ...row,
    edits,
    frame: row.frame && JSON.parse(row.frame),
    plan: row.plan ? JSON.parse(row.plan) : planFrom(row.prompt, edits),
  };
}

// A parent's art for the model, and the aspect ratio it was painted at, so
// its change keeps the same canvas.
function parentArt(buffer: ArrayBuffer, type: string) {
  const bytes = new Uint8Array(buffer);
  const png = bytes[0] === 0x89 && bytes[1] === 0x50;
  const view = new DataView(buffer);
  const size = png
    ? { height: view.getUint32(20), width: view.getUint32(16) }
    : jpegInfo(bytes);
  return {
    aspect: size ? aspectRatio(size.width, size.height) : ASPECT,
    image: `data:${type};base64,${toBase64(buffer)}`,
  };
}

async function loadParent(request: Request, env: Env, id: string) {
  const preset = PRESETS.find((p) => p.id === id);
  if (preset) {
    const res = await env.ASSETS.fetch(new URL(preset.art, request.url));
    if (!res.ok) return null;
    return {
      edits: [] as string[],
      frame: preset.frame ?? null,
      id,
      plan: planFrom(preset.prompt),
      prompt: preset.prompt,
      ...parentArt(await res.arrayBuffer(), "image/jpeg"),
    };
  }
  if (!isId(id)) return null;
  const [saved, object] = await Promise.all([
    find(env, id),
    env.ART.get(`designs/${id}`),
  ]);
  if (!saved || !object) return null;
  const type = object.httpMetadata?.contentType ?? "image/png";
  return { ...saved, ...parentArt(await object.arrayBuffer(), type) };
}

export async function details(env: Env, id: string) {
  const saved = await find(env, id);
  if (!saved) return error(404, "That design wasn't found.");
  const { plan, ...shown } = saved;
  // The frame can change, so it's checked each time.
  return Response.json(
    { ...shown, layers: layersOf(plan) },
    { headers: { "cache-control": "no-cache" } },
  );
}

// The preview cards for a shared design, one for each length, uploaded once
// by the browser that made them, with the token it was given.
export async function saveCard(request: Request, env: Env, id: string) {
  const body = await readJson(request);
  const cards = readCards(body?.images);
  if (!cards || typeof body?.token !== "string") {
    return error(400, "That card doesn't look right.");
  }
  const claimed = await env.DB.prepare(
    "UPDATE designs SET card_token = NULL WHERE id = ? AND card_token = ?",
  )
    .bind(id, body.token)
    .run();
  if (!claimed.meta.changes) return error(403, "Forbidden");
  await putCards(env, id, cards);
  return Response.json({ ok: true });
}

function readCards(value: unknown) {
  const images = value as Record<string, unknown> | undefined;
  const lengths = Object.keys(SKIS) as SkiId[];
  const cards = lengths.flatMap((length) => {
    const image = images?.[length];
    const match =
      typeof image === "string" &&
      image.length < 2 * 1024 * 1024 &&
      image.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
    return match ? [{ length, match }] : [];
  });
  return cards.length === lengths.length ? cards : null;
}

function putCards(
  env: Env,
  id: string,
  cards: NonNullable<ReturnType<typeof readCards>>,
) {
  return Promise.all(
    cards.map(({ length, match }) =>
      env.ART.put(`cards/${id}/${length}`, fromBase64(match[2]), {
        httpMetadata: { contentType: `image/${match[1]}` },
      }),
    ),
  );
}

// For the browser that made the design: where the pair sits on the art,
// with the cards and the gallery's mark colours redrawn to match.
export async function saveFrame(request: Request, env: Env, id: string) {
  const body = await readJson(request);
  if (typeof body?.token !== "string") return error(403, "Forbidden");
  if (!isFrame(body.frame)) return error(400, "That frame doesn't look right.");
  // The gallery's colours change only once it's been added there.
  const updated = await env.DB.prepare(
    "UPDATE designs SET frame = ?, gallery_ink = CASE WHEN gallery_ink IS NOT NULL THEN coalesce(?, gallery_ink) END WHERE id = ? AND owner_hash = ?",
  )
    .bind(JSON.stringify(body.frame), inkJson(body), id, await hash(body.token))
    .run();
  if (!updated.meta.changes) return error(403, "Forbidden");
  const cards = readCards(body.cards);
  if (cards) await putCards(env, id, cards);
  return Response.json({ ok: true });
}

// A shared design's card for the length its link opens at. Designs shared
// before there was one for each length have one for all.
export async function card(request: Request, env: Env, id: string) {
  const length = skiId(new URL(request.url).searchParams.get("ski"));
  const object =
    (await env.ART.get(`cards/${id}/${length}`)) ??
    (await env.ART.get(`cards/${id}`));
  if (!object) {
    return Response.redirect(new URL("/og/design.jpg", request.url).href, 302);
  }
  // Redrawn when the pair is moved on the art.
  return image(object, "public, max-age=300");
}

export async function art(env: Env, key: string) {
  const object = await env.ART.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  return image(object);
}

function image(
  object: R2ObjectBody,
  cache = "public, max-age=31536000, immutable",
) {
  return new Response(object.body, {
    headers: {
      "cache-control": cache,
      "content-type": object.httpMetadata?.contentType ?? "image/png",
    },
  });
}

// The studio, with a title and link preview for the shared design. The
// prompt is left out of the preview; it's whatever someone typed.
export async function sharePage(request: Request, env: Env, id: string) {
  const saved = await find(env, id);
  const url = siteUrl(request);
  const page = await env.ASSETS.fetch(new URL("/design", request.url));
  if (!saved) return page;
  // The length the link opens at, marked before the studio's script runs.
  const length = skiId(url.searchParams.get("ski"));
  return withPreview(url, {
    alt: `A custom pair of 541 skis, ${SKIS[length].size}`,
    description:
      "A custom pair designed in the 541 Skis studio. See it in 3D, or design your own.",
    image: `/card/${id}?ski=${length}`,
    title: `Custom ${SKIS[length].name}`,
  })
    .on("[data-length]", {
      element(element) {
        const on =
          SKIS[skiId(element.getAttribute("data-length"))].length ===
          SKIS[length].length;
        element.setAttribute("aria-pressed", String(on));
      },
    })
    .on("[data-ski]", {
      element(element) {
        const on = element.getAttribute("data-ski") === length;
        element.setAttribute("aria-checked", String(on));
      },
    })
    .transform(page);
}

// The studio opened at an example, previewed by its card from scripts/cards.ts.
export function examplePage(request: Request, page: Response) {
  const url = siteUrl(request);
  const preset = PRESETS.find((each) => each.id === url.searchParams.get("d"));
  if (!preset) return page;
  const length = skiId(url.searchParams.get("ski"));
  return withPreview(url, {
    alt: `A pair of 541 skis in the ${preset.label} design, ${SKIS[length].size}`,
    description:
      "An example design from the 541 Skis studio. See it in 3D, or design your own.",
    image: `/og/designs/${preset.id}-${length}.jpg`,
    title: `${preset.label} ${SKIS[length].name}`,
  }).transform(page);
}

function withPreview(
  url: URL,
  preview: { alt: string; description: string; image: string; title: string },
) {
  const title = `${preview.title} · 541 Skis`;
  const set = (value: string) => ({
    element(element: Element) {
      element.setAttribute("content", value);
    },
  });
  return new HTMLRewriter()
    .on("title", {
      element(element) {
        element.setInnerContent(title);
      },
    })
    .on('meta[name="description"]', set(preview.description))
    .on('meta[property="og:url"]', set(url.href))
    .on('meta[property="og:title"]', set(title))
    .on('meta[property="og:description"]', set(preview.description))
    .on('meta[property="og:image"]', set(new URL(preview.image, url).href))
    .on('meta[property="og:image:alt"]', set(preview.alt));
}
