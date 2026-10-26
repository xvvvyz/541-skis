import { drawLogos } from "./dom";
import { openOrder, stockOrder } from "./order";
import { startRack } from "./rack";
import { RAVEN } from "./raven";
import { SKIS, type Ski, type SkiId } from "./ski";
import { blankArt, cutPair, fillHeight } from "./topsheet";

drawLogos();
for (const path of document.querySelectorAll("[data-raven]")) {
  path.setAttribute("d", RAVEN);
}

const pairs = new Map<SkiId, HTMLCanvasElement>();

function showPair(slot: HTMLElement, ski: Ski) {
  let pair = pairs.get(ski.id);
  if (!pair) {
    pair = cutPair(ski, blankArt(), fillHeight(slot));
    pair.className = "pair-fill";
    pairs.set(ski.id, pair);
  }
  slot.replaceChildren(pair);
}

for (const slot of document.querySelectorAll<HTMLElement>("[data-pair]")) {
  showPair(slot, SKIS[slot.dataset.pair as SkiId]);
}

// The 193 comes in two shapes, and its card shows one at a time.

for (const button of document.querySelectorAll<HTMLElement>("[data-shape]")) {
  button.addEventListener("click", () => {
    const ski = SKIS[button.dataset.shape as SkiId];
    const card = button.closest("article")!;
    const find = (selector: string) =>
      card.querySelector<HTMLElement>(selector)!;
    const slot = find("[data-pair]");
    slot.setAttribute("aria-label", `A plain black pair of ${ski.size} skis`);
    showPair(slot, ski);
    find("[data-dims]").textContent = `${ski.tip}/${ski.waist}/${ski.tail}`;
    find("[data-radius]").textContent = `${ski.radius} m`;
    find("[data-customize]").setAttribute("href", `/design?ski=${ski.id}`);
    find("[data-buy]").dataset.buy = ski.id;
    for (const each of card.querySelectorAll("[data-shape]")) {
      each.setAttribute("aria-pressed", String(each === button));
    }
  });
}

// Buying a stock pair just collects an email.

for (const button of document.querySelectorAll<HTMLElement>("[data-buy]")) {
  button.addEventListener("click", () => {
    const ski = SKIS[button.dataset.buy as SkiId];
    openOrder(stockOrder(ski, pairs.get(ski.id)?.toDataURL()));
  });
}

startRack(document.querySelector<HTMLElement>("[data-rack]")!);
