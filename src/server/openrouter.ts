// Calls to the models, all through OpenRouter.

import type { Env } from "./env";

// Nano Banana 2.1 first, falling back to Nano Banana 2 when it is rate
// limited. They're the only models on OpenRouter that paint the tall
// canvases a pair of skis needs. 2.1 runs on our own Google AI Studio key,
// with billing, in the OpenRouter workspace; without it, OpenRouter's
// shared pool turns most requests away.
const IMAGE_MODELS = [
  "google/gemini-nano-banana-2.1",
  "google/gemini-3.1-flash-image",
];

// Plans the design: good at reading what a customer means.
export const PLAN_MODELS = [
  "anthropic/claude-sonnet-5.5",
  "google/gemini-3.8-flash",
];

// Looks over what the image model painted: quick, and better at reading
// images than the planner.
export const CHECK_MODELS = [
  "google/gemini-3.8-flash",
  "anthropic/claude-sonnet-5.5",
];

type Content =
  | string
  | (
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    )[];

interface Completion {
  model?: string;
  choices?: {
    message?: {
      content?: string | null;
      images?: { image_url?: { url?: string } }[];
    };
  }[];
}

async function complete(env: Env, body: object, signal?: AbortSignal) {
  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "content-type": "application/json",
        "http-referer": "https://541.ski",
        "x-title": "541 Skis",
      },
      method: "POST",
      signal,
    },
  );
  const data = (await response.json().catch(() => null)) as Completion | null;
  return { data, ok: response.ok, status: response.status };
}

export interface Painted {
  // As a data URL, straight from the model.
  image: string;
  type: string;
  base64: string;
  model?: string;
}

// An image from the image model, or null when it didn't paint one.
export async function paint(
  env: Env,
  text: string,
  aspect: string,
  { from, size = "2K" }: { from?: string; size?: string } = {},
): Promise<Painted | null> {
  const { data, ok, status } = await complete(env, {
    image_config: { aspect_ratio: aspect, image_size: size },
    messages: [
      {
        content: [
          { text, type: "text" },
          ...(from ? [{ image_url: { url: from }, type: "image_url" }] : []),
        ],
        role: "user",
      },
    ],
    modalities: ["image", "text"],
    models: IMAGE_MODELS,
  });
  const image = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  const match =
    typeof image === "string" &&
    image.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!ok || !match) {
    console.error("paint failed", status, JSON.stringify(data)?.slice(0, 2000));
    return null;
  }
  return {
    base64: match[2],
    image: match[0],
    model: data?.model,
    type: match[1],
  };
}

// JSON to the schema from a text model, or null if it doesn't answer in
// time.
export async function ask<T>(
  env: Env,
  system: string,
  content: Content,
  {
    models,
    schema,
    timeout,
  }: { models: string[]; schema: object; timeout: number },
): Promise<T | null> {
  try {
    const { data, ok, status } = await complete(
      env,
      {
        max_tokens: 4000,
        messages: [
          { content: system, role: "system" },
          { content, role: "user" },
        ],
        models,
        reasoning: { effort: "low" },
        response_format: {
          json_schema: { name: "answer", schema, strict: true },
          type: "json_schema",
        },
      },
      AbortSignal.timeout(timeout),
    );
    const text = data?.choices?.[0]?.message?.content;
    if (!ok || !text) {
      console.error("ask failed", status, JSON.stringify(data)?.slice(0, 2000));
      return null;
    }
    // Some models wrap JSON in a code fence, or a sentence, even when asked
    // not to.
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    if (!json) throw new Error(`no JSON in ${text.slice(0, 200)}`);
    return JSON.parse(json);
  } catch (cause) {
    console.error("ask failed", cause);
    return null;
  }
}
