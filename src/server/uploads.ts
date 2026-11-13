// The customer's own images, uploaded from the studio before they're placed
// on a design. Each is kept once, by its content, so the same picture added
// twice is one file.

import { spotNear } from "../client/decals";
import { DEFAULT_SKI, SKIS } from "../client/ski";
import { MIN_WIDTH, spotUpload, type Upload } from "../client/uploads";
import type { Env } from "./env";
import { error, toBase64, urlId } from "./http";
import { ask, CHECK_MODELS } from "./openrouter";
import { imageSize } from "./pdf";
import type { Decal, Plan, PlannedImage, Step } from "./plan";
import { CAPTION_RULES, CAPTION_SCHEMA } from "./prompt";

// The studio sends JPEG, or PNG for pictures with see-through parts, as the
// request's body.
const MAGIC: Record<string, (bytes: Uint8Array) => boolean> = {
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
};
const MAX_BYTES = 8 * 1024 * 1024;

const BAD = "That image doesn't look right. Try a JPEG or PNG?";

export async function upload(
  request: Request,
  env: Env,
  ip: string,
  ctx: ExecutionContext,
) {
  const { success } = await env.UPLOAD_LIMIT.limit({ key: ip });
  if (!success) return error(429, "That's a lot of images. Give it a minute.");
  const kind = request.headers
    .get("content-type")
    ?.match(/^image\/(png|jpeg)$/)?.[1];
  if (!kind || Number(request.headers.get("content-length")) > MAX_BYTES) {
    return error(400, BAD);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  const size = imageSize(bytes);
  if (bytes.length > MAX_BYTES || !MAGIC[kind](bytes) || !size) {
    return error(400, BAD);
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const id = urlId(new Uint8Array(digest, 0, 12));
  const key = `uploads/${id}`;
  if (!(await env.ART.head(key))) {
    const type = `image/${kind}`;
    await env.ART.put(key, bytes, {
      customMetadata: { aspect: String(size.height / size.width) },
      httpMetadata: { contentType: type },
    });
    // Described now, so a change that talks about it needn't wait.
    ctx.waitUntil(caption(env, id, bytes, type));
  }
  return Response.json({ id });
}

// What the planner knows of an image: what it shows, and its height over
// its width, to fit it in a spot.
interface ImageInfo {
  caption: string;
  aspect: number;
}

const UNKNOWN_CAPTION = "a picture the customer added";

// What a picture shows, in a few words, from the vision model, kept beside
// it in R2. A failure isn't kept, so it's tried again.
async function caption(env: Env, id: string, bytes: Uint8Array, type: string) {
  const answer = await ask<{ caption: string }>(
    env,
    CAPTION_RULES,
    [
      { text: "Describe this picture.", type: "text" },
      {
        image_url: { url: `data:${type};base64,${toBase64(bytes)}` },
        type: "image_url",
      },
    ],
    { models: CHECK_MODELS, schema: CAPTION_SCHEMA, timeout: 20_000 },
  );
  const text = answer?.caption?.trim().slice(0, 200);
  if (text) await env.ART.put(`captions/${id}`, text);
  return text;
}

// Each image's info. One not described yet, as when it was only just
// uploaded and its description failed, is described now.
export async function imageInfo(env: Env, ids: string[]) {
  const infos = new Map<string, ImageInfo>();
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const [head, known] = await Promise.all([
        env.ART.head(`uploads/${id}`),
        env.ART.get(`captions/${id}`).then((object) => object?.text()),
      ]);
      let text = known;
      if (!text && head) {
        const object = await env.ART.get(`uploads/${id}`);
        if (object) {
          const type = object.httpMetadata?.contentType ?? "image/jpeg";
          text = await caption(
            env,
            id,
            new Uint8Array(await object.arrayBuffer()),
            type,
          );
        }
      }
      infos.set(id, {
        aspect: Number(head?.customMetadata?.aspect) || 1,
        caption: text || UNKNOWN_CAPTION,
      });
    }),
  );
  return infos;
}

// The model the planner's spots are measured on, and images placed in
// them; a share of the length puts them in the same place on the others.
const PLANNER_SKI = SKIS[DEFAULT_SKI];

// The customer's own images, as the planner names them: image1, image2 and
// so on, bottom of the stack first. Decals moved by hand stay with the
// decals.
export const namedImages = (uploads: Upload[]) =>
  new Map(
    uploads
      .filter((upload) => !upload.kind)
      .map((upload, i) => [upload, `image${i + 1}`]),
  );

// The customer's own images as the planner sees them.
export const imagesForPlanner = (
  names: Map<Upload, string>,
  infos: Map<string, ImageInfo>,
) =>
  [...names].map(([upload, id]) => ({
    id,
    shows: infos.get(upload.id)?.caption ?? UNKNOWN_CAPTION,
    ...placeOf(upload),
  }));

// Where something placed by hand sits, in the planner's terms.
export function placeOf(upload: Upload) {
  const s = upload.y * PLANNER_SKI.length;
  const { at, width } = spotNear(PLANNER_SKI, s);
  const across =
    Math.abs(upload.x) < 8
      ? "centered"
      : upload.x < 0
        ? "toward its left edge"
        : "toward its right edge";
  const skis = upload.ski === "both" ? "both skis" : `the ${upload.ski} ski`;
  return {
    where: `${at}, ${across}, on ${skis}`,
    size: `${Math.round(upload.w)} mm wide, ${Math.round((100 * upload.w) / width)}% of the ski's width there`,
    turned: Math.round(upload.r),
    mirror: !!upload.mirror,
  };
}

// The customer's images after the planner's step: each kept where it is,
// perhaps resized, put in a spot as a decal would be, or taken off. Ones
// the planner leaves out stay as they were.
export function applyImages(
  uploads: Upload[],
  names: Map<Upload, string>,
  planned: PlannedImage[],
  infos: Map<string, ImageInfo>,
): Upload[] {
  return uploads.flatMap((upload) => {
    const name = names.get(upload);
    const step = name && planned.find((each) => each.id === name);
    if (!step || step.action === "keep") {
      const scale = step ? Math.min(4, Math.max(0.25, step.scale || 1)) : 1;
      return [{ ...upload, w: Math.max(MIN_WIDTH, upload.w * scale) }];
    }
    if (step.action === "remove") return [];
    const aspect = infos.get(upload.id)?.aspect ?? 1;
    return [spotUpload(PLANNER_SKI, { ...step, id: upload.id }, 1, aspect)];
  });
}

// A design's images after a change. A decal moved by hand keeps its place
// while the change only keeps or repaints it, and goes back to a spot when
// the change moves it; one the change leaves out is gone. A new design
// keeps only the customer's own images.
export function carryUploads(
  uploads: Upload[],
  step: Step,
  painted: Decal[],
  current?: Plan,
): Upload[] {
  return uploads.flatMap((upload) => {
    if (upload.kind !== "decal") return [upload];
    const i = step.decals.findIndex((decal) => decal.from === upload.id);
    const before = current?.decals.find((decal) => decal.id === upload.id);
    if (i < 0 || !before) return [];
    const planned = step.decals[i];
    const moved = (["at", "ski", "size", "along", "mirror"] as const).some(
      (key) => planned[key] !== before[key],
    );
    return moved ? [] : [{ ...upload, id: painted[i].id }];
  });
}

// Only decals the design has can be moved by hand.
export const ownUploads = (uploads: Upload[], plan: Plan | null) => {
  const decals = new Set(plan?.decals.map((decal) => decal.id));
  return uploads.filter((u) => u.kind !== "decal" || decals.has(u.id));
};
