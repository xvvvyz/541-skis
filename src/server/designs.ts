import { isFrame, type Frame } from "../client/frame";
import { PRESETS } from "../client/presets";
import { SKIS, skiId, type SkiId } from "../client/ski";
import { readUploads, type Upload } from "../client/uploads";
import type { Env } from "./env";
import {
  dataUrl,
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
import { imageSize } from "./pdf";
import {
  keptDecals,
  layersOf,
  planAfter,
  planDesign,
  planFrom,
  unplanned,
  type Decal,
  type Plan,
} from "./plan";
import {
  applyImages,
  carryUploads,
  imageInfo,
  imagesForPlanner,
  namedImages,
  ownUploads,
  placeOf,
} from "./uploads";

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

  // The images as the studio has them, which may be ahead of what's saved,
  // told to the planner so a change can move them.
  const current = readUploads(body?.uploads) ?? parent?.uploads ?? [];
  const infos = await imageInfo(
    env,
    current.filter((upload) => !upload.kind).map((upload) => upload.id),
  );
  const names = namedImages(current);
  const byHand = {
    images: imagesForPlanner(names, infos),
    moved: Object.fromEntries(
      current
        .filter((upload) => upload.kind === "decal")
        .map((upload) => [upload.id, placeOf(upload)]),
    ),
  };

  // The picture the design should look like: as the studio has it, which
  // may have been taken off, or else the one it was changed from had.
  const referenceId = referenceOf(body?.reference, parent?.reference);
  const referenceImage = referenceId
    ? await dataUrl(env.ART, `uploads/${referenceId}`, "image/jpeg")
    : undefined;

  const step =
    (await planDesign(env, prompt, parent?.plan, byHand, referenceImage)) ??
    unplanned(prompt, parent?.plan);

  // No part is painted again after this, so a slow model can't keep a
  // customer waiting much past a minute.
  const deadline = Date.now() + 50_000;
  const [art, decals] = await Promise.all([
    background(env, step.background, parent, ASPECT, deadline, referenceImage),
    paintDecals(env, step.decals, deadline),
  ]);
  if (!art || decals.some((each) => !each)) return error(502, PAINT_FAILED);
  const plan = planAfter(step, decals as Decal[], parent?.plan);
  const uploads = carryUploads(
    applyImages(current, names, step.images, infos),
    step,
    decals as Decal[],
    parent?.plan,
  );

  const saved = {
    edits: parent ? [...parent.edits, prompt] : [],
    frame,
    id: newId(),
    layers: layersOf(plan),
    parent: parent?.id ?? null,
    prompt: parent ? parent.prompt : prompt,
    // Only one that's still there is kept.
    reference: referenceImage ? referenceId : null,
    uploads,
  };
  try {
    await env.ART.put(`designs/${saved.id}`, fromBase64(art.base64), {
      httpMetadata: { contentType: art.type },
    });
    const tokens = await insert(env, saved, plan, art.model ?? null);
    return Response.json({
      ...saved,
      ...tokens,
      image: art.image,
      model: art.model,
    });
  } catch (cause) {
    console.error("saving design failed", cause);
    return error(502, PAINT_FAILED);
  }
}

interface New {
  id: string;
  parent: string | null;
  prompt: string;
  edits: string[];
  frame: Frame | null;
  uploads: Upload[];
  reference: string | null;
}

// A reference picture's id as the studio sent it, null if it took it off,
// or else the one the design was made from had.
const referenceOf = (sent: unknown, before?: string | null) =>
  sent === undefined ? (before ?? null) : isId(sent) ? sent : null;

// Saves a new design, returning the tokens its browser keeps: one to upload
// its preview cards, once, and one to change it later.
async function insert(env: Env, saved: New, plan: Plan, model: string | null) {
  const cardToken = newId();
  const ownerToken = newId();
  await env.DB.prepare(
    "INSERT INTO designs (id, parent, prompt, edits, frame, plan, uploads, reference, model, created, card_token, owner_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      saved.id,
      saved.parent,
      saved.prompt,
      JSON.stringify(saved.edits),
      saved.frame && JSON.stringify(saved.frame),
      JSON.stringify(plan),
      JSON.stringify(saved.uploads),
      saved.reference,
      model,
      Date.now(),
      cardToken,
      await hash(ownerToken),
    )
    .run();
  return { cardToken, ownerToken };
}

// The plain black pair's art, as the studio sends it: small, as it's one
// colour.
const MAX_BLANK = 256 * 1024;

