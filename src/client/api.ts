import type { Frame } from "./frame";
import type { Design } from "./library";
import type { Ink } from "./topsheet";

export async function post(url: string, body: unknown) {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error);
  return result;
}

type Saved = Omit<Design, "created" | "frame" | "owner" | "saved" | "src"> & {
  created?: number;
  frame?: Frame | null;
};

function fromSaved(saved: Saved, src: string): Design {
  return {
    created: saved.created ?? Date.now(),
    edits: saved.edits,
    frame: saved.frame ?? undefined,
    id: saved.id,
    parent: saved.parent,
    prompt: saved.prompt,
    saved: true,
    src,
  };
}

interface DesignRequest {
  // Only for a change.
  frame?: Frame;
  parent?: string;
  prompt: string;
}

export async function requestDesign(body: DesignRequest) {
  const result = await post("/api/design", body);
  return {
    cardToken: result.cardToken as string,
    design: { ...fromSaved(result, result.image), owner: result.ownerToken },
  };
}

export async function getDesign(id: string) {
  try {
    // Copies from before frames could change were cached for a year.
    const response = await fetch(`/api/designs/${id}`, { cache: "no-cache" });
    if (!response.ok) return undefined;
    return fromSaved(await response.json(), `/art/${id}`);
  } catch {
    return undefined;
  }
}

export function saveCard(
  id: string,
  token: string,
  images: Record<string, string>,
) {
  return post(`/api/designs/${id}/card`, { images, token });
}

export function saveFrame(
  id: string,
  token: string,
  frame: Frame,
  ink: Ink,
  cards: Record<string, string>,
) {
  return post(`/api/designs/${id}/frame`, {
    cards,
    frame,
    marks: ink.marks,
    outlines: ink.outlines,
    token,
  });
}

export type GalleryStatus = "off" | "pending" | "shown" | "hidden";

// Without show, just reads where it stands.
export async function setGallery(
  id: string,
  token: string,
  show?: boolean,
  copy?: { ink: Ink; thumbnail: string },
) {
  const result = await post(`/api/designs/${id}/gallery`, {
    marks: copy?.ink.marks,
    outlines: copy?.ink.outlines,
    show,
    thumbnail: copy?.thumbnail,
    token,
  });
  return result.status as GalleryStatus;
}
