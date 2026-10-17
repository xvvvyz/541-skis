import { loadImage } from "./image";
import { LOGO } from "./logo";
import { SKIS } from "./ski";
import { cutPair, fillHeight, type Ink } from "./topsheet";

for (const path of document.querySelectorAll("[data-logo]")) {
  path.setAttribute("d", LOGO);
}

const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

const grid = $("[data-gallery]");
const status = $("[data-status]");
const more = $<HTMLButtonElement>("[data-more]");
let next: number | null = null;

// Cut one pair a frame as they near the screen, so scrolling stays smooth.
type Pair = { id: string; ink?: Ink };

const waiting: (Pair & { slot: HTMLElement })[] = [];
let cutting = false;

async function cutWaiting() {
  if (cutting) return;
  cutting = true;
  for (let item = waiting.shift(); item; item = waiting.shift()) {
    try {
      const image = await loadImage(`/thumb/${item.id}`);
      const pair = cutPair(SKIS["185"], image, fillHeight(item.slot), item.ink);
      pair.className = "pair-fill animate-rise";
      item.slot.replaceChildren(pair);
    } catch (cause) {
      console.error("couldn't show", item.id, cause);
    }
    await new Promise(requestAnimationFrame);
  }
  cutting = false;
}

const pairs = new Map<Element, Pair>();

const nearing = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const slot = entry.target as HTMLElement;
      nearing.unobserve(slot);
      waiting.push({ ...pairs.get(slot)!, slot });
    }
    cutWaiting();
  },
  { rootMargin: "400px 0px" },
);

function addPair(pair: Pair) {
  const link = document.createElement("a");
  link.href = `/d/${pair.id}`;
  link.className = "group";
  link.setAttribute("aria-label", "Open this design in the studio");
  const slot = document.createElement("div");
  slot.className =
    "aspect-pair-185 relative h-64 transition duration-500 group-hover:-translate-y-2 sm:h-80";
  pairs.set(slot, pair);
  link.append(slot);
  grid.append(link);
  nearing.observe(slot);
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
    status.textContent = "";
  } catch {
    status.textContent = "Couldn't load the gallery. Try again in a moment.";
  } finally {
    more.disabled = false;
    more.hidden = next === null;
  }
}

more.addEventListener("click", loadPage);
loadPage();
