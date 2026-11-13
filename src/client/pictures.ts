// Your own images in the browser: read from a file, made small enough to
// send, uploaded, loaded back, and drawn on the skis (uploads.ts).

import { loadDecal, loadLayers, type Placed } from "./cutout";
import type { Layer } from "./decals";
import { loadImage } from "./image";
import { stampAll, type Target } from "./overlay";
import { GAP, type Ski } from "./ski";
import { anchorsOf, copyOf, freedIds, MIN_WIDTH, type Upload } from "./uploads";

export type Picture = CanvasImageSource & { width: number; height: number };
export type PlacedUpload = Upload & { image: Picture };

// The longest side an image is sent at: about 330 dpi across the widest
// ski, and plenty for the length of one; and for a reference picture.
const LONGEST = 2400;
export const REFERENCE_SIZE = 1024;
// Sent as PNG when it has see-through parts; the server takes up to 8 MB.
const MAX_PNG = 6 * 1024 * 1024;
// The longest side an image is kept at to draw: sharp zoomed right in on
// the studio's topsheets, at a fraction of the memory of the full size,
// which stays on the server for the shop.
const DRAWN = 1600;

const loaded = new Map<string, Promise<Picture>>();

// A picture decoded at the size it's drawn.
function toDrawn(source: HTMLImageElement | HTMLCanvasElement) {
  const { height, width } = source;
  const scale = Math.min(1, DRAWN / Math.max(width, height));
  return createImageBitmap(source, {
    resizeHeight: Math.max(1, Math.round(height * scale)),
    resizeQuality: "high",
    resizeWidth: Math.max(1, Math.round(width * scale)),
  });
}

function loadPicture({ id, kind }: Upload): Promise<Picture> {
  if (kind === "decal") return loadDecal(id);
  if (!loaded.has(id)) {
    const loading = loadImage(`/upload/${id}`).then(toDrawn);
    loading.catch(() => loaded.delete(id));
    loaded.set(id, loading);
  }
  return loaded.get(id)!;
}

// A design's images, ready to draw. One that won't load is left off.
export async function loadUploads(
  uploads: Upload[] = [],
): Promise<PlacedUpload[]> {
  const placed = await Promise.all(
    uploads.map((upload) =>
      loadPicture(upload).then(
        (image) => ({ ...upload, image }),
        () => null,
      ),
    ),
  );
  return placed.filter((upload) => upload !== null);
}

// A design's decals and images, ready to draw.
export async function loadPieces(layers?: Layer[], uploads?: Upload[]) {
  const [decals, placed] = await Promise.all([
    loadLayers(layers),
    loadUploads(uploads),
  ]);
  return { decals, uploads: placed };
}

// The decals still in their spots: one moved by hand is drawn among the
// images instead.
export function spotDecals(decals: Placed[] = [], uploads?: Upload[]) {
  const freed = freedIds(uploads);
  return decals.filter((decal) => !freed.has(decal.id));
}

// Images, as files, a drop or a paste can bring.
export const imageFiles = (files?: FileList | null) =>
  [...(files ?? [])].filter((file) => file.type.startsWith("image/"));

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("No image"))),
      type,
      quality,
    ),
  );

// A file made ready to upload: turned the right way up, no bigger than it
// needs to be, and as a PNG only if it has see-through parts.
async function prepare(file: Blob, longest: number) {
  // A JPEG has none, so isn't checked.
  const opaque = file.type === "image/jpeg";
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That image couldn't be opened. Try a JPEG or PNG?");
  }
  try {
    for (; ; longest = Math.round(longest * 0.7)) {
      const scale = Math.min(
        1,
        longest / Math.max(bitmap.width, bitmap.height),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (opaque || !seeThrough(ctx)) {
        return { blob: await toBlob(canvas, "image/jpeg", 0.92), canvas };
      }
      const blob = await toBlob(canvas, "image/png");
      if (blob.size < MAX_PNG || longest < 600) return { blob, canvas };
    }
  } finally {
    bitmap.close();
  }
}

function seeThrough(ctx: CanvasRenderingContext2D) {
  const { data } = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  return false;
}

// Uploads a file, returning its id and the picture to draw, which is kept
// so it needn't be loaded back. A picture only shown to the models as a
// reference needs far fewer pixels than one printed.
export async function uploadFile(file: Blob, longest = LONGEST) {
  const { blob, canvas } = await prepare(file, longest);
  const response = await fetch("/api/upload", {
    body: blob,
    headers: { "content-type": blob.type },
    method: "POST",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error);
  const id = result.id as string;
  const image = await toDrawn(canvas);
  loaded.set(id, Promise.resolve(image));
  return { id, image };
}

// Where a new image goes: on both skis, as wide as fits the ski, no taller
// than a fifth of it, at the first of the usual spots that's clear of the
// others: the front, then the tail, the tip and the back.
const OPENINGS = [0.3, 0.84, 0.16, 0.7, 0.44];

export function newUpload(
  ski: Ski,
  id: string,
  image: Picture,
  others: PlacedUpload[] = [],
): Upload {
  const aspect = image.height / image.width;
  const w = Math.max(MIN_WIDTH, Math.min(90, (0.2 * ski.length) / aspect));
  const half = (w * aspect) / 2 / ski.length;
  const clear = (y: number) =>
    others.every((other) => {
      const reach = Math.max(heightOf(other), other.w) / 2 / ski.length;
      return Math.abs(other.y - y) > half + reach;
    });
  const y = OPENINGS.find(clear) ?? OPENINGS[others.length % OPENINGS.length];
  return { id, r: 0, ski: "both", w, x: 0, y };
}

export const heightOf = (upload: PlacedUpload) =>
  (upload.w * upload.image.height) / upload.image.width;

// The images over what's drawn on each ski, left then right, bottom of the
// stack first. A copy can run off its ski onto the other, so each is drawn
// on every target, but only once on a canvas they share. Decals keep the
// keyline they get in their spots (overlay.ts), judged on their own skis;
// your own images are drawn just as they are. With reuse, a decal keeps
// the keyline it last had, rather than judging the art again.
export function drawUploads(
  ski: Ski,
  uploads: PlacedUpload[] | undefined,
  skis: Target[],
  reuse = false,
) {
  for (const upload of uploads ?? []) {
    const placings = anchorsOf(upload).flatMap((anchor) => {
      const copy = copyOf(ski, upload, anchor);
      const drawn = new Set<CanvasRenderingContext2D>();
      return skis.flatMap((target, side) => {
        if (drawn.has(target.ctx)) return [];
        drawn.add(target.ctx);
        const origin = target.left - side * (ski.span + GAP) * target.px;
        return [
          {
            judge: upload.kind === "decal" && side === anchor,
            stamp: {
              flip: copy.flip,
              h: heightOf(upload),
              image: upload.image,
              turn: (copy.r * Math.PI) / 180,
              w: upload.w,
            },
            target,
            x: origin + copy.cx * target.px,
            y: target.top + copy.cy * target.px,
          },
        ];
      });
    });
    stampAll(placings, reuse);
  }
}
