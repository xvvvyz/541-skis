// Decals in the browser: each one loaded and cut out of the flat backdrop
// it was painted on, ready to draw on the skis (overlay.ts).

import type { Layer } from "./decals";
import { borderHole, grow, loadImage } from "./image";

export type Placed = Layer & { image: HTMLCanvasElement };

// How far a colour is from the backdrop's, in RGB, to count as backdrop:
// LOOSE where it joins the backdrop round the edge, INNER anywhere (inside
// a letter's loop, say). The backdrop is a colour the decal was told not
// to use, so its own colours sit well beyond these.
const LOOSE = 110;
const INNER = 70;
// The soft edge, in pixels, worked out from both sides.
const BAND = 2;

const cut = new Map<string, Promise<HTMLCanvasElement>>();

function loadDecal(id: string) {
  if (!cut.has(id)) {
    const loading = loadImage(`/decal/${id}`).then(cutOut);
    // A failed load can be tried again.
    loading.catch(() => cut.delete(id));
    cut.set(id, loading);
  }
  return cut.get(id)!;
}

// A design's decals, ready to draw. One that won't load is left off rather
// than hold up the rest.
export async function loadLayers(layers: Layer[] = []): Promise<Placed[]> {
  const placed = await Promise.all(
    layers.map((layer) =>
      loadDecal(layer.id).then(
        (image) => ({ ...layer, image }),
        () => null,
      ),
    ),
  );
  return placed.filter((layer) => layer !== null);
}

function cutOut(image: HTMLImageElement) {
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, w, h);
  const { data } = pixels;

  const key = backdropOf(data, w, h);
  const distance = (r: number, g: number, b: number) =>
    Math.hypot(r - key[0], g - key[1], b - key[2]);
  const far = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    far[i] = distance(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  }

  // The backdrop: joined to the edge, or near enough its colour anywhere.
  const { hole } = borderHole(pixels, (r, g, b) => distance(r, g, b) < LOOSE);
  for (let i = 0; i < w * h; i++) if (far[i] < INNER) hole[i] = 1;

  // The edge: pixels within BAND of the backdrop, part decal and part
  // backdrop. Each is as solid as it is far from the backdrop's colour,
  // next to how far the solid decal beside it is, and has the backdrop
  // taken back out of its colour.
  const near = grow(hole, w, h, BAND);
  const reach = BAND + 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (hole[i]) {
        data[i * 4 + 3] = 0;
        continue;
      }
      if (!near[i]) continue;
      let solid = 0;
      for (
        let v = Math.max(0, y - reach);
        v <= Math.min(h - 1, y + reach);
        v++
      ) {
        for (
          let u = Math.max(0, x - reach);
          u <= Math.min(w - 1, x + reach);
          u++
        ) {
          if (!near[v * w + u]) solid = Math.max(solid, far[v * w + u]);
        }
      }
      if (!solid) solid = 2 * LOOSE;
      const alpha = Math.min(
        1,
        Math.max(0, (far[i] - INNER) / (solid - INNER)),
      );
      data[i * 4 + 3] = Math.round(alpha * 255);
      if (alpha > 0) {
        for (let k = 0; k < 3; k++) {
          const c = key[k] + (data[i * 4 + k] - key[k]) / alpha;
          data[i * 4 + k] = Math.min(255, Math.max(0, c));
        }
      }
    }
  }
  ctx.putImageData(pixels, 0, 0);
  return trim(canvas, data);
}

// The backdrop's colour: the middle of what's round the edge, channel by
// channel.
function backdropOf(data: Uint8ClampedArray, w: number, h: number) {
  const channels: number[][] = [[], [], []];
  const take = (i: number) => {
    for (let k = 0; k < 3; k++) channels[k].push(data[i * 4 + k]);
  };
  for (let x = 0; x < w; x += 2) {
    take(x);
    take((h - 1) * w + x);
  }
  for (let y = 0; y < h; y += 2) {
    take(y * w);
    take(y * w + w - 1);
  }
  return channels.map((values) => {
    values.sort((a, b) => a - b);
    return values[values.length >> 1];
  });
}

// Cropped to what's left, so it fits its spot by what shows.
function trim(canvas: HTMLCanvasElement, data: Uint8ClampedArray) {
  const { width: w, height: h } = canvas;
  let [x0, y0, x1, y1] = [w, h, -1, -1];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] < 16) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) return canvas;
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext("2d")!.drawImage(canvas, -x0, -y0);
  return out;
}
