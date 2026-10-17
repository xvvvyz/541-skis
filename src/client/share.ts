export interface Share {
  url: string;
  // The link preview, rendered on demand.
  preview: () => Promise<HTMLCanvasElement>;
}

const html = String.raw;

let dialog: HTMLDialogElement | undefined;

// A sheet with the link and its preview, the same on every device.
export function share(item: Share) {
  dialog ??= create();
  const $ = <T extends Element>(selector: string) =>
    dialog!.querySelector<T>(selector)!;

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

  dialog.showModal();
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
          <p class="text-muted text-body mt-2">
            Anyone with the link can see it in 3D.
          </p>

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
