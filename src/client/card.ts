// Link preview cards, drawn in the browser.

import { COLORS } from "./colors";
import { loadImage } from "./image";
import { LOGO } from "./logo";
import { cutPair } from "./topsheet";
import type { Ski } from "./ski";

// A 1200 x 630 link preview: pairs of skis laid across a topo map, with
// the logo and a title. Each pair is drawn as renderFlat or the product
// photos draw it, tips up; here they lie on their side, tips to the right.
async function shareCard(
  pairs: (CanvasImageSource & { width: number; height: number })[],
  title: [string, string],
) {
  const [w, h, margin] = [1200, 630, 56];
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = COLORS.snow;
  ctx.fillRect(0, 0, w, h);

  const topo = await loadImage("/images/hood-topo.svg").catch(() => null);
  if (topo) {
    const scale = Math.max(w / topo.width, h / topo.height);
    ctx.globalAlpha = 0.12;
    ctx.drawImage(
      topo,
      (w - topo.width * scale) / 2,
      (h - topo.height * scale) / 2,
      topo.width * scale,
      topo.height * scale,
    );
    ctx.globalAlpha = 1;
  }

  // Skis, centered between the logo and the title, shortened if a stack of
  // pairs would run into them.
  const gap = 18;
  const room = 300 - gap * (pairs.length - 1);
  const ratio = pairs.reduce((sum, pair) => sum + pair.width / pair.height, 0);
  const length = Math.min(w - 2 * margin, room / ratio);
  const across = pairs.map((pair) => (pair.width * length) / pair.height);
  const total =
    across.reduce((sum, a) => sum + a, 0) + gap * (pairs.length - 1);
  let y = 315 - total / 2;
  pairs.forEach((pair, i) => {
    ctx.save();
    ctx.translate(w / 2, y + across[i] / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(pair, -across[i] / 2, -length / 2, across[i], length);
    ctx.restore();
    y += across[i] + gap;
  });

  // Logo, top left.
  const size = 56;
  ctx.fillStyle = COLORS.crimson;
  ctx.beginPath();
  ctx.arc(margin + size / 2, margin + size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(margin, margin);
  ctx.scale(size / 400, size / 400);
  ctx.fillStyle = COLORS.white;
  ctx.fill(new Path2D(LOGO));
  ctx.restore();

  // Title, bottom left: ink, then crimson.
  await Promise.all([
    document.fonts.load('800 56px "Big Shoulders Display"'),
    document.fonts.load('500 20px "Geist Mono"'),
  ]).catch(() => {});
  const baseline = h - margin - 4;
  ctx.textBaseline = "alphabetic";
  ctx.font = '800 56px "Big Shoulders Display", sans-serif';
  ctx.letterSpacing = "0px";
  ctx.fillStyle = COLORS.ink;
  ctx.fillText(title[0], margin, baseline);
  const offset = ctx.measureText(title[0]).width;
  ctx.font = '800 56px "Big Shoulders Display", sans-serif';
  ctx.fillStyle = COLORS.crimson;
  ctx.fillText(title[1], margin + offset, baseline);

  ctx.font = '500 20px "Geist Mono", monospace';
  ctx.letterSpacing = "4px";
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = "right";
  ctx.fillText("541.SKI", w - margin + 4, baseline - 6);
  return canvas;
}

// The card for a design: the pair, cut and laid on its side.
export function designCard(
  ski: Ski,
  art: CanvasImageSource & { width: number; height: number },
  label = "Custom ",
) {
  return shareCard([cutPair(ski, art, 1600)], [label, ski.id]);
}
