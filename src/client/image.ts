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

export function copyCanvas(source: HTMLCanvasElement) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.getContext("2d")!.drawImage(source, 0, 0);
  return canvas;
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
        // Bilinear from the coarser level.
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

// The pixels joined to the image's edge that match, as 1s, found by
// flooding in from the edge, and how many there are.
export function borderHole(
  image: ImageData,
  matches: (r: number, g: number, b: number) => boolean,
) {
  const { data, width: w, height: h } = image;
  const hole = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!hole[i] && matches(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])) {
      hole[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  let count = 0;
  while (stack.length) {
    const i = stack.pop()!;
    count++;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  return { count, hole };
}

// A mask grown by a pixel each pass, to its four neighbours.
export function grow(mask: Uint8Array, w: number, h: number, passes: number) {
  let grown = mask;
  for (let pass = 0; pass < passes; pass++) {
    const next = grown.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (
          !grown[i] &&
          ((x > 0 && grown[i - 1]) ||
            (x < w - 1 && grown[i + 1]) ||
            (y > 0 && grown[i - w]) ||
            (y < h - 1 && grown[i + w]))
        ) {
          next[i] = 1;
        }
      }
    }
    grown = next;
  }
  return grown;
}