// A design of the customer's own from one they can't change, like an
// example, someone else's, or the plain black pair, once they place images
// on it: the same art and decals, saved with the images and a token to
// keep changing them.
export async function copy(request: Request, env: Env, ip: string) {
  const { success } = await env.UPLOAD_LIMIT.limit({ key: ip });
  if (!success) return error(429, "That's a lot of changes. Give it a minute.");
  const body = await readJson(request);
  const uploads = readUploads(body?.uploads);
  if (!uploads) return error(400, "Those images don't look right.");

  let source: { bytes: Uint8Array; type: string };
  let parent: Saved | null = null;
  if (typeof body?.parent === "string" && body.parent) {
    const found = await parentSource(request, env, body.parent);
    if (!found) return error(404, "That design wasn't found.");
    ({ parent, ...source } = found);
  } else {
    const match =
      typeof body?.art === "string" &&
      body.art.length < MAX_BLANK &&
      body.art.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return error(400, "That design doesn't look right.");
    source = { bytes: fromBase64(match[1]), type: "image/jpeg" };
  }

  const plan =
    (parent && keptDecals(parent.plan, body?.decals)) ??
    parent?.plan ??
    planFrom("");
  const saved: New = {
    edits: parent ? [...parent.edits, "Arranged by hand"] : [],
    frame: isFrame(body?.frame) ? body.frame : (parent?.frame ?? null),
    id: newId(),
    parent: parent?.id ?? null,
    prompt: parent?.prompt ?? "",
    reference: referenceOf(body?.reference, parent?.reference),
    uploads: ownUploads(uploads, plan),
  };
  try {
    await env.ART.put(`designs/${saved.id}`, source.bytes, {
      httpMetadata: { contentType: source.type },
    });
    const tokens = await insert(env, saved, plan, null);
    return Response.json({ ...saved, ...tokens, layers: layersOf(plan) });
  } catch (cause) {
    console.error("copying design failed", cause);
    return error(502, "That didn't save. Try again in a moment.");
  }
}

// A saved design or an example, and its art as it's stored.
async function parentSource(request: Request, env: Env, id: string) {
  const preset = PRESETS.find((p) => p.id === id);
  if (preset) {
    const res = await env.ASSETS.fetch(new URL(preset.art, request.url));
    if (!res.ok) return null;
    const parent: Saved = {
      created: 0,
      edits: [],
      frame: preset.frame ?? null,
      id,
      parent: null,
      plan: planFrom(preset.prompt),
      prompt: preset.prompt,
      reference: null,
      uploads: [],
    };
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      parent,
      type: res.headers.get("content-type") ?? "image/jpeg",
    };
  }
  if (!isId(id)) return null;
  const [parent, object] = await Promise.all([
    find(env, id),
    env.ART.get(`designs/${id}`),
  ]);
  if (!parent || !object) return null;
  return {
    bytes: new Uint8Array(await object.arrayBuffer()),
    parent,
    type: object.httpMetadata?.contentType ?? "image/png",
  };
}

interface Saved {
  id: string;
  parent: string | null;
  prompt: string;
  edits: string[];
  frame: Frame | null;
  plan: Plan;
  uploads: Upload[];
  reference: string | null;
  created: number;
}

async function find(env: Env, id: string): Promise<Saved | null> {
  const row = await env.DB.prepare(
    "SELECT id, parent, prompt, edits, frame, plan, uploads, reference, created FROM designs WHERE id = ?",
  )
    .bind(id)
    .first<
      Omit<Saved, "edits" | "frame" | "plan" | "uploads"> & {
        edits: string;
        frame: string | null;
        plan: string | null;
        uploads: string | null;
      }
    >();
  if (!row) return null;
  const edits: string[] = JSON.parse(row.edits);
  return {
    ...row,
    edits,
    frame: row.frame && JSON.parse(row.frame),
    plan: row.plan ? JSON.parse(row.plan) : planFrom(row.prompt, edits),
    uploads: (row.uploads && readUploads(JSON.parse(row.uploads))) || [],
  };
}

// A parent's art for the model, and the aspect ratio it was painted at, so
// its change keeps the same canvas.
async function loadParent(request: Request, env: Env, id: string) {
  const found = await parentSource(request, env, id);
  if (!found) return null;
  const { bytes, parent, type } = found;
  const size = imageSize(bytes);
  return {
    ...parent,
    aspect: size ? aspectRatio(size.width, size.height) : ASPECT,
    image: `data:${type};base64,${toBase64(bytes)}`,
  };
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
// its images, the decals still on it and the picture it should look like,
// any of them, with the cards and the gallery's mark colours redrawn to
// match.
export async function saveFrame(request: Request, env: Env, id: string) {
  const body = await readJson(request);
  if (typeof body?.token !== "string") return error(403, "Forbidden");
  const frame = body.frame;
  if (frame !== undefined && !isFrame(frame)) {
    return error(400, "That frame doesn't look right.");
  }
  const uploads =
    body.uploads === undefined ? undefined : readUploads(body.uploads);
  if (uploads === null) return error(400, "Those images don't look right.");
  // Sent as null when it's been taken off.
  const reference = body.reference;
  if (reference !== undefined && reference !== null && !isId(reference)) {
    return error(400, "That picture doesn't look right.");
  }
  const current = body.decals === undefined ? null : await find(env, id);
  const plan = current && keptDecals(current.plan, body.decals);
  // The gallery's colours change only once it's been added there.
  const updated = await env.DB.prepare(
    "UPDATE designs SET frame = coalesce(?, frame), uploads = coalesce(?, uploads), plan = coalesce(?, plan), reference = CASE WHEN ? THEN ? ELSE reference END, gallery_ink = CASE WHEN gallery_ink IS NOT NULL THEN coalesce(?, gallery_ink) END WHERE id = ? AND owner_hash = ?",
  )
    .bind(
      frame === undefined ? null : JSON.stringify(frame),
      uploads === undefined
        ? null
        : JSON.stringify(plan ? ownUploads(uploads, plan) : uploads),
      plan && JSON.stringify(plan),
      reference === undefined ? 0 : 1,
      reference ?? null,
      inkJson(body),
      id,
      await hash(body.token),
    )
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
