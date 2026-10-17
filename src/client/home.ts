import { openOrder } from "./order";
import { LOGO } from "./logo";
import { RAVEN } from "./raven";
import { PRICE, SKIS, type SkiId } from "./ski";
import { startRack } from "./rack";
import { blankArt, cutPair, fillHeight } from "./topsheet";

for (const path of document.querySelectorAll("[data-logo]")) {
  path.setAttribute("d", LOGO);
}
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
    openOrder({
      price: PRICE,
      ski: `${ski.id} cm, plain black`,
      thumbnail: pairs.get(ski.id)?.toDataURL(),
      title: ski.id,
    }),
  );
}

startRack(document.querySelector<HTMLElement>("[data-rack]")!);
