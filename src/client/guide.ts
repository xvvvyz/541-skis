// Cleanup for older art, from when the image model was shown a guide to
// where the skis go and sometimes left its grey or white round them.

import { fillHoles, toCanvas } from "./image";

export async function cleanArt(src: string) {
  const canvas = await toCanvas(src);
  // Only 1:8 art had the guide.
  if (canvas.width / canvas.height < 0.18) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (removeGuide(image)) ctx.putImageData(image, 0, 0);
  }
  return canvas.toDataURL("image/jpeg", 0.9);
}

function removeGuide(image: ImageData) {
  const { width: w, height: h } = image;
  const grey = borderHole(image, isGuideGrey);
  if (grey.count >= w * h * 0.01) return fill(image, grey);
  // Plenty of art has white in it, even a white ground, so white only
  // counts as the guide when it runs down the gap between the skis, at the
  // middle of the canvas, for most of its length, and mostly stays off
  // each ski's center line, a quarter of the way in from either side.
  const white = borderHole(image, isGuideWhite);
  const share = (x: number, reach = 0) =>
    columnShare(white.hole, w, h, x, reach);
  if (
    white.count &&
    share(w / 2, w * 0.02) >= 0.5 &&
    share(w / 4) < 0.4 &&
    share((3 * w) / 4) < 0.4
  ) {
    return fill(image, white);
  }
  return 0;
}

const GREY = 0x9c;

const isGuideGrey = (r: number, g: number, b: number) =>
  Math.max(r, g, b) - Math.min(r, g, b) < 10 &&
  Math.abs((r + g + b) / 3 - GREY) < 14;

const isGuideWhite = (r: number, g: number, b: number) =>
  Math.min(r, g, b) >= 249 && Math.max(r, g, b) - Math.min(r, g, b) <= 6;

function borderHole(
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

// The share of rows where the hole comes within reach of column x.
function columnShare(
  hole: Uint8Array,
  w: number,
  h: number,
  x: number,
  reach: number,
) {
  const from = Math.round(x - reach);
  const to = Math.round(x + reach);
  let rows = 0;
  for (let y = 0; y < h; y++) {
    for (let i = y * w + from; i <= y * w + to; i++) {
      if (hole[i]) {
        rows++;
        break;
      }
    }
  }
  return rows / h;
}

// Grown first, to take in the soft edge where the model blended the guide
// into the art.
function fill(
  image: ImageData,
  { count, hole }: ReturnType<typeof borderHole>,
) {
  const { width: w, height: h } = image;
  for (let pass = 0; pass < 3; pass++) {
    const grown = hole.slice();
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (
          !hole[i] &&
          (hole[i - 1] || hole[i + 1] || hole[i - w] || hole[i + w])
        ) {
          grown[i] = 1;
        }
      }
    }
    hole.set(grown);
  }
  fillHoles(image, hole);
  return count;
}
