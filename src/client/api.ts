// The studio's calls to the worker.

import type { Design } from "./library";

async function post(url: string, body: unknown) {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error);
  return result;
}

// A saved design as the studio keeps it.
type Saved = Omit<Design, "created" | "saved" | "src"> & { created?: number };

function fromSaved(saved: Saved, src: string): Design {
  return {
    created: saved.created ?? Date.now(),
    edits: saved.edits,
    id: saved.id,
    parent: saved.parent,
    prompt: saved.prompt,
    saved: true,
    src,
  };
}

export interface DesignRequest {
  guide: string;
  parent?: string;
  prompt: string;
  ski: string;
}

// Draws a design, or edits the parent design with the prompt. Returns it
// with the raw artwork, and the token for saving its link preview.
export async function requestDesign(body: DesignRequest) {
  const result = await post("/api/design", body);
  return {
    cardToken: result.cardToken as string,
    design: fromSaved(result, result.image),
  };
}

// A design saved on the server, by id.
export async function getDesign(id: string) {
  try {
    const response = await fetch(`/api/designs/${id}`);
    if (!response.ok) return undefined;
    return fromSaved(await response.json(), `/art/${id}`);
  } catch {
    return undefined;
  }
}

// Saves a design's link previews, one for each length, with the token it
// was made with.
export function saveCard(
  id: string,
  token: string,
  images: Record<string, string>,
) {
  return post(`/api/designs/${id}/card`, { images, token });
}
