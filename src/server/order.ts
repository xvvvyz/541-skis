// Orders: an email to the shop with the customer's details and design. A
// custom pair also starts its print file (print.ts), which is emailed a few
// minutes later.

import { COLORS } from "../client/colors";
import { PRICE, SKIS, type SkiId } from "../client/ski";
import { notify } from "./email";
import type { Env } from "./env";
import {
  type Body,
  error,
  fromBase64,
  isImage,
  MAX_PROMPT,
  newId,
  readJson,
} from "./http";
import { jpegInfo } from "./pdf";
import { artKey, type Job } from "./print";

// The largest art the image model paints, with room to spare. Anything
// bigger isn't ours, and would cost more to upscale.
const MAX_ART = { height: 8192, width: 1024 };

export async function order(request: Request, env: Env, ip: string) {
  const { success } = await env.ORDER_LIMIT.limit({ key: ip });
  if (!success) return error(429, "Too many requests. Try again in a minute.");

  const body = await readJson(request);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const ski = typeof body?.ski === "string" ? body.ski.slice(0, 40) : "";
  const note = typeof body?.note === "string" ? body.note.slice(0, 2000) : "";
  const prompt =
    typeof body?.prompt === "string" ? body.prompt.slice(0, MAX_PROMPT) : "";
  const design =
    typeof body?.design === "string" && /^[\w-]{16}$/.test(body.design)
      ? new URL(`/d/${body.design}`, request.url).href.replace(
          /^http:/,
          "https:",
        )
      : "";
  const edits: string[] = Array.isArray(body?.edits)
    ? body.edits
        .filter((edit: unknown) => typeof edit === "string" && edit.trim())
        .slice(0, 20)
        .map((edit: string) => edit.trim().slice(0, MAX_PROMPT))
    : [];

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return error(400, "That email doesn't look right.");
  }
  if (!ski) return error(400, "Pick a ski first.");

  const job = await printJob(request, env, body, email, ski);

  const attachments = [
    isImage(body?.preview) && { data: body.preview, name: "preview" },
    isImage(body?.art) && { data: body.art, name: "artwork" },
  ].filter(Boolean) as { data: string; name: string }[];

  const text = [
    `${email} wants to buy: ${ski} (${PRICE})`,
    note && `Note: ${note}`,
    prompt && `Design prompt: ${prompt}`,
    edits.length > 0 &&
      `Then changed:\n${edits.map((edit) => `- ${edit}`).join("\n")}`,
    design && `See it in 3D: ${design}`,
    "Reply to this email to reach them.",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    await notify(env, {
      attachments,
      replyTo: email,
      subject: `Order request: ${ski}`,
      text,
    });
  } catch (cause) {
    console.error("order email failed", cause, text);
    return error(
      502,
      env.CONTACT_EMAIL
        ? `We couldn't send that. Email ${env.CONTACT_EMAIL} instead.`
        : "We couldn't send that. Try again in a bit.",
    );
  }

  if (job) {
    try {
      const instance = await env.PRINT.create({
        id: job.order,
        params: job,
      });
      // It's an RPC handle; let it go now rather than at garbage collection.
      (instance as Partial<Disposable>)[Symbol.dispose]?.();
    } catch (cause) {
      console.error("print file didn't start", job.order, cause);
    }
  }

  return Response.json({ ok: true });
}

// For a custom pair: saves its art, as the customer saw it, for the print
// file. Null for a stock pair, or art that isn't the studio's.
async function printJob(
  request: Request,
  env: Env,
  body: Body | null,
  customer: string,
  title: string,
): Promise<Job | null> {
  const model = body?.model;
  const match =
    typeof body?.art === "string" &&
    body.art.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!match || typeof model !== "string" || !(model in SKIS)) return null;

  const art = fromBase64(match[1]);
  const jpeg = jpegInfo(art);
  if (!jpeg || jpeg.width > MAX_ART.width || jpeg.height > MAX_ART.height) {
    return null;
  }
  const colors = (list: unknown) =>
    [0, 1].map((i) => {
      const color = Array.isArray(list) ? list[i] : undefined;
      return typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)
        ? color
        : "";
    });
  const marks = colors(body?.marks).map((color) => color || COLORS.ink);
  const outlines = colors(body?.outlines);

  const order = newId();
  await env.ART.put(artKey(order), art, {
    httpMetadata: { contentType: "image/jpeg" },
  });
  const origin = new URL(request.url);
  origin.protocol = "https:";
  return {
    customer,
    marks,
    order,
    outlines,
    origin: origin.origin,
    ski: model as SkiId,
    title,
    token: newId(),
  };
}
