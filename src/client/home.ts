import { drawLogos } from "./dom";
import { openOrder, stockOrder } from "./order";
import { startRack } from "./rack";
import { RAVEN } from "./raven";
import { SKIS, type SkiId } from "./ski";
import { blankArt, cutPair, fillHeight } from "./topsheet";

drawLogos();
for (const path of document.querySelectorAll("[data-raven]")) {
  path.setAttribute("d", RAVEN);
}

// The stock pairs: plain black, cut to each model's shape.

const pairs = new Map<SkiId, HTMLCanvasElement>();

for (const slot of document.querySelectorAll<HTMLElement>("[data-pair]")) {
  const ski = SKIS[slot.dataset.pair as SkiId];
  const pair = cutPair(ski, blankArt(), fillHeight(slot));
  pair.className = "pair-fill";
  slot.replaceChildren(pair);
  pairs.set(ski.id, pair);
}

// Buying a stock pair just collects an email.

for (const button of document.querySelectorAll<HTMLElement>("[data-buy]")) {
  const ski = SKIS[button.dataset.buy as SkiId];
  button.addEventListener("click", () =>
    openOrder(stockOrder(ski, pairs.get(ski.id)?.toDataURL())),
  );
}

startRack(document.querySelector<HTMLElement>("[data-rack]")!);
