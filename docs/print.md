# Print files

How a custom pair's topsheet print file is laid out, and how the site makes
it.

## Format

- **Sheet:** 13 in (330.2 mm) wide, and the ski's length plus 25 mm past the
  tip and tail: 330.2 × 1800 mm for the 175, × 1900 for the 185 and × 1980
  for the 193.
- **Layout:** tips up, both skis side by side, each in its own 165.1 mm
  strip, with the art bleeding past the ski so it trims with it: 10 mm of
  the art itself all round the pair, then mirror images of it to the sheet
  edges.
- **Center marks:** each ski's center line at the top and bottom of the
  sheet, a dashed line between the strips, and the middle of the length at
  both edges and the center. Each is a 1 pt black line on a 3 pt white one,
  so it shows on any art.
- **Window:** 20 mm wide, 347–367 mm from the tail on every model, left
  unprinted across the strip so the wood core shows through.
- **Marks:** at fixed sizes and spots, the 541 logo near the left ski's
  tip, and a small raven (40 mm tall) on the right ski's center line, 85 mm
  from its tail. Each is filled with one of the art's own colours (5% or
  more of it) where one reads on the art beneath (no more than 5% of the
  mark under 3:1 contrast), the same on both skis if one reads on both, and
  otherwise with white or ink. Where the art is too busy for the fill alone (more
  than a quarter of the mark under 3:1), it gets a 2.4 mm outline in the
  art's colour that stands out most from it.
- **Colour:** RGB, as close to 300 dpi as the art allows, read the right
  way round (any mirroring happens at the printer). No white layer: white is painted on the back of
  the clear, brushed topsheet by hand, except at the window.

## Shapes

Each model's outline comes from the CNC export of its base
(`scripts/outline.py` → `src/client/shapes/`). The finished ski is 4 mm
wider than its base, so the outlines are grown 2 mm all round, and the
step where the edges stop near the tail is smoothed out. The site quotes
the widths measured from them:

| Model | Tip / waist / tail (mm) | Radius |
| ----- | ----------------------- | ------ |
| 175   | 139 / 101 / 122         | 17 m   |
| 185   | 136 / 103 / 121         | 19 m   |
| 193   | 143 / 111 / 127         | 19 m   |

## How the site makes it

A custom order starts the print workflow (`src/server/print.ts`), which emails
a link to the print file a minute or two after the order email:

1. **The art:** the image model paints at 1:4 (1024 × 4128), wider than the
   pair, and the customer slides, sizes and flips the pair over it in the
   studio (`src/client/frame.ts`). The order sends just the pair's part of
   it, as shown, with its 10 mm buffer: about 56 dpi with the pair as big as it goes,
   down to about 45 dpi at the smallest it can be sized.
2. **Upscaling:** that art goes to Topaz on Replicate (its CGI mode, 4x),
   about $0.20 a pair, taking it to about 170–225 dpi at full size. If it
   fails, the file uses the original art and the email says why.
3. **The PDF** (`src/server/sheet.ts`): the art placed exactly as the studio
   previews it, mirrored past its edges as bleed, then the window, the
   marks as vector shapes, and the center marks.
4. **Delivery:** a download link that doesn't expire. If the PDF can't be
   built, the email says so instead.

## Open

- Does the center-mark layout match how the print is lined up?
