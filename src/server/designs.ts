// Designs: generating them, saving them, and serving them to share.

import { PRESETS } from "../client/presets";
import { SKIS, skiId, type SkiId } from "../client/ski";
import type { Env } from "./env";
import {
  error,
  fromBase64,
  hash,
  isImage,
  MAX_PROMPT,
  newId,
  readJson,
  toBase64,
} from "./http";
import { ARTWORK_RULES, IMAGE_MODELS, LAYOUT_RULES, positions } from "./prompt";

export async function design(request: Request, env: Env, ip: string) {
  const { success } = await env.DESIGN_LIMIT.limit({ key: ip });
  if (!success) {
    return error(429, "That's a lot of designs. Give it a minute.");
  }

  const body = await readJson(request);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const guide = isImage(body?.guide) ? body.guide : null;
  const ski: SkiId = skiId(body?.ski);

  if (!prompt) return error(400, "Describe your design first.");
  if (prompt.length > MAX_PROMPT) return error(400, "That prompt is too long.");

  // Edits start from a saved design or an example, never an uploaded image.
  const parent =
    typeof body?.parent === "string" && body.parent
      ? await loadParent(request, env, body.parent)
      : null;
  if (body?.parent && !parent) return error(404, "That design wasn't found.");
  const base = parent?.image ?? null;

  const rules = guide
    ? `${ARTWORK_RULES}\n\n${LAYOUT_RULES}\n\n${positions(ski)}`
    : ARTWORK_RULES;
  const text = base
    ? `Edit the ski topsheet artwork in the first image: ${prompt}\nKeep everything else about it the same.${guide ? " The second image is the layout guide." : ""}\n\n${rules}`
    : `${rules}\n\nDesign description: ${prompt}`;

  const content = [
    { type: "text", text },
    ...[base, guide]
      .filter(Boolean)
      .map((url) => ({ type: "image_url", image_url: { url } })),
  ];

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      body: JSON.stringify({
        image_config: { aspect_ratio: "1:8", image_size: "2K" },
        messages: [{ content, role: "user" }],
        modalities: ["image", "text"],
        models: IMAGE_MODELS,
      }),
      headers: {
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "content-type": "application/json",
        "http-referer": "https://541.ski",
        "x-title": "541 Skis",
      },
      method: "POST",
    },
  );

  const data = (await response.json().catch(() => null)) as Completion | null;
  const image = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;

  const match =
    typeof image === "string" &&
    image.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!response.ok || !match) {
    console.error("design failed", response.status, JSON.stringify(data));
    return error(502, "The paint didn't stick. Try again in a moment.");
  }

  const saved = {
    edits: parent ? [...parent.edits, prompt] : [],
    id: newId(),
    parent: parent?.id ?? null,
    prompt: parent ? parent.prompt : prompt,
  };
  const cardToken = newId();
  const ownerToken = newId();
  try {
    await env.ART.put(`designs/${saved.id}`, fromBase64(match[2]), {
      httpMetadata: { contentType: match[1] },
    });
    await env.DB.prepare(
      "INSERT INTO designs (id, parent, prompt, edits, model, created, card_token, owner_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        saved.id,
        saved.parent,
        saved.prompt,
        JSON.stringify(saved.edits),
        data?.model ?? null,
        Date.now(),
        cardToken,
        await hash(ownerToken),
      )
      .run();
  } catch (cause) {
    console.error("saving design failed", cause);
    return error(502, "The paint didn't stick. Try again in a moment.");
  }

  return Response.json({
    ...saved,
    cardToken,
    image,
    model: data?.model,
    ownerToken,
  });
}

// The parts of OpenRouter's reply the studio reads.
type Completion = {
  model?: string;
  choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
};

interface Saved {
  id: string;
  parent: string | null;
  prompt: string;
  edits: string[];
  created: number;
}

async function find(env: Env, id: string): Promise<Saved | null> {
  const row = await env.DB.prepare(
    "SELECT id, parent, prompt, edits, created FROM designs WHERE id = ?",
  )
    .bind(id)
    .first<Omit<Saved, "edits"> & { edits: string }>();
  return row && ({ ...row, edits: JSON.parse(row.edits) } as Saved);
}

