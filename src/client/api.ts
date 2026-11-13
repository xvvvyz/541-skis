import type { Frame } from "./frame";
import type { Design } from "./library";
import type { Ink } from "./topsheet";
import type { Upload } from "./uploads";

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

type Saved = Omit<
  Design,
  "created" | "frame" | "owner" | "reference" | "saved" | "src"
> & {
  created?: number;
  frame?: Frame | null;
  reference?: string | null;
};

function fromSaved(saved: Saved, src: string): Design {
  return {
    created: saved.created ?? Date.now(),
    edits: saved.edits,
    frame: saved.frame ?? undefined,
    id: saved.id,
    layers: saved.layers ?? [],
    parent: saved.parent,
    prompt: saved.prompt,
    saved: true,
    src,
    reference: saved.reference ?? undefined,
    uploads: saved.uploads ?? [],
  };
}

interface DesignRequest {
  // Only for a change.
  frame?: Frame;
  parent?: string;
  prompt: string;
  // The images as the studio has them, kept on the new design.
  uploads?: Upload[];
  // An uploaded picture the design should look like, or null for none.
  reference: string | null;
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

// A copy of a design you can't change, or the plain black pair (art), as
// your own, with your images on it.
export async function copyDesign(body: {
  parent?: string;
  art?: string;
  frame?: Frame;
  uploads: Upload[];
  // The parent's decals still on it, by id.
  decals?: string[];
  reference: string | null;
}) {
  const result = await post("/api/copy", body);
  return {
    cardToken: result.cardToken as string,
    design: { ...fromSaved(result, ""), owner: result.ownerToken as string },
  };
}

// Where the pair sits on its art, its images and the decals still on it,
// for the browser that made it, with the cards and the gallery's mark
// colours redrawn if given.
export function saveLayout(
  id: string,
  token: string,
  layout: {
    frame?: Frame;
    uploads?: Upload[];
    decals?: string[];
    reference?: string | null;
  },
  ink?: Ink,
  cards?: Record<string, string>,
) {
  return post(`/api/designs/${id}/frame`, {
    cards,
    ...layout,
    marks: ink?.marks,
    outlines: ink?.outlines,
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
