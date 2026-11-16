// An SVG file as a picture to draw. It's a drawing, sharp at any size, so
// it's made as big as it's sent rather than the size it says it is.

import { loadImage } from "./image";

// CSS pixels in each unit a width or height can be given in.
const UNITS: Record<string, number> = {
  "": 1,
  cm: 96 / 2.54,
  in: 96,
  mm: 96 / 25.4,
  pc: 16,
  pt: 96 / 72,
  px: 1,
};

// A width or height in pixels, or undefined for none, or one that depends
// on where the SVG is shown, as a percentage does.
function pixels(value: string | null) {
  const match = value?.trim().match(/^(\d*\.?\d+(?:e[-+]?\d+)?)([a-z]*)$/i);
  const px = match ? Number(match[1]) * UNITS[match[2].toLowerCase()] : 0;
  return px > 0 && Number.isFinite(px) ? px : undefined;
}

// The size an SVG shows at on its own: its width and height, either worked
// out from the other and its viewBox's shape if missing, or the viewBox's
// size, or the 300 x 150 browsers fall back on.
function sizeOf(root: Element, box?: { height: number; width: number }) {
  const width = pixels(root.getAttribute("width"));
  const height = pixels(root.getAttribute("height"));
  if (width && height) return { height, width };
  if (!box) return { height: height ?? 150, width: width ?? 300 };
  if (width) return { height: (width * box.height) / box.width, width };
  if (height) return { height, width: (height * box.width) / box.height };
  return box;
}

// Browsers size an SVG with no width and height of its own differently, or
// not at all, so its size is read from the file and set on it, scaled to
// make its longest side as given.
export async function loadSvg(file: Blob, longest: number) {
  const doc = new DOMParser().parseFromString(
    await file.text(),
    "image/svg+xml",
  );
  const root = doc.documentElement;
  if (
    root.localName !== "svg" ||
    root.namespaceURI !== "http://www.w3.org/2000/svg" ||
    doc.querySelector("parsererror")
  ) {
    throw new Error("Not an SVG");
  }
  const [, , w, h] =
    root
      .getAttribute("viewBox")
      ?.trim()
      .split(/[\s,]+/)
      .map(Number) ?? [];
  const box =
    w > 0 && h > 0 && Number.isFinite(w * h)
      ? { height: h, width: w }
      : undefined;
  const size = sizeOf(root, box);
  // Without a viewBox, a new size would crop the drawing, not scale it.
  if (!box) root.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
  const scale = longest / Math.max(size.width, size.height);
  for (const side of ["width", "height"] as const) {
    root.setAttribute(
      side,
      String(Math.max(1, Math.round(size[side] * scale))),
    );
  }
  const svg = new XMLSerializer().serializeToString(doc);
  return loadImage(`data:image/svg+xml,${encodeURIComponent(svg)}`);
}