// The design to edit and its artwork as a data URL for the model.
async function loadParent(request: Request, env: Env, id: string) {
  const preset = PRESETS.find((p) => p.id === id);
  if (preset) {
    const res = await env.ASSETS.fetch(new URL(preset.art, request.url));
    if (!res.ok) return null;
    const image = `data:image/jpeg;base64,${toBase64(await res.arrayBuffer())}`;
    return { edits: [] as string[], id, image, prompt: preset.prompt };
  }
  if (!/^[\w-]{16}$/.test(id)) return null;
  const [saved, object] = await Promise.all([
    find(env, id),
    env.ART.get(`designs/${id}`),
  ]);
  if (!saved || !object) return null;
  const type = object.httpMetadata?.contentType ?? "image/png";
  const image = `data:${type};base64,${toBase64(await object.arrayBuffer())}`;
  return { ...saved, image };
}

export async function details(env: Env, id: string) {
  const saved = await find(env, id);
  if (!saved) return error(404, "That design wasn't found.");
  return Response.json(saved, {
    headers: { "cache-control": "public, max-age=31536000, immutable" },
  });
}

// The preview cards for a shared design, one for each length, uploaded once
// by the browser that made them, with the token it was given.
export async function saveCard(request: Request, env: Env, id: string) {
  const body = await readJson(request);
  const images = body?.images as Record<string, unknown> | undefined;
  const lengths = Object.keys(SKIS) as SkiId[];
  const cards = lengths.flatMap((length) => {
    const image = images?.[length];
    const match =
      typeof image === "string" &&
      image.length < 2 * 1024 * 1024 &&
      image.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
    return match ? [{ length, match }] : [];
  });
  if (cards.length !== lengths.length || typeof body?.token !== "string") {
    return error(400, "That card doesn't look right.");
  }
  const claimed = await env.DB.prepare(
    "UPDATE designs SET card_token = NULL WHERE id = ? AND card_token = ?",
  )
    .bind(id, body.token)
    .run();
  if (!claimed.meta.changes) return error(403, "Forbidden");
  await Promise.all(
    cards.map(({ length, match }) =>
      env.ART.put(`cards/${id}/${length}`, fromBase64(match[2]), {
        httpMetadata: { contentType: `image/${match[1]}` },
      }),
    ),
  );
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
  return image(object);
}

export async function art(env: Env, key: string) {
  const object = await env.ART.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  return image(object);
}

function image(object: R2ObjectBody) {
  return new Response(object.body, {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": object.httpMetadata?.contentType ?? "image/png",
    },
  });
}

// The studio, with a title and link preview for the shared design. The
// prompt is left out of the preview; it's whatever someone typed.
export async function sharePage(request: Request, env: Env, id: string) {
  const saved = await find(env, id);
  // Link previews need absolute https URLs.
  const url = new URL(request.url);
  url.protocol = "https:";
  const page = await env.ASSETS.fetch(new URL("/design", request.url));
  if (!saved) return page;
  // The length the link opens at, marked before the studio's script runs.
  const length = skiId(url.searchParams.get("ski"));
  const title = `Custom ${length} · 541 Skis`;
  const description =
    "A custom pair designed in the 541 Skis studio. See it in 3D, or design your own.";
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
    .on("[data-ski]", {
      element(element) {
        const on = element.getAttribute("data-ski") === length;
        element.setAttribute("aria-pressed", String(on));
      },
    })
    .on('meta[name="description"]', set(description))
    .on('meta[property="og:url"]', set(url.href))
    .on('meta[property="og:title"]', set(title))
    .on('meta[property="og:description"]', set(description))
    .on(
      'meta[property="og:image"]',
      set(new URL(`/card/${id}?ski=${length}`, url).href),
    )
    .on(
      'meta[property="og:image:alt"]',
      set(`A custom pair of 541 skis, ${length} cm`),
    )
    .transform(page);
}
