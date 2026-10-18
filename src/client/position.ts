// Moving the pair over its art. The whole art shows, dimmed round the pair,
// with the box the print is cropped to dashed round it, and the marks in
// white: their colours are picked from the art, too slowly to follow a drag.

import { contentBox } from "./box";
import { COLORS } from "./colors";
import { clampFrame, placement, type Frame } from "./frame";
import { marks } from "./marks";
import { GAP, type Ski } from "./ski";
import { drawBinding, drawMark, outlinePath } from "./topsheet";

type Art = CanvasImageSource & { width: number; height: number };

interface Shown {
  art: Art;
  bindings: boolean;
  frame?: Frame;
  ski: Ski;
}

// Calls onSettle with the frame each time it stops moving.
export function positioner(
  area: HTMLElement,
  onSettle: (frame: Frame) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.className = "absolute";
  let shown: Shown | undefined;
  // CSS pixels per art pixel, as last drawn.
  let scale = 1;
  const pointers = new Map<number, { x: number; y: number }>();

  function draw() {
    if (!shown) return;
    const { art, bindings, frame, ski } = shown;
    const room = contentBox(area);
    if (!room.width || !room.height) return;
    scale = Math.min(room.width / art.width, room.height / art.height);
    const w = art.width * scale;
    const h = art.height * scale;
    canvas.width = Math.round(w * devicePixelRatio);
    canvas.height = Math.round(h * devicePixelRatio);
    Object.assign(canvas.style, {
      height: `${h}px`,
      left: `${room.left + (room.width - w) / 2}px`,
      top: `${room.top + (room.height - h) / 2}px`,
      width: `${w}px`,
    });

    const ctx = canvas.getContext("2d")!;
    const k = canvas.width / art.width; // device pixels per art pixel
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(art, 0, 0, canvas.width, canvas.height);

    const place = placement(ski, art.width, art.height, frame);
    const px = place.scale * k; // device pixels per mm
    const top = place.y0 * k;
    const centers = [0, 1].map(
      (side) => place.x0 * k + (side * (ski.span + GAP) + ski.span / 2) * px,
    );
    const skis = centers.map((cx) => outlinePath(ski, cx, top, px));

    const shade = new Path2D();
    shade.rect(0, 0, canvas.width, canvas.height);
    for (const path of skis) shade.addPath(path);
    ctx.fillStyle = "rgba(20, 10, 14, 0.6)";
    ctx.fill(shade, "evenodd");

    ctx.lineWidth = devicePixelRatio;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
    ctx.setLineDash([4 * devicePixelRatio, 4 * devicePixelRatio]);
    const { box } = place;
    ctx.strokeRect(box.x * k, box.y * k, box.w * k, box.h * k);
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5 * devicePixelRatio;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    for (const path of skis) ctx.stroke(path);

    marks(ski).forEach((mark, i) =>
      drawMark(ctx, mark, centers[i], top, px, {
        fill: COLORS.white,
        outline: COLORS.ink,
      }),
    );
    if (bindings) {
      for (const cx of centers) drawBinding(ctx, ski, cx, top, px);
    }
  }

  // dx and dy in CSS pixels.
  function move(dx: number, dy: number, factor = 1) {
    if (!shown?.frame) return;
    const { art, frame, ski } = shown;
    shown.frame = clampFrame(ski, art.width, art.height, {
      size: frame.size * factor,
      x: frame.x + dx / scale / art.width,
      y: frame.y + dy / scale / art.height,
    });
    draw();
  }

  let settling = 0;
  function settle(wait = 0) {
    clearTimeout(settling);
    settling = setTimeout(() => shown?.frame && onSettle(shown.frame), wait);
  }

  area.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      // Trackpad pinches arrive as ctrl-wheel, in small steps.
      const lines = event.deltaMode === 1 ? 16 : 1;
      const speed = event.ctrlKey ? 0.01 : 0.002;
      move(0, 0, Math.exp(-event.deltaY * lines * speed));
      settle(300);
    },
    { passive: false },
  );

  area.addEventListener("pointerdown", (event) => {
    area.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    area.classList.add("cursor-grabbing");
  });

  area.addEventListener("pointermove", (event) => {
    const last = pointers.get(event.pointerId);
    if (!last) return;
    const other = [...pointers.values()].find((p) => p !== last);
    if (!other) {
      move(event.clientX - last.x, event.clientY - last.y);
    } else {
      // Two fingers: move with their midpoint, size with their spread.
      const before = Math.hypot(last.x - other.x, last.y - other.y);
      const after = Math.hypot(
        event.clientX - other.x,
        event.clientY - other.y,
      );
      move(
        (event.clientX - last.x) / 2,
        (event.clientY - last.y) / 2,
        before ? after / before : 1,
      );
    }
    Object.assign(last, { x: event.clientX, y: event.clientY });
  });

  const release = (event: PointerEvent) => {
    if (!pointers.delete(event.pointerId) || pointers.size) return;
    area.classList.remove("cursor-grabbing");
    settle();
  };
  area.addEventListener("pointerup", release);
  area.addEventListener("pointercancel", release);

  area.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 20 : 4;
    const keys: Record<string, [number, number, number?]> = {
      "+": [0, 0, 1.05],
      "-": [0, 0, 1 / 1.05],
      "=": [0, 0, 1.05],
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
    };
    const key = keys[event.key];
    if (!key) return;
    event.preventDefault();
    move(...key);
    settle(300);
  });

  new ResizeObserver(draw).observe(area);

  return {
    show(next: Shown) {
      clearTimeout(settling);
      const { art, frame, ski } = next;
      shown = { ...next, frame: clampFrame(ski, art.width, art.height, frame) };
      if (canvas.parentElement !== area) area.replaceChildren(canvas);
      draw();
    },
  };
}
