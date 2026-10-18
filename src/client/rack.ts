import { copyCanvas, loadImage } from "./image";
import { PRESETS } from "./presets";
import { SKIS } from "./ski";
import { cutPair, fillHeight } from "./topsheet";

// The hero's rack: every example pair, each opening in the studio. It drifts
// left on its own and scrolls by hand (or by dragging, with a mouse). The
// list runs three times, and the scroll position stays within the middle
// copy, so it loops either way without a seam; the copies are hidden from
// screen readers and the keyboard.
const COPIES = 3;
const LOOP = PRESETS.length * 6_000; // ms for the drift to pass one copy

export function startRack(rack: HTMLElement) {
  const scroller = rack.parentElement!;

  const slots = PRESETS.map(() => [] as HTMLElement[]);

  for (let copy = 0; copy < COPIES; copy++) {
    PRESETS.forEach((preset, i) => {
      const link = document.createElement("a");
      link.href = `/design?d=${preset.id}`;
      link.draggable = false;
      link.className =
        "group flex shrink-0 flex-col items-center gap-3 pr-8 sm:pr-12";
      if (copy) {
        link.setAttribute("aria-hidden", "true");
        link.tabIndex = -1;
      } else {
        link.setAttribute(
          "aria-label",
          `Open “${preset.label}” in the design studio`,
        );
      }
      link.innerHTML = `
        <div class="aspect-pair-185 relative h-64 transition duration-500 group-hover:-translate-y-2 sm:h-96"></div>
        <span class="eyebrow group-hover:text-ink transition">${preset.label}</span>`;
      rack.append(link);
      slots[i].push(link.firstElementChild as HTMLElement);
    });
  }

  // One cut a frame, in rack order, so the first pairs on screen come first
  // and the drift stays smooth while the rest are cut.
  const pairHeight = fillHeight(slots[0][0]);
  const nextFrame = () => new Promise((done) => requestAnimationFrame(done));
  const images = PRESETS.map((preset) => loadImage(preset.thumbnail));

  (async () => {
    for (const [i, preset] of PRESETS.entries()) {
      try {
        const flat = cutPair(SKIS["185"], await images[i], pairHeight, {
          frame: preset.frame,
        });
        slots[i].forEach((slot, copy) => {
          const canvas = copy ? copyCanvas(flat) : flat;
          canvas.className = "pair-fill";
          slot.replaceChildren(canvas);
        });
      } catch (cause) {
        console.error("couldn't show", preset.id, cause);
      }
      await nextFrame();
    }
  })();

  const still = matchMedia("(prefers-reduced-motion: reduce)");
  let pos = 0; // the scroll position, kept to fractions of a pixel
  let set = -1; // the last whole position written, to tell our scrolls apart
  let resting = 0; // the drift waits until then after a manual scroll
  let hovered = false;
  let onScreen = true;

  const copyWidth = () => rack.scrollWidth / COPIES;

  function wrap() {
    const width = copyWidth();
    if (!width) return;
    while (pos < width) pos += width;
    while (pos >= 2 * width) pos -= width;
  }

  // Scrolls to the whole pixel and shifts the rest with a transform, so a
  // slow drift stays smooth.
  function show() {
    const whole = Math.floor(pos);
    if (whole !== set) scroller.scrollLeft = set = whole;
    rack.style.translate = `${whole - pos}px 0`;
  }

  scroller.addEventListener("scroll", () => {
    if (scroller.scrollLeft === set) return;
    pos = scroller.scrollLeft;
    resting = performance.now() + 2000;
    wrap();
    show();
  });

  scroller.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") hovered = true;
  });
  scroller.addEventListener("pointerleave", () => (hovered = false));
  scroller.addEventListener("focusin", () => (hovered = true));
  scroller.addEventListener("focusout", () => (hovered = false));
  new IntersectionObserver(
    ([entry]) => (onScreen = entry.isIntersecting),
  ).observe(scroller);

  // Dragging with a mouse; a drag doesn't open the pair it started on.
  let drag: { x: number; from: number; moved: boolean } | null = null;

  scroller.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    drag = { from: pos, moved: false, x: event.clientX };
  });
  addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    if (Math.abs(dx) > 4) drag.moved = true;
    if (!drag.moved) return;
    pos = drag.from - dx;
    resting = performance.now() + 2000;
    wrap();
    show();
  });
  // The click, if any, comes straight after the pointer lifts.
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  addEventListener("pointerup", () => {
    if (drag?.moved) {
      scroller.addEventListener("click", swallow, { capture: true });
      setTimeout(() =>
        scroller.removeEventListener("click", swallow, { capture: true }),
      );
    }
    drag = null;
  });

  let last = performance.now();
  requestAnimationFrame(function frame(now) {
    const elapsed = Math.min(now - last, 100);
    last = now;
    const width = copyWidth();
    if (width && onScreen) {
      if (pos === 0) pos = width;
      if (!hovered && !drag && now > resting && !still.matches) {
        pos += (width / LOOP) * elapsed;
      }
      wrap();
      show();
    }
    requestAnimationFrame(frame);
  });
}
