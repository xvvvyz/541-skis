// Contrast (WCAG) between two luminances.
export const contrast = (a: number, b: number) =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

// Relative luminance (WCAG) of the pixel at i in RGBA data.
export function luminanceAt(data: ArrayLike<number>, i: number) {
  const linear = (c: number) =>
    (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return (
    0.2126 * linear(data[i]) +
    0.7152 * linear(data[i + 1]) +
    0.0722 * linear(data[i + 2])
  );
}

export const hexLuminance = (hex: string) =>
  luminanceAt(
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)),
    0,
  );
