export function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error(`Couldn't load ${src.slice(0, 64)}`));
    image.src = src;
  });
}

// An image decoded off the main thread, so drawing it doesn't stall a
// frame. A design's art takes about 16 MB until closed.
export async function loadBitmap(src: string) {
  return createImageBitmap(await loadImage(src));
}

// Uses an image decoded off the main thread, then frees it.
export async function withBitmap<T>(
  src: string,
  use: (image: ImageBitmap) => T | Promise<T>,
) {
  const image = await loadBitmap(src);
  try {
    return await use(image);
  } finally {
    image.close();
  }
}

// An image redrawn onto a canvas, to edit or re-encode, at its own size or
// stretched to another.
export async function toCanvas(src: string, width?: number, height?: number) {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = width ?? image.naturalWidth;
  canvas.height = height ?? image.naturalHeight;
  canvas
    .getContext("2d", { willReadFrequently: true })!
    .drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// A copy of a canvas, to show the same drawing in more than one place.
export function copyCanvas(source: HTMLCanvasElement) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.getContext("2d")!.drawImage(source, 0, 0);
  return canvas;
}

export async function toJpeg(src: string) {
  return (await toCanvas(src)).toDataURL("image/jpeg", 0.9);
}

// Fills the pixels marked in hole from the colours around them: average the
// known colours down a pyramid (push), then fill each level's holes from the
// coarser one (pull), so the fill blends smoothly into its surroundings.
export function fillHoles(image: ImageData, hole: Uint8Array) {
  const { data, width: w, height: h } = image;
  type Level = { w: number; h: number; c: Float32Array; a: Float32Array };
  const base: Level = {
    a: new Float32Array(w * h),
    c: new Float32Array(w * h * 3),
    h,
    w,
  };
  for (let i = 0; i < w * h; i++) {
    if (hole[i]) continue;
    base.a[i] = 1;
    for (let k = 0; k < 3; k++) base.c[i * 3 + k] = data[i * 4 + k];
  }
  const levels = [base];
  while (levels.at(-1)!.w > 1 || levels.at(-1)!.h > 1) {
    const f = levels.at(-1)!;
    const n: Level = {
      a: new Float32Array(Math.ceil(f.w / 2) * Math.ceil(f.h / 2)),
      c: new Float32Array(Math.ceil(f.w / 2) * Math.ceil(f.h / 2) * 3),
      h: Math.ceil(f.h / 2),
      w: Math.ceil(f.w / 2),
    };
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const i = y * f.w + x;
        const j = (y >> 1) * n.w + (x >> 1);
        n.a[j] += f.a[i];
        for (let k = 0; k < 3; k++) n.c[j * 3 + k] += f.c[i * 3 + k] * f.a[i];
      }
    }
    for (let j = 0; j < n.w * n.h; j++) {
      if (n.a[j] > 0) for (let k = 0; k < 3; k++) n.c[j * 3 + k] /= n.a[j];
      n.a[j] = Math.min(1, n.a[j]);
    }
    levels.push(n);
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const f = levels[l];
    const n = levels[l + 1];
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const i = y * f.w + x;
        if (f.a[i] >= 1) continue;
        // Bilinear from the coarser level, so the fill is smooth.
        const fx = Math.min(n.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
        const fy = Math.min(n.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const x1 = Math.min(n.w - 1, x0 + 1);
        const y1 = Math.min(n.h - 1, y0 + 1);
        const tx = fx - x0;
        const ty = fy - y0;
        for (let k = 0; k < 3; k++) {
          const at = (xx: number, yy: number) => n.c[(yy * n.w + xx) * 3 + k];
          const coarse =
            (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) +
            (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
          f.c[i * 3 + k] = f.c[i * 3 + k] * f.a[i] + coarse * (1 - f.a[i]);
        }
        f.a[i] = 1;
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (!hole[i]) continue;
    for (let k = 0; k < 3; k++) data[i * 4 + k] = base.c[i * 3 + k];
  }
}
