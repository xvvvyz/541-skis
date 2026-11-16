// The pair laid flat, where its pictures move by hand once that's turned
// on: your own images and the decals. Tap one to pick it, then drag it, pull
// its corner to size it from the corner across, or from its middle with Alt
// held, or pull its top handle to turn it; with two fingers, pinch and twist
// it. Off a picture, or with moving them off, drag and pinch move the view,
// so a small one on a phone can be zoomed in on. The keys work too. The
// picked picture's tools float beside it.

import { contentBox } from "./box";
import { COLORS } from "./colors";
import type { Placed } from "./cutout";
import { placement, type Frame } from "./frame";
import { marks } from "./marks";
import { drawUploads, heightOf, type PlacedUpload } from "./pictures";
import { GAP, LARGEST, type Ski } from "./ski";
import {
  addWindow,
  artStrip,
  drawArt,
  drawBinding,
  drawMark,
  drawOver,
  outlinePath,
  sheet,
  skiEdge,
  skiShadow,
  type Art,
  type Ink,
} from "./topsheet";
import {
  anchorsOf,
  copyOf,
  freeDecal,
  hits,
  MIN_WIDTH,
  reanchor,
  skiCenter,
} from "./uploads";
import { wheelZoom } from "./zoom";

export interface Scene {
  art: Art;
  bindings: boolean;
  decals?: Placed[];
  frame?: Frame;
  ski: Ski;
  uploads: PlacedUpload[];
  // The marks' colours, as picked from the art.
  ink: Ink;
}

interface Callbacks {
  // The images once a change settles, bottom of the stack first, with any
  // decals moved by hand among them.
  change: (uploads: PlacedUpload[]) => void;
  select: (index: number | null) => void;
  remove: (index: number) => void;
  // Whether the view is zoomed in, to offer zooming back out.
  zoomed: (zoomed: boolean) => void;
}

const MAX_ZOOM = 10;
// Handles, in CSS pixels: how big they're drawn, how near counts as on
// one, and how far the turning handle stands off the image.
const HANDLE = 7;
const REACH = 22;
const STALK = 26;
// How near, in CSS pixels, an image snaps to its ski's center line, and in
// degrees, to upright or square.
const SNAP = 6;
const SNAP_TURN = 4;
// How big, in CSS pixels, a picked image is zoomed to from the list.
const FOCUS = 150;
// An image's corners, as which way each is from its middle, across and down.
const GRIPS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;
type Grip = (typeof GRIPS)[number];

type Gesture =
  | { kind: "pan"; moved: boolean }
  | { kind: "move" | "rotate"; anchor: number }
  // The corner being pulled.
  | { kind: "scale"; anchor: number; grip: Grip }
  | { kind: "pinch" | "zoom" };

