import { listEdits, notify } from "./email";
import type { Env } from "./env";
import {
  error,
  fromBase64,
  hash,
  inkJson,
  newId,
  readJson,
  siteUrl,
} from "./http";

const PAGE = 48;

type Status = "off" | "pending" | "shown" | "hidden";

interface Standing {
  published: number | null;
  approved: number | null;
}

const parseJson = (json: string | null) =>
  json ? JSON.parse(json) : undefined;

function status({ published, approved }: Standing): Status {
  if (approved === 0) return "hidden";
  if (published === null) return "off";
  return approved === null ? "pending" : "shown";
}

function isThumbnail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length < 512 * 1024 &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value)
  );
}

export async function gallery(request: Request, env: Env) {
  const before =
    Number(new URL(request.url).searchParams.get("before")) ||
    Number.MAX_SAFE_INTEGER;
  const { results } = await env.DB.prepare(
    "SELECT id, published, gallery_ink, frame FROM designs WHERE approved = 1 AND published < ? ORDER BY published DESC LIMIT ?",
  )
    .bind(before, PAGE + 1)
    .all<{
      id: string;
      published: number;
      gallery_ink: string | null;
      frame: string | null;
    }>();
  const page = results.slice(0, PAGE);
  return Response.json(
    {
      designs: page.map((row) => ({
        frame: parseJson(row.frame),
        id: row.id,
        ink: parseJson(row.gallery_ink),
      })),
      next: results.length > PAGE ? page.at(-1)!.published : null,
    },
    { headers: { "cache-control": "no-cache" } },
  );
}

// For the browser that made the design. The first time it's added, it
// brings the gallery's small copy and the shop is emailed a review link.
export async function publish(request: Request, env: Env, id: string) {
  const body = await readJson(request);
  if (typeof body?.token !== "string") return error(403, "Forbidden");
  const row = await env.DB.prepare(
    "SELECT prompt, edits, published, approved, review_hash FROM designs WHERE id = ? AND owner_hash = ?",
  )
    .bind(id, await hash(body.token))
    .first<
      Standing & { prompt: string; edits: string; review_hash: string | null }
    >();
  if (!row) return error(403, "Forbidden");

  if (body.show === false) {
    await env.DB.prepare("UPDATE designs SET published = NULL WHERE id = ?")
      .bind(id)
      .run();
    return Response.json({ status: status({ ...row, published: null }) });
  }
  if (body.show !== true || row.published !== null) {
    return Response.json({ status: status(row) });
  }

  const published = Date.now();
  if (row.review_hash) {
    await env.DB.prepare("UPDATE designs SET published = ? WHERE id = ?")
      .bind(published, id)
      .run();
    return Response.json({ status: status({ ...row, published }) });
  }

  if (!isThumbnail(body.thumbnail)) {
    return error(400, "That design doesn't look right.");
  }
  const thumbnail = body.thumbnail;
  await env.ART.put(
    `gallery/${id}`,
    fromBase64(thumbnail.slice(thumbnail.indexOf(",") + 1)),
    { httpMetadata: { contentType: "image/jpeg" } },
  );
  const ink = inkJson(body);
  const review = newId();
  const claimed = await env.DB.prepare(
    "UPDATE designs SET published = ?, review_hash = ?, gallery_ink = ? WHERE id = ? AND review_hash IS NULL",
  )
    .bind(published, await hash(review), ink, id)
    .run();
  // Added twice at once; the other request emails the shop.
  if (!claimed.meta.changes) return Response.json({ status: "pending" });

  const link = siteUrl(request, `/review/${id}/${review}`);
  try {
    await notify(env, {
      attachments: [{ data: thumbnail, name: "design" }],
      replyTo: env.ORDER_TO,
      subject: "For the gallery",
      text: [
        "Someone wants their design in the gallery. It shows once you approve it.",
        `Design prompt: ${row.prompt}`,
        listEdits(JSON.parse(row.edits)),
        `Show it or keep it out: ${link.href}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
  } catch (cause) {
    console.error("gallery email failed", id, cause);
  }
  return Response.json({ status: "pending" });
}

// For the shop, from the emailed link.
export async function review(request: Request, env: Env, id: string) {
  const body = await readJson(request);
  if (typeof body?.token !== "string") return error(403, "Forbidden");
  const row = await env.DB.prepare(
    "SELECT published, approved, gallery_ink, frame FROM designs WHERE id = ? AND review_hash = ?",
  )
    .bind(id, await hash(body.token))
    .first<Standing & { gallery_ink: string | null; frame: string | null }>();
  if (!row) return error(403, "Forbidden");
  if (typeof body.approve === "boolean") {
    row.approved = Number(body.approve);
    await env.DB.prepare("UPDATE designs SET approved = ? WHERE id = ?")
      .bind(row.approved, id)
      .run();
  }
  return Response.json({
    frame: parseJson(row.frame),
    ink: parseJson(row.gallery_ink),
    status: status(row),
  });
}
