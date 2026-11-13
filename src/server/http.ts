const MAX_IMAGE = 8 * 1024 * 1024;

export const MAX_PROMPT = 600;

export function isImage(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length < MAX_IMAGE &&
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)
  );
}

// A JSON request body; each field is checked where it's used.
export type Body = Record<string, unknown>;

export async function readJson(request: Request): Promise<Body | null> {
  const value: unknown = await request.json().catch(() => null);
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Body)
    : null;
}

export function error(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

// A page on the site, as https, which links in emails and previews need.
export function siteUrl(request: Request, path = request.url) {
  const url = new URL(path, request.url);
  url.protocol = "https:";
  return url;
}

export const isId = (value: unknown): value is string =>
  typeof value === "string" && /^[\w-]{16}$/.test(value);

// 12 bytes as the 16 URL-safe characters every id is.
export const urlId = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

// Unguessable enough to share by link.
export const newId = () => urlId(crypto.getRandomValues(new Uint8Array(12)));

export function toBase64(data: ArrayBuffer | Uint8Array) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// A file in R2 as a data URL, for the models, or undefined if it's not
// there.
export async function dataUrl(bucket: R2Bucket, key: string, type: string) {
  const object = await bucket.get(key);
  if (!object) return undefined;
  const kind = object.httpMetadata?.contentType ?? type;
  return `data:${kind};base64,${toBase64(await object.arrayBuffer())}`;
}

export function fromBase64(base64: string) {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

// Tokens are stored hashed, so the database alone can't stand in for them.
export async function hash(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return toBase64(digest);
}

export function inkJson(body: Body | null) {
  const marks = markColors(body?.marks);
  return marks.every(Boolean)
    ? JSON.stringify({ marks, outlines: markColors(body?.outlines) })
    : null;
}

// Each ski's mark colour, left then right, or "" where it has none.
export const markColors = (list: unknown) =>
  [0, 1].map((i) => {
    const color = Array.isArray(list) ? list[i] : undefined;
    return typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)
      ? color
      : "";
  });
