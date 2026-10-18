import { post, type GalleryStatus } from "./api";
import { $, drawLogos } from "./dom";
import { loadImage } from "./image";
import { SKIS } from "./ski";
import { cutPair, fillHeight, type Ink } from "./topsheet";

drawLogos();

const [, id, token] =
  location.pathname.match(/^\/review\/([\w-]{16})\/([\w-]{16})$/) ?? [];

const STANDING: Record<GalleryStatus, string> = {
  hidden: "Kept out of the gallery.",
  off: "Its maker took it off the gallery.",
  pending: "",
  shown:
    'In the <a href="/gallery" class="hover:text-ink underline">gallery</a>.',
};

async function send(approve?: boolean) {
  const result = await post(`/api/designs/${id}/review`, { approve, token });
  return result as { ink?: Ink; status: GalleryStatus };
}

function show(status: GalleryStatus) {
  $("[data-details]").hidden = false;
  $("[data-standing]").innerHTML = STANDING[status];
  for (const button of document.querySelectorAll<HTMLElement>(
    "[data-approve]",
  )) {
    button.hidden =
      button.dataset.approve === "true"
        ? status === "shown" || status === "off"
        : status === "hidden";
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-approve]",
)) {
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      show((await send(button.dataset.approve === "true")).status);
      $("[data-error]").textContent = "";
    } catch {
      $("[data-error]").textContent = "That didn't go through. Try again?";
    } finally {
      button.disabled = false;
    }
  });
}

if (id) {
  $<HTMLAnchorElement>("[data-open]").href = `/d/${id}`;
  const slot = $("[data-pair]");
  const review = send();
  review.then(
    ({ status }) => show(status),
    () => ($("[data-error]").textContent = "This review link doesn't work."),
  );
  Promise.all([loadImage(`/thumb/${id}`), review])
    .then(([image, { ink }]) => {
      const pair = cutPair(SKIS["185"], image, fillHeight(slot), ink);
      pair.className = "pair-fill";
      slot.replaceChildren(pair);
    })
    .catch(() => {});
} else {
  $("[data-error]").textContent = "This review link doesn't work.";
}
