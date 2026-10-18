import { post, type GalleryStatus } from "./api";
import { $, drawLogos } from "./dom";
import type { Frame } from "./frame";
import { loadImage } from "./image";
import { SKIS } from "./ski";
import { cutPair, fillHeight, type Ink } from "./topsheet";

drawLogos();

const [, id, token] =
  location.pathname.match(/^\/review\/([\w-]{16})\/([\w-]{16})$/) ?? [];

const error = $("[data-error]");
const buttons = document.querySelectorAll<HTMLButtonElement>("[data-approve]");

const STANDING: Record<GalleryStatus, string> = {
  hidden: "Kept out of the gallery.",
  off: "Its maker took it off the gallery.",
  pending: "",
  shown:
    'In the <a href="/gallery" class="hover:text-ink underline">gallery</a>.',
};

async function send(approve?: boolean) {
  const result = await post(`/api/designs/${id}/review`, { approve, token });
  return result as { frame?: Frame; ink?: Ink; status: GalleryStatus };
}

function show(status: GalleryStatus) {
  $("[data-details]").hidden = false;
  $("[data-standing]").innerHTML = STANDING[status];
  for (const button of buttons) {
    button.hidden =
      button.dataset.approve === "true"
        ? status === "shown" || status === "off"
        : status === "hidden";
  }
}

for (const button of buttons) {
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      show((await send(button.dataset.approve === "true")).status);
      error.textContent = "";
    } catch {
      error.textContent = "That didn't go through. Try again?";
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
    () => (error.textContent = "This review link doesn't work."),
  );
  Promise.all([loadImage(`/thumb/${id}`), review])
    .then(([image, { frame, ink }]) => {
      const pair = cutPair(SKIS["185"], image, fillHeight(slot), {
        frame,
        ink,
      });
      pair.className = "pair-fill";
      slot.replaceChildren(pair);
    })
    .catch(() => {});
} else {
  error.textContent = "This review link doesn't work.";
}
