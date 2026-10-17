// Zooming and panning what an area shows: scroll or pinch to zoom toward
// the pointer, drag to pan and flick to coast, double-click to zoom in on a
// spot or back out.

import { contentBox } from "./box";

const MAX = 6;
// How quickly a flick slows: its speed falls by e every this many ms.
const GLIDE = 325;

export function zoomable(area: HTMLElement, onMove?: () => void) {
  let content: HTMLElement | undefined;
  // The content's own size, unzoomed, in CSS pixels.
  let width = 0;
  let height = 0;
  let inset = 0;
  let scale = 1;
  // How far the content's center is moved, in CSS pixels.
  let x = 0;
  let y = 0;
  const pointers = new Map<number, { x: number; y: number; time: number }>();
  // A one-finger pan's speed, in CSS pixels a millisecond, to coast on.
  let speed = { x: 0, y: 0 };
  let gliding = 0;

  // How far the content can move each way while it covers the area inside
  // its padding: none on a side where it fits, so it stays centered there.
  // Its inset, a margin round what it shows, stays off that too, so the gap
  // to the edge is the same at every zoom.
  const clamp = (value: number, spare: number) =>
    Math.min(Math.max(value, -spare), spare) || 0;
  const spare = (size: number, room: number) =>
    Math.max(0, ((size - 2 * inset) * scale - (room - 2 * inset)) / 2);

  function apply() {
    if (!content) return;
    const room = contentBox(area);
    x = clamp(x, spare(width, room.width));
    y = clamp(y, spare(height, room.height));
    // Centered in the room, so it grows evenly each way. Sized rather than
    // scaled, so a canvas is drawn from its own pixels at every zoom: iOS
    // Safari scales up a copy at its unzoomed size. Moved with its own
    // translate, which adds to any animated transform.
    Object.assign(content.style, {
      height: `${height * scale}px`,
      left: `${room.left + room.width / 2}px`,
      top: `${room.top + room.height / 2}px`,
      translate: `calc(${x}px - 50%) calc(${y}px - 50%)`,
      width: `${width * scale}px`,
    });
    area.classList.toggle("cursor-grab", scale > 1);
    onMove?.();
  }

  // Zooms to a scale, keeping the point under (px, py) where it is.
  function zoomAt(px: number, py: number, next: number) {
    if (!content) return;
    next = Math.min(MAX, Math.max(1, next));
    const box = content.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    x += px - cx - ((px - cx) * next) / scale;
    y += py - cy - ((py - cy) * next) / scale;
    scale = next;
    apply();
  }

  // Coasts on after a flick, slowing, until it stops or meets an edge.
  function glide() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let then = performance.now();
    const step = (now: number) => {
      const decay = Math.exp(-(now - then) / GLIDE);
      then = now;
      // How far it goes over the frame, slowing all the while.
      const to = {
        x: x + speed.x * GLIDE * (1 - decay),
        y: y + speed.y * GLIDE * (1 - decay),
      };
      [x, y] = [to.x, to.y];
      apply();
      speed = {
        x: Math.abs(x - to.x) > 0.5 ? 0 : speed.x * decay,
        y: Math.abs(y - to.y) > 0.5 ? 0 : speed.y * decay,
      };
      if (Math.hypot(speed.x, speed.y) > 0.01) {
        gliding = requestAnimationFrame(step);
      }
    };
    gliding = requestAnimationFrame(step);
  }

  function stop() {
    cancelAnimationFrame(gliding);
    speed = { x: 0, y: 0 };
  }

  area.addEventListener(
    "wheel",
    (event) => {
      if (!content) return;
      event.preventDefault();
      stop();
      // Trackpad pinches arrive as ctrl-wheel, in small steps.
      const lines = event.deltaMode === 1 ? 16 : 1;
      const speed = event.ctrlKey ? 0.01 : 0.002;
      zoomAt(
        event.clientX,
        event.clientY,
        scale * Math.exp(-event.deltaY * lines * speed),
      );
    },
    { passive: false },
  );

  area.addEventListener("pointerdown", (event) => {
    if (!content) return;
    area.setPointerCapture(event.pointerId);
    stop();
    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
    });
    if (scale > 1) area.classList.add("cursor-grabbing");
  });

  area.addEventListener("pointermove", (event) => {
    const last = pointers.get(event.pointerId);
    if (!last) return;
    const other = [...pointers.values()].find((p) => p !== last);
    if (!other) {
      const [dx, dy] = [event.clientX - last.x, event.clientY - last.y];
      x += dx;
      y += dy;
      apply();
      // Smoothed, so a flick coasts at the speed it was going.
      const dt = Math.max(event.timeStamp - last.time, 1);
      speed = {
        x: speed.x * 0.4 + (dx / dt) * 0.6,
        y: speed.y * 0.4 + (dy / dt) * 0.6,
      };
    } else {
      speed = { x: 0, y: 0 };
      // Two fingers: pan with their midpoint, zoom with their spread.
      const mx = (event.clientX + other.x) / 2;
      const my = (event.clientY + other.y) / 2;
      x += mx - (last.x + other.x) / 2;
      y += my - (last.y + other.y) / 2;
      const before = Math.hypot(last.x - other.x, last.y - other.y);
      const after = Math.hypot(
        event.clientX - other.x,
        event.clientY - other.y,
      );
      if (before) zoomAt(mx, my, (scale * after) / before);
      else apply();
    }
    Object.assign(last, {
      time: event.timeStamp,
      x: event.clientX,
      y: event.clientY,
    });
  });

  const release = (event: PointerEvent) => {
    const last = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (pointers.size) return;
    area.classList.remove("cursor-grabbing");
    // Held still before letting go, so it stays put.
    if (last && event.timeStamp - last.time < 80) glide();
  };
  area.addEventListener("pointerup", release);
  area.addEventListener("pointercancel", release);

  area.addEventListener("dblclick", (event) => {
    if (scale > 1) reset();
    else zoomAt(event.clientX, event.clientY, 3);
  });

  function reset() {
    stop();
    scale = 1;
    x = y = 0;
    apply();
  }

  return {
    // Shows new content at the current zoom, as when it's redrawn, with the
    // margin it draws round itself, in CSS pixels.
    show(next: HTMLElement, margin = 0) {
      content = next;
      width = next.offsetWidth;
      height = next.offsetHeight;
      inset = margin;
      Object.assign(next.style, { maxWidth: "none", position: "absolute" });
      apply();
    },
    reset,
  };
}
