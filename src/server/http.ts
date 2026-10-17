// Request and response helpers shared by the routes.

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
