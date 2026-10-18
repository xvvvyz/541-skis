import { COLORS } from "./colors";
import type { Frame } from "./frame";
import { loadImage } from "./image";
import { LOGO } from "./logo";
import type { Ski } from "./ski";
import { cutPair } from "./topsheet";

// The pair is cut tips up, as renderFlat draws it; here it lies on its side,
// tips to the right.
export async function designCard(
  ski: Ski,
  art: CanvasImageSource & { width: number; height: number },
  { frame, label = "Custom " }: { frame?: Frame; label?: string } = {},
) {
  const pair = cutPair(ski, art, 1600, { frame });
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

  // The skis, centered between the logo and the title, shortened if they
  // would run into them.
  const length = Math.min(w - 2 * margin, (300 * pair.height) / pair.width);
  const across = (pair.width * length) / pair.height;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(pair, -across / 2, -length / 2, across, length);
  ctx.restore();

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

  await Promise.all([
    document.fonts.load('800 56px "Big Shoulders Display"'),
    document.fonts.load('500 20px "Geist Mono"'),
  ]).catch(() => {});
  const baseline = h - margin - 4;
  ctx.textBaseline = "alphabetic";
  ctx.font = '800 56px "Big Shoulders Display", sans-serif';
  ctx.letterSpacing = "0px";
  ctx.fillStyle = COLORS.ink;
  ctx.fillText(label, margin, baseline);
  const offset = ctx.measureText(label).width;
  ctx.fillStyle = COLORS.crimson;
  ctx.fillText(ski.id, margin + offset, baseline);

  ctx.font = '500 20px "Geist Mono", monospace';
  ctx.letterSpacing = "4px";
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = "right";
  ctx.fillText("541.SKI", w - margin + 4, baseline - 6);
  return canvas;
}
