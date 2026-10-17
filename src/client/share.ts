import type { GalleryStatus } from "./api";

export interface Share {
  url: string;
  // The link preview, rendered on demand.
  preview: () => Promise<HTMLCanvasElement>;
  // Only for designs made in this browser.
  gallery?: (show?: boolean) => Promise<GalleryStatus>;
}

const html = String.raw;

const CHECK = `<svg viewBox="0 0 16 16" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>`;

const NOTES: Record<GalleryStatus, string> = {
  hidden: "We kept this one out of the gallery.",
  off: "We'll take a look first. Only this browser can take it off again.",
  pending:
    "We'll take a look before it shows. Only this browser can take it off.",
  shown: "It's in the gallery. Only this browser can take it off.",
};

let dialog: HTMLDialogElement | undefined;
// Earlier shares never open or change the sheet.
let opened = 0;

// A sheet with the link and its preview, the same on every device. It waits
// up to a second for the gallery row, so nothing shifts once it's open.
export async function share(item: Share) {
  dialog ??= create();
  const $ = <T extends Element>(selector: string) =>
    dialog!.querySelector<T>(selector)!;
  const open = ++opened;

  $<HTMLInputElement>("[data-url]").value = item.url;
  $("[data-copy]").textContent = "Copy";

  const frame = $("[data-preview]");
  frame.replaceChildren();
  item.preview().then((canvas) => {
    canvas.className = "block h-auto w-full";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Link preview");
    frame.replaceChildren(canvas);
  });

  await showGallery($, item.gallery, open);
  if (open === opened) dialog.showModal();
}

function create() {
  document.body.insertAdjacentHTML(
    "beforeend",
    html`
      <dialog
        class="text-ink open:animate-rise m-0 mt-auto w-full max-w-none overflow-visible bg-transparent p-0 sm:m-auto sm:max-w-lg"
        aria-labelledby="share-title"
      >
        <div
          autofocus
          tabindex="-1"
          class="bg-paper pb-safe-6 relative rounded-t-4xl p-6 shadow-2xl outline-none sm:rounded-4xl sm:p-8"
        >
          <button
            type="button"
            data-close
            class="icon-btn absolute top-4 right-4"
            aria-label="Close"
          >
            <svg
              viewBox="0 0 24 24"
              class="size-4.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>

          <h2 id="share-title" class="heading-2">Share your pair</h2>

          <div
            data-preview
            class="bg-snow ring-line aspect-card mt-6 overflow-hidden rounded-2xl ring-1"
          ></div>

          <div class="mt-5 flex gap-2">
            <input
              data-url
              readonly
              aria-label="Link"
              class="field text-fine min-w-0 flex-1 font-mono"
            />
            <button type="button" data-copy class="btn-ink w-24 px-0">
              Copy
            </button>
          </div>

          <div
            data-gallery
            hidden
            class="border-line -mx-6 mt-6 flex items-center gap-4 border-t px-6 pt-6 sm:-mx-8 sm:px-8"
          >
            <div class="min-w-0 flex-1">
              <p class="text-body font-medium">
                Show it in the <a href="/gallery" class="underline">gallery</a>
              </p>
              <p
                data-gallery-note
                class="text-muted text-fine mt-1 max-w-64 text-balance"
                aria-live="polite"
              ></p>
            </div>
            <button
              type="button"
              data-gallery-toggle
              aria-pressed="false"
              class="btn-ghost btn-sm w-28 shrink-0 px-0"
            ></button>
          </div>
        </div>
      </dialog>
    `,
  );

  const element = document.body.lastElementChild as HTMLDialogElement;
  const input = element.querySelector<HTMLInputElement>("[data-url]")!;
  const copy = element.querySelector("[data-copy]")!;

  element.addEventListener("click", (event) => {
    const target = event.target as Element;
    if (target === element || target.closest("[data-close]")) element.close();
  });
  input.addEventListener("focus", () => input.select());
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      input.select();
      document.execCommand("copy");
    }
    copy.textContent = "Copied";
  });

  return element;
}

// Gallery changes save in order, and a later sheet reads after them.
let saving = Promise.resolve();

async function showGallery(
  $: <T extends Element>(selector: string) => T,
  gallery: Share["gallery"],
  open: number,
) {
  const row = $<HTMLElement>("[data-gallery]");
  const note = $<HTMLElement>("[data-gallery-note]");
  const toggle = $<HTMLButtonElement>("[data-gallery-toggle]");
  row.hidden = true;
  if (!gallery) return;

  // Adding an approved design shows it again; otherwise it awaits a look.
  let saved: GalleryStatus;
  let addsTo: GalleryStatus = "pending";
  let changes = 0;

  const show = (status: GalleryStatus) => {
    if (open !== opened) return;
    const added = status === "pending" || status === "shown";
    if (added) addsTo = status;
    toggle.innerHTML = added ? `${CHECK}Added` : "Add";
    toggle.setAttribute("aria-pressed", String(added));
    toggle.disabled = status === "hidden";
    toggle.onclick = () => change(!added);
    note.textContent = NOTES[status];
    row.hidden = false;
  };

  // Shows the change at once; only the latest one's answer is shown.
  const change = (add: boolean) => {
    const at = ++changes;
    show(add ? addsTo : "off");
    saving = saving.then(async () => {
      try {
        saved = await gallery(add);
        if (at === changes) show(saved);
      } catch {
        if (at !== changes) return;
        show(saved);
        note.textContent = "That didn't save. Try again.";
      }
    });
  };

  let waiting = true;
  const read = saving
    .then(() => gallery())
    .then((status) => {
      saved = status;
      if (waiting) show(status);
    })
    .catch(() => {});
  await Promise.race([read, new Promise((done) => setTimeout(done, 1000))]);
  waiting = false;
}
