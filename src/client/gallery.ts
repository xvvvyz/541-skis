import { $, drawLogos } from "./dom";
import type { Frame } from "./frame";
import { loadImage } from "./image";
import { DEFAULT_SKI, GAP, SKIS } from "./ski";
import { cutPair, dashedPair, fillHeight, type Ink } from "./topsheet";

drawLogos();

const SKI = SKIS[DEFAULT_SKI];

const grid = $("[data-gallery]");
const row = $("[data-row]");
const status = $("[data-status]");
const more = $<HTMLButtonElement>("[data-more]");
const end = $("[data-end]");
let next: number | null = null;

type Pair = { id: string; ink?: Ink; frame?: Frame };

// Cut one pair a frame as they near the screen, so scrolling stays smooth.
const waiting: (Pair & { slot: HTMLElement })[] = [];
let cutting = false;

async function cutWaiting() {
  if (cutting) return;
  cutting = true;
  for (let item = waiting.shift(); item; item = waiting.shift()) {
    try {
      const image = await loadImage(`/thumb/${item.id}`);
      const pair = cutPair(SKI, image, fillHeight(item.slot), item);
      pair.className = "pair-fill animate-rise";
      item.slot.replaceChildren(pair);
    } catch (cause) {
      console.error("couldn't show", item.id, cause);
    }
    await new Promise(requestAnimationFrame);
  }
  cutting = false;
}

const pending = new Map<HTMLElement, Pair>();

function check() {
  for (const [slot, pair] of pending) {
    const { left, right } = slot.getBoundingClientRect();
    if (left > innerWidth + 400 || right < -400) continue;
    pending.delete(slot);
    waiting.push({ ...pair, slot });
  }
  cutWaiting();
  const end = row.getBoundingClientRect().right;
  if (next !== null && !more.disabled && end < innerWidth + 800) loadPage();
}

let checking = 0;
function schedule() {
  checking ||= requestAnimationFrame(() => {
    checking = 0;
    check();
  });
}

function pairLink(href: string, label: string) {
  const link = document.createElement("a");
  link.href = href;
  link.className = "group flex-none";
  link.setAttribute("aria-label", label);
  const slot = document.createElement("div");
  slot.className =
    "relative h-[calc(100cqh-2*var(--row-pad))] transition duration-500 group-hover:-translate-y-2";
  // The pair's own width, so its skis meet the row's edges and gaps.
  slot.style.aspectRatio = `${2 * SKI.span + GAP} / ${SKI.length}`;
  link.append(slot);
  return { link, slot };
}

function addPair(pair: Pair) {
  const { link, slot } = pairLink(
    `/d/${pair.id}`,
    "Open this design in the studio",
  );
  pending.set(slot, pair);
  more.before(link);
}

// After the last design, a blank pair to start one's own.
function showEnd() {
  const { link, slot } = pairLink(
    `/design?ski=${SKI.id}`,
    "Start a blank design in the studio",
  );
  end.before(link);
  end.hidden = false;
  const pair = dashedPair(SKI, fillHeight(slot), 1.5 * devicePixelRatio);
  pair.className = "pair-fill animate-rise opacity-40";
  slot.append(pair);
}

async function loadPage() {
  more.disabled = true;
  try {
    const url = next ? `/api/gallery?before=${next}` : "/api/gallery";
    const response = await fetch(url);
    if (!response.ok) throw new Error(String(response.status));
    const page = (await response.json()) as {
      designs: Pair[];
      next: number | null;
    };
    page.designs.forEach(addPair);
    next = page.next;
    if (next === null) showEnd();
    status.textContent = "";
  } catch {
    status.textContent = "Couldn't load the gallery. Try again in a moment.";
  } finally {
    more.disabled = false;
    more.hidden = next === null;
    schedule();
  }
}

// With a mouse or trackpad, the page scrolls down and the row slides along
// with it (slide-with-page); by touch, the row scrolls itself.
const paging = matchMedia("(pointer: fine)");
const driven = CSS.supports("animation-timeline: scroll()");

// The page is as much taller than the screen as the row is wider.
function measure() {
  const distance = Math.max(0, row.offsetWidth - grid.clientWidth);
  document.body.style.setProperty("--distance", `${distance}px`);
  schedule();
}
const resizing = new ResizeObserver(measure);
resizing.observe(row);
resizing.observe(grid);

// Pairs passing under the pointer don't lift while the row moves.
let settling = 0;
function scrolled() {
  if (!settling) row.style.pointerEvents = "none";
  clearTimeout(settling);
  settling = setTimeout(() => {
    row.style.pointerEvents = "";
    settling = 0;
  }, 150);
  if (paging.matches && !driven) row.style.translate = `${-scrollY}px 0`;
  schedule();
}
addEventListener("scroll", scrolled, { passive: true });
grid.addEventListener("scroll", scrolled, { passive: true });

// A sideways swipe slides the row too, without holding up scrolling.
addEventListener(
  "wheel",
  (event) => {
    // Some browsers leave a shift-wheel's turn in deltaY rather than deltaX.
    const [x, y] =
      event.shiftKey && !event.deltaX
        ? [event.deltaY, 0]
        : [event.deltaX, event.deltaY];
    if (!paging.matches || Math.abs(x) <= Math.abs(y)) return;
    const lines = event.deltaMode === 1 ? 16 : 1;
    scrollBy({ behavior: "instant", top: x * lines });
  },
  { passive: true },
);

grid.addEventListener("focusin", (event) => {
  if (!paging.matches) return;
  const { left, right, width } = (
    event.target as Element
  ).getBoundingClientRect();
  if (left < 0 || right > innerWidth) {
    scrollBy({ top: left - (innerWidth - width) / 2 });
  }
});

more.addEventListener("click", loadPage);
loadPage();
