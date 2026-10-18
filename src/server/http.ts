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

// 16 URL-safe characters, unguessable enough to share by link.
export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
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

// Each ski's mark colour, left then right, or "" where it has none.
// The marks' colours as stored for the gallery, or null without both.
export function inkJson(body: Body | null) {
  const marks = markColors(body?.marks);
  return marks.every(Boolean)
    ? JSON.stringify({ marks, outlines: markColors(body?.outlines) })
    : null;
}

export const markColors = (list: unknown) =>
  [0, 1].map((i) => {
    const color = Array.isArray(list) ? list[i] : undefined;
    return typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)
      ? color
      : "";
  });
