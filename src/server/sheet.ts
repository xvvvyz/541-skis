// The print file for a custom pair, laid out like the shop's own: one sheet
// 13 in wide, tips up, both skis side by side in their own strips, 25 mm
// past the tip and tail. The art is placed exactly as the studio previews
// it, the window is left unprinted so the wood shows, edged in black, the
// marks go on top as vector shapes, and center marks help line the print up.

import { COLORS } from "../client/colors";
import { markScale, marks, OUTLINE, windowSpan } from "../client/marks";
import { placement } from "../client/frame";
import { GAP, SKIS, type SkiId } from "../client/ski";
import { matrix, pathOps, readJpeg, writePdf } from "./pdf";

const SHEET_WIDTH = 330.2; // mm, 13 in
const STRIP = SHEET_WIDTH / 2;
const END = 25; // mm of sheet past the tip and tail
const PT = 72 / 25.4; // points per mm

const rgb = (hex: string) =>
  [1, 3, 5]
    .map(
      (i) =>
        Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 1000) / 1000,
    )
    .join(" ");

export async function buildSheet(
  bucket: R2Bucket,
  options: {
    art: string;
    key: string;
    marks: string[];
    outlines: string[];
    ski: SkiId;
    title: string;
  },
) {
  const ski = SKIS[options.ski];
  const L = ski.length;
  const height = L + 2 * END;

  const { jpeg, size } = await readJpeg(bucket, options.art);

  // The art in millimetres. It comes cropped to the pair's box, so the
  // default frame places it as the studio showed it.
  const { scale, x0, y0 } = placement(ski, jpeg.width, jpeg.height);
  const artWidth = jpeg.width / scale;
  const artHeight = jpeg.height / scale;
  const artTop = END - y0 / scale;

  // Everything below is drawn in millimetres down from the sheet's top-left
  // corner, flipped once onto the PDF's points.
  const ops = [matrix([PT, 0, 0, -PT, 0, height * PT])];

  marks(ski).forEach((mark, side) => {
    const left = side * STRIP;
    const center = left + STRIP / 2;
    const artLeft =
      center - ski.span / 2 - side * (ski.span + GAP) - x0 / scale;

    ops.push("q", `${left} 0 ${STRIP} ${height} re W n`);
    // The art, then mirror images of it around its edges as bleed, wherever
    // the strip runs past it.
    for (const dx of [-1, 0, 1]) {
      for (const dy of [-1, 0, 1]) {
        const x = artLeft + dx * artWidth;
        const y = artTop + dy * artHeight;
        if (x >= left + STRIP || x + artWidth <= left) continue;
        if (y >= height || y + artHeight <= 0) continue;
        // Images fill the unit square from the bottom up, so flip them to
        // read top down, and flip again for each mirrored copy.
        const [a, e] = dx ? [-artWidth, x + artWidth] : [artWidth, x];
        const [d, f] = dy ? [artHeight, y] : [-artHeight, y + artHeight];
        ops.push("q", matrix([a, 0, 0, d, e, f]), "/Art Do", "Q");
      }
    }

    // The window, unprinted all the way across, with a black border along
    // both edges.
    const window = windowSpan(ski);
    ops.push(
      "1 1 1 rg",
      `${left} ${END + window.from} ${STRIP} ${window.to - window.from} re f`,
      "0 0 0 rg",
      `${left} ${END + window.from - window.border} ${STRIP} ${window.border} re f`,
      `${left} ${END + window.to} ${STRIP} ${window.border} re f`,
    );

    const fill = options.marks[side] || COLORS.ink;
    const path = pathOps(mark.path);
    ops.push(
      "q",
      matrix([1, 0, 0, 1, center, END]),
      matrix(mark.matrix),
      ...(options.outlines[side]
        ? [
            `${rgb(options.outlines[side])} RG`,
            `${OUTLINE / markScale(mark)} w 1 j`,
            path,
            "S",
          ]
        : []),
      `${rgb(fill)} rg`,
      path,
      "f",
      "Q",
      "Q",
    );
  });

  // Center marks: each ski's center line at the top and bottom of the
  // sheet, a dashed line between the strips, and the middle of the length
  // at both edges and the center. Each is a black line on a wider white one,
  // so it shows on any art.
  const middle = END + L / 2;
  const tick = 16;
  const lines = [
    ...[0, 1].flatMap((side) => {
      const x = side * STRIP + STRIP / 2;
      return [
        `${x} 0 m ${x} ${tick} l`,
        `${x} ${height - tick} m ${x} ${height} l`,
      ];
    }),
    ...[0, STRIP - tick / 2, SHEET_WIDTH - tick].map(
      (x) => `${x} ${middle} m ${x + tick} ${middle} l`,
    ),
  ].join(" ");
  const split = `${STRIP} 0 m ${STRIP} ${height} l`;
  for (const [color, width] of [
    ["1 1 1", 3],
    ["0 0 0", 1],
  ] as const) {
    ops.push(
      `${color} RG`,
      `${width / PT} w`, // in points
      "[] 0 d",
      `${lines} S`,
      "[10 6] 0 d",
      `${split} S`,
    );
  }

  await writePdf(
    bucket,
    options.key,
    {
      content: ops.join("\n"),
      height: height * PT,
      title: options.title,
      width: SHEET_WIDTH * PT,
    },
    { jpeg, key: options.art, size },
  );
  return { dpi: Math.round(scale * 25.4) };
}