export function arranger(
  area: HTMLElement,
  toolbar: HTMLElement,
  on: Callbacks,
) {
  const canvas = document.createElement("canvas");
  canvas.className = "absolute inset-0 size-full";
  canvas.addEventListener("animationend", () =>
    canvas.classList.remove("animate-rise"),
  );
  let scene: Scene | undefined;
  // Whether pictures can be picked and moved, or the pair's only looked at.
  let editing = false;
  let selected: number | null = null;
  // The copy of it last touched, which gets the handles.
  let active = 0;
  // The view: zoom, and how far it's panned, in CSS pixels.
  let zoom = 1;
  let pan = { x: 0, y: 0 };
  // Where the center line guide shows while an image snaps to it.
  let guide: number | null = null;
  let frame = 0;

  const pointers = new Map<number, { x: number; y: number }>();
  let gesture: Gesture | undefined;
  // What the gesture started from: the pointers and the image as it was.
  let start: {
    points: { x: number; y: number }[];
    upload?: PlacedUpload;
    pan: { x: number; y: number };
    zoom: number;
  } = { pan, points: [], zoom };
  let edited = false;
  // While a picture moves, decals keep the keylines they had, rather than
  // reading the art back every frame; they're judged again once it settles.
  let live = false;

  // The pair's layout in CSS pixels: px per mm, and the left ski's top-left
  // corner, inside the area's padding.
  function layout() {
    const ski = scene!.ski;
    const room = contentBox(area);
    const width = 2 * ski.span + GAP;
    // Shorter pairs are drawn to the same scale as the biggest.
    const fit =
      Math.min(room.width / LARGEST.width, room.height / LARGEST.length) * 0.96;
    const px = fit * zoom;
    return {
      fit,
      ox: room.left + room.width / 2 - (width * px) / 2 + pan.x,
      oy: room.top + room.height / 2 - (ski.length * px) / 2 + pan.y,
      px,
      room,
    };
  }

  // A point on the area, in CSS pixels, from a pointer.
  function local(point: { x: number; y: number }) {
    const box = area.getBoundingClientRect();
    return { x: point.x - box.left, y: point.y - box.top };
  }

  // A point on the area as mm on the pair.
  function toMm(point: { x: number; y: number }) {
    const { ox, oy, px } = layout();
    const p = local(point);
    return { x: (p.x - ox) / px, y: (p.y - oy) / px };
  }

  const sizeOf = (upload: PlacedUpload) => ({
    h: heightOf(upload),
    w: upload.w,
  });

  // One copy's corners and turning handle, in CSS pixels on the area.
  function handlesOf(
    upload: PlacedUpload,
    anchor: number,
    { ox, oy, px } = layout(),
  ) {
    const copy = copyOf(scene!.ski, upload, anchor);
    const { h, w } = sizeOf(upload);
    const angle = (copy.r * Math.PI) / 180;
    const at = (u: number, v: number) => ({
      x: ox + copy.cx * px + u * Math.cos(angle) - v * Math.sin(angle),
      y: oy + copy.cy * px + u * Math.sin(angle) + v * Math.cos(angle),
    });
    const [hw, hh] = [(w * px) / 2, (h * px) / 2];
    return {
      center: at(0, 0),
      corners: GRIPS.map(([sx, sy]) => at(sx * hw, sy * hh)),
      stalk: at(0, -hh),
      turn: at(0, -hh - STALK),
    };
  }

  function draw() {
    frame = 0;
    if (!scene) return;
    const { art, bindings, decals, frame: artFrame, ink, ski, uploads } = scene;
    const k = devicePixelRatio;
    const width = Math.round(area.clientWidth * k);
    const height = Math.round(area.clientHeight * k);
    if (!width || !height) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";

    // Everything below is in device pixels.
    const layoutNow = layout();
    const px = layoutNow.px * k;
    const ox = layoutNow.ox * k;
    const oy = layoutNow.oy * k;
    const step = (ski.span + GAP) * px;
    const lefts = [ox, ox + step];
    const centers = lefts.map((left) => left + (ski.span / 2) * px);
    const paths = centers.map((cx) => outlinePath(ski, cx, oy, px));
    const targets = lefts.map((left) => ({ ctx, left, px, top: oy }));
    const chosen = selected !== null ? uploads[selected] : undefined;
    const reuse = live || !!gesture;

    // The picked image shows faintly where it runs off the skis.
    if (chosen) {
      ctx.globalAlpha = 0.35;
      drawUploads(ski, [chosen], targets, true);
      ctx.globalAlpha = 1;
    }

    for (const path of paths) skiShadow(ctx, path, px);

    ctx.save();
    const both = new Path2D();
    for (const path of paths) both.addPath(path);
    ctx.clip(both);
    const place = placement(ski, art.width, art.height, artFrame);
    lefts.forEach((left, side) =>
      drawArt(ctx, art, artFrame?.flip, artStrip(ski, place, side), [
        left,
        oy,
        ski.span * px,
        ski.length * px,
      ]),
    );
    drawOver(ski, { decals, uploads }, targets, reuse);
    lefts.forEach((left, side) =>
      ctx.drawImage(
        windowOf(ski, side),
        left,
        oy,
        ski.span * px,
        ski.length * px,
      ),
    );
    ctx.restore();

    for (const path of paths) skiEdge(ctx, path, px);
    marks(ski).forEach((mark, i) =>
      drawMark(ctx, mark, centers[i], oy, px, {
        fill: ink.marks[i],
        outline: ink.outlines[i],
      }),
    );
    if (bindings) for (const cx of centers) drawBinding(ctx, ski, cx, oy, px);

    if (guide !== null) {
      ctx.save();
      ctx.strokeStyle = COLORS.crimson;
      ctx.lineWidth = k;
      ctx.setLineDash([4 * k, 4 * k]);
      ctx.beginPath();
      const x = ox + guide * px;
      ctx.moveTo(x, oy);
      ctx.lineTo(x, oy + ski.length * px);
      ctx.stroke();
      ctx.restore();
    }

    if (chosen) {
      const handled = handledAnchor(chosen);
      for (const anchor of anchorsOf(chosen)) {
        const { corners, stalk, turn } = handlesOf(chosen, anchor, layoutNow);
        const dev = (p: { x: number; y: number }) =>
          [p.x * k, p.y * k] as const;
        ctx.save();
        ctx.strokeStyle = COLORS.crimson;
        ctx.lineWidth = (anchor === handled ? 1.5 : 1) * k;
        ctx.beginPath();
        corners.forEach((corner, i) =>
          i ? ctx.lineTo(...dev(corner)) : ctx.moveTo(...dev(corner)),
        );
        ctx.closePath();
        if (anchor !== handled) {
          ctx.stroke();
          ctx.restore();
          continue;
        }
        ctx.moveTo(...dev(stalk));
        ctx.lineTo(...dev(turn));
        ctx.stroke();
        ctx.fillStyle = COLORS.white;
        for (const point of [...corners, turn]) {
          ctx.beginPath();
          ctx.arc(...dev(point), HANDLE * k, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    placeToolbar(layoutNow);
  }

  // The tools in a column beside the picked picture's copy that has the
  // handles, and out of the way while it moves: to its right, or to its
  // left where that's off the edge or over its copy on the other ski. They
  // stay inside the area's padding, clear of the buttons round its edge.
  function placeToolbar(now: ReturnType<typeof layout>) {
    const chosen = selected !== null ? scene?.uploads[selected] : undefined;
    toolbar.hidden = !chosen || !!gesture;
    if (!chosen || gesture) return;
    const anchors = anchorsOf(chosen);
    const anchor = handledAnchor(chosen, now) ?? anchors[0];
    const { corners, turn } = handlesOf(chosen, anchor, now);
    const points = [...corners, turn];
    const ys = points.map((p) => p.y);
    const xs = points.map((p) => p.x);
    const clear = REACH + 12;
    const { offsetHeight: h, offsetWidth: w } = toolbar;
    const { room } = now;
    const end = room.left + room.width - w;
    const right = Math.max(...xs) + clear;
    const left = Math.min(...xs) - clear - w;
    const twin = anchors.length > 1 && anchor === 0;
    const sides = twin ? [left, right] : [right, left];
    const x = sides.find((side) => side >= room.left && side <= end) ?? end;
    const middle = (Math.min(...ys) + Math.max(...ys)) / 2;
    const y = Math.min(
      Math.max(middle - h / 2, room.top),
      room.top + room.height - h,
    );
    Object.assign(toolbar.style, { left: `${x}px`, top: `${y}px` });
  }

  let wasZoomed = false;
  function noteZoom() {
    if (zoom > 1 === wasZoomed) return;
    wasZoomed = zoom > 1;
    on.zoomed(wasZoomed);
  }

  // Which copy of the picked image has handles: the one last touched, and
  // none while it's too small on screen for them to keep off each other;
  // two fingers or the wheel size it then.
  function handledAnchor(upload: PlacedUpload, now = layout()) {
    const { h, w } = sizeOf(upload);
    if (Math.min(w, h) * now.px < 2 * REACH) return null;
    const anchors = anchorsOf(upload);
    return anchors.includes(active) ? active : anchors[0];
  }

  const redraw = () => {
    noteZoom();
    frame ||= requestAnimationFrame(draw);
  };

  // What's under a pointer: a handle of the picked image, the topmost
  // image, or a decal still in its spot, and which of its copies.
  function hitTest(point: { x: number; y: number }) {
    if (!scene || !editing) return null;
    const { ski, uploads } = scene;
    const now = layout();
    const p = local(point);
    if (selected !== null) {
      const chosen = uploads[selected];
      const anchor = handledAnchor(chosen, now);
      if (anchor !== null) {
        const { corners, turn } = handlesOf(chosen, anchor, now);
        const distance = (q: { x: number; y: number }) =>
          Math.hypot(q.x - p.x, q.y - p.y);
        if (distance(turn) <= REACH) {
          return { anchor, index: selected, kind: "rotate" as const };
        }
        const nearest = corners.reduce((a, b) =>
          distance(b) < distance(a) ? b : a,
        );
        if (distance(nearest) <= REACH) {
          return {
            anchor,
            grip: GRIPS[corners.indexOf(nearest)],
            index: selected,
            kind: "scale" as const,
          };
        }
      }
    }
    const mm = { x: (p.x - now.ox) / now.px, y: (p.y - now.oy) / now.px };
    // Small images are easier to catch with a little room round them.
    const room = REACH / now.px;
    for (let i = uploads.length - 1; i >= 0; i--) {
      const upload = uploads[i];
      const { h, w } = sizeOf(upload);
      for (const anchor of anchorsOf(upload)) {
        const copy = copyOf(ski, upload, anchor);
        if (hits(copy, Math.max(w, room), Math.max(h, room), mm.x, mm.y)) {
          return { anchor, index: i, kind: "move" as const };
        }
      }
    }
    for (const decal of [...(scene.decals ?? [])].reverse()) {
      const { height, width } = decal.image;
      const freed = {
        ...freeDecal(ski, decal, width, height),
        image: decal.image,
      };
      for (const anchor of anchorsOf(freed)) {
        const copy = copyOf(ski, freed, anchor);
        if (hits(copy, freed.w, heightOf(freed), mm.x, mm.y)) {
          return { anchor, decal, freed, kind: "decal" as const };
        }
      }
    }
    return null;
  }

  // A decal in its spot taken out of it, to the bottom of the images, so it
  // can move.
  function free(hit: { decal: Placed; freed: PlacedUpload }) {
    scene!.decals = scene!.decals!.filter((each) => each !== hit.decal);
    scene!.uploads = [hit.freed, ...scene!.uploads];
    if (selected !== null) selected++;
    edited = true;
    return 0;
  }

  function pick(index: number | null) {
    if (index === selected) return;
    selected = index;
    on.select(index);
    // At once, as nothing's drawn while another view's on show.
    if (index === null) toolbar.hidden = true;
    redraw();
  }

  function clampPan() {
    if (!scene) return;
    const { fit, room } = layout();
    const ski = scene.ski;
    // Zoomed in, the edges can come in a little from the sides.
    const extra = zoom > 1 ? 0.3 : 0;
    const spare = (size: number, space: number) =>
      Math.max(0, (size * fit * zoom - space) / 2 + space * extra);
    const sx = spare(2 * ski.span + GAP, room.width);
    const sy = spare(ski.length, room.height);
    pan = {
      x: Math.min(sx, Math.max(-sx, pan.x)),
      y: Math.min(sy, Math.max(-sy, pan.y)),
    };
  }

  // Zooms to a level, keeping the point at p (CSS pixels on the area) put.
  function zoomAt(p: { x: number; y: number }, next: number) {
    if (!scene) return;
    next = Math.min(MAX_ZOOM, Math.max(1, next));
    const before = layout();
    const ratio = next / zoom;
    zoom = next;
    pan = { x: 0, y: 0 };
    const base = layout();
    pan = {
      x: p.x - (p.x - before.ox) * ratio - base.ox,
      y: p.y - (p.y - before.oy) * ratio - base.oy,
    };
    clampPan();
    redraw();
  }

  function changeChosen(next: PlacedUpload) {
    if (!scene || selected === null) return;
    scene.uploads = scene.uploads.map((upload, i) =>
      i === selected ? next : upload,
    );
    edited = true;
    live = true;
    redraw();
  }

  function settle() {
    guide = null;
    live = false;
    if (!scene || !edited) return redraw();
    edited = false;
    const { ski } = scene;
    scene.uploads = scene.uploads.map((upload) => reanchor(ski, upload));
    on.change(scene.uploads);
    redraw();
  }

  // The image moved by (dx, dy) mm on the copy being dragged.
  function moved(anchor: number, dx: number, dy: number) {
    const from = start.upload!;
    const ski = scene!.ski;
    const { mirrored } = copyOf(ski, from, anchor);
    let x = from.x + (mirrored ? -dx : dx);
    guide = null;
    const snap = SNAP / layout().px;
    if (Math.abs(x) < snap) {
      x = 0;
      guide = skiCenter(ski, anchor);
    }
    return { ...from, x, y: from.y + dy / ski.length };
  }

  const turnTo = (r: number) => {
    let turned = ((((r + 180) % 360) + 360) % 360) - 180;
    const square = Math.round(turned / 90) * 90;
    if (Math.abs(turned - square) < SNAP_TURN) turned = square;
    return turned === -180 ? 180 : turned;
  };

  const sizeTo = (w: number) =>
    Math.min(4 * scene!.ski.length, Math.max(MIN_WIDTH, w));

  // The image sized by its corner pulled (dx, dy) mm on the copy it's on,
  // keeping its shape. The corner across from it stays where it is, or the
  // middle does.
  function sized(
    { anchor, grip: [sx, sy] }: Extract<Gesture, { kind: "scale" }>,
    dx: number,
    dy: number,
    centered: boolean,
  ) {
    const from = start.upload!;
    const ski = scene!.ski;
    const copy = copyOf(ski, from, anchor);
    const angle = (copy.r * Math.PI) / 180;
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    // To the corner from the one across, along the image's own sides.
    const { h, w } = sizeOf(from);
    const [across, down] = [sx * w, sy * h];
    // How far the pull goes along that line, as a share of it, or of half
    // of it from the middle.
    const pull =
      ((dx * cos + dy * sin) * across + (dy * cos - dx * sin) * down) /
      (across ** 2 + down ** 2);
    const next = sizeTo(from.w * (1 + pull * (centered ? 2 : 1)));
    if (centered) return { ...from, w: next };
    // The middle goes half as far as the corner.
    const half = (next / from.w - 1) / 2;
    const mx = half * (across * cos - down * sin);
    const my = half * (across * sin + down * cos);
    return {
      ...from,
      w: next,
      x: from.x + (copy.mirrored ? -mx : mx),
      y: from.y + my / ski.length,
    };
  }

  function begin() {
    const chosen = selected !== null ? scene?.uploads[selected] : undefined;
    start = {
      pan: { ...pan },
      points: [...pointers.values()].map((p) => ({ ...p })),
      upload: chosen && { ...chosen },
      zoom,
    };
  }

  area.addEventListener("pointerdown", (event) => {
    if (!scene) return;
    area.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      const hit = hitTest({ x: event.clientX, y: event.clientY });
      if (hit) {
        active = hit.anchor;
        pick(hit.kind === "decal" ? free(hit) : hit.index);
        gesture =
          hit.kind === "scale"
            ? { anchor: hit.anchor, grip: hit.grip, kind: "scale" }
            : {
                anchor: hit.anchor,
                kind: hit.kind === "decal" ? "move" : hit.kind,
              };
      } else {
        gesture = { kind: "pan", moved: false };
      }
    } else if (pointers.size === 2) {
      // Two fingers work the image the first was on, or else the view.
      gesture = { kind: gesture?.kind === "move" ? "pinch" : "zoom" };
    }
    begin();
  });

  area.addEventListener("pointermove", (event) => {
    const point = pointers.get(event.pointerId);
    if (!point || !scene || !gesture) return;
    point.x = event.clientX;
    point.y = event.clientY;
    const now = [...pointers.values()];
    const [first] = start.points;
    const ski = scene.ski;

    if (gesture.kind === "pan") {
      const dx = point.x - first.x;
      const dy = point.y - first.y;
      if (Math.hypot(dx, dy) > 4) gesture.moved = true;
      pan = { x: start.pan.x + dx, y: start.pan.y + dy };
      clampPan();
      redraw();
      return;
    }

    if (gesture.kind === "pinch" || gesture.kind === "zoom") {
      if (now.length < 2 || start.points.length < 2) return;
      const [a0, b0] = start.points;
      const [a1, b1] = now;
      const ratio =
        Math.hypot(a1.x - b1.x, a1.y - b1.y) /
        Math.max(1, Math.hypot(a0.x - b0.x, a0.y - b0.y));
      const mid0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
      const mid1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
      if (gesture.kind === "zoom" || !start.upload) {
        zoom = start.zoom;
        pan = { ...start.pan };
        zoomAt(local(mid0), start.zoom * ratio);
        pan = {
          x: pan.x + mid1.x - mid0.x,
          y: pan.y + mid1.y - mid0.y,
        };
        clampPan();
        redraw();
        return;
      }
      const twist =
        (Math.atan2(b1.y - a1.y, b1.x - a1.x) -
          Math.atan2(b0.y - a0.y, b0.x - a0.x)) *
        (180 / Math.PI);
      const from = start.upload;
      const { mirrored } = copyOf(ski, from, active);
      const m0 = toMm(mid0);
      const m1 = toMm(mid1);
      changeChosen({
        ...moved(active, m1.x - m0.x, m1.y - m0.y),
        r: turnTo(from.r + (mirrored ? -twist : twist)),
        w: sizeTo(from.w * ratio),
      });
      return;
    }

    const from = start.upload;
    if (!from || !("anchor" in gesture)) return;
    const copy = copyOf(ski, from, gesture.anchor);
    const m0 = toMm(first);
    const m1 = toMm(point);
    if (gesture.kind === "move") {
      changeChosen(moved(gesture.anchor, m1.x - m0.x, m1.y - m0.y));
    } else if (gesture.kind === "scale") {
      changeChosen(sized(gesture, m1.x - m0.x, m1.y - m0.y, event.altKey));
    } else {
      const a0 = Math.atan2(m0.y - copy.cy, m0.x - copy.cx);
      const a1 = Math.atan2(m1.y - copy.cy, m1.x - copy.cx);
      const turn = ((a1 - a0) * 180) / Math.PI;
      changeChosen({
        ...from,
        r: turnTo(from.r + (copy.mirrored ? -turn : turn)),
      });
    }
  });

  const release = (event: PointerEvent) => {
    if (!pointers.delete(event.pointerId)) return;
    if (pointers.size) {
      // A finger lifted mid-pinch: carry on from where the other is.
      if (gesture?.kind === "pinch" && selected !== null) {
        gesture = { anchor: active, kind: "move" };
      } else if (gesture?.kind === "zoom") {
        gesture = { kind: "pan", moved: true };
      }
      begin();
      return;
    }
    // A tap off every image lets go of the picked one.
    if (gesture?.kind === "pan" && !gesture.moved) pick(null);
    gesture = undefined;
    settle();
  };
  area.addEventListener("pointerup", release);
  area.addEventListener("pointercancel", release);

  // The wheel sizes the picked image when it's over it, and otherwise
  // zooms the view.
  let wheeling = 0;
  area.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (!scene) return;
      const point = { x: event.clientX, y: event.clientY };
      const hit = hitTest(point);
      if (hit && hit.kind !== "decal" && hit.index === selected) {
        const chosen = scene.uploads[hit.index];
        if (event.shiftKey) {
          const turn = (event.deltaY || event.deltaX) > 0 ? 3 : -3;
          changeChosen({ ...chosen, r: turnTo(chosen.r + turn) });
        } else {
          changeChosen({ ...chosen, w: sizeTo(chosen.w * wheelZoom(event)) });
        }
        clearTimeout(wheeling);
        wheeling = setTimeout(settle, 300);
        return;
      }
      zoomAt(local(point), zoom * wheelZoom(event));
    },
    { passive: false },
  );

  area.addEventListener("dblclick", (event) => {
    if (hitTest({ x: event.clientX, y: event.clientY })) return;
    if (zoom > 1) resetView();
    else zoomAt(local({ x: event.clientX, y: event.clientY }), 3);
  });

  let keying = 0;
  area.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Escape") return pick(null);
    if (!scene || selected === null) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      return on.remove(selected);
    }
    const chosen = scene.uploads[selected];
    const mm = event.shiftKey ? 10 : 1;
    const turn = event.shiftKey ? 15 : 5;
    const changes: Record<string, () => PlacedUpload> = {
      "+": () => ({ ...chosen, w: sizeTo(chosen.w * 1.05) }),
      "-": () => ({ ...chosen, w: sizeTo(chosen.w / 1.05) }),
      "=": () => ({ ...chosen, w: sizeTo(chosen.w * 1.05) }),
      "[": () => ({ ...chosen, r: turnTo(chosen.r - turn) }),
      "]": () => ({ ...chosen, r: turnTo(chosen.r + turn) }),
      ArrowDown: () => ({ ...chosen, y: chosen.y + mm / scene!.ski.length }),
      ArrowLeft: () => ({ ...chosen, x: chosen.x - mm }),
      ArrowRight: () => ({ ...chosen, x: chosen.x + mm }),
      ArrowUp: () => ({ ...chosen, y: chosen.y - mm / scene!.ski.length }),
    };
    const change = changes[event.key];
    if (!change) return;
    event.preventDefault();
    changeChosen(change());
    clearTimeout(keying);
    keying = setTimeout(settle, 400);
  });

  function resetView() {
    zoom = 1;
    pan = { x: 0, y: 0 };
    redraw();
  }

  new ResizeObserver(redraw).observe(area);

  return {
    // Shows the pair with its images, keeping the view and the pick, and
    // rising into place when it's newly shown.
    show(next: Scene, rise = false) {
      scene = { ...next, uploads: [...next.uploads] };
      if (rise) canvas.classList.add("animate-rise");
      if (selected !== null && selected >= scene.uploads.length)
        selected = null;
      if (canvas.parentElement !== area) area.replaceChildren(canvas);
      clampPan();
      redraw();
    },
    // Lets pictures be picked and moved, or not, letting go of the picked.
    edit(on: boolean) {
      editing = on;
      if (!on) pick(null);
    },
    // Picks an image and zooms to show it well.
    focus(index: number) {
      if (!scene) return;
      pick(index);
      const upload = scene.uploads[index];
      const { fit } = layout();
      const { h, w } = sizeOf(upload);
      active = anchorsOf(upload)[0];
      const copy = copyOf(scene.ski, upload, active);
      // Zoomed in only as far as makes it easy to handle, so the pair
      // round it still shows.
      zoom = Math.min(MAX_ZOOM, Math.max(1, FOCUS / (Math.max(w, h) * fit)));
      const ski = scene.ski;
      pan = {
        x: -(copy.cx - (2 * ski.span + GAP) / 2) * fit * zoom,
        y: -(copy.cy - ski.length / 2) * fit * zoom,
      };
      clampPan();
      redraw();
    },
    resetView,
    // Picks an image, or none, leaving the view as it is.
    select: pick,
    // The copy last touched: 0 on the left ski, 1 on the right.
    get active() {
      return active;
    },
    get selected() {
      return selected;
    },
  };
}

// Each ski's window, with Oregon on the one that has it, drawn once at a
// good size and scaled.
const windows = new Map<string, HTMLCanvasElement>();
function windowOf(ski: Ski, side: number) {
  const key = `${ski.id}:${side}`;
  if (!windows.has(key)) {
    const canvas = sheet(ski, 3072);
    addWindow(ski, canvas, side);
    windows.set(key, canvas);
  }
  return windows.get(key)!;
}
