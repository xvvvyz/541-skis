import { post } from "./api";
import { PRICE, type Ski } from "./ski";

export interface Order {
  title: string;
  ski: string;
  price?: string;
  // Custom designs are previews; the shop confirms the artwork before building.
  custom?: boolean;
  thumbnail?: string;
  prompt?: string;
  // Changes applied to the design after its prompt, in order.
  edits?: string[];
  // The saved design's id, so the email can link to it.
  design?: string;
  // For a custom pair's print file: the model, and the colour of each
  // ski's mark and its outline, if any, as the preview chose them.
  model?: string;
  marks?: string[];
  outlines?: string[];
  // Images to send along with a custom design, built only on submit.
  attachments?: () => Promise<{ art?: string; preview?: string }>;
}

// A plain black pair: no design, so just the length.
export const stockOrder = (ski: Ski, thumbnail?: string): Order => ({
  price: PRICE,
  ski: `${ski.id} cm, plain black`,
  thumbnail,
  title: ski.id,
});

const html = String.raw;

let dialog: HTMLDialogElement | undefined;
let current: Order | undefined;

export function openOrder(order: Order) {
  dialog ??= create();
  current = order;

  const $ = <T extends Element>(selector: string) =>
    dialog!.querySelector<T>(selector)!;

  $("[data-title]").textContent = order.title;
  $("[data-intro]").textContent = order.custom
    ? "No payment today. Jesse will confirm the final artwork, sizing and shipping with you before building your pair."
    : "No payment today. Jesse will reach out personally to sort out sizing and shipping.";
  const price = $<HTMLElement>("[data-price]");
  price.hidden = !order.price;
  price.textContent = order.price ?? "";
  const thumb = $<HTMLImageElement>("[data-thumb]");
  thumb.hidden = !order.thumbnail;
  if (order.thumbnail) thumb.src = order.thumbnail;
  $("[data-head]").removeAttribute("hidden");
  $("[data-form]").removeAttribute("hidden");
  $("[data-done]").setAttribute("hidden", "");
  $("[data-error]").textContent = "";
  dialog.showModal();
  release = hold();
}

let release: (() => void) | undefined;

// While the sheet is open. iOS scrolls the page to a field taking focus,
// sheet and all, so the page is fixed in place and scrolled back if it
// moves anyway.
function hold() {
  const { body } = document;
  const { scrollX: x, scrollY: y } = window;
  const saved = body.style.cssText;
  Object.assign(body.style, {
    position: "fixed",
    top: `-${y}px`,
    left: `-${x}px`,
    right: "0",
    width: "100%",
    overflow: "hidden",
    overscrollBehavior: "none",
  });

  let frame = 0;
  const pin = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() =>
      scrollTo({ left: 0, top: 0, behavior: "instant" }),
    );
  };

  baseline = 0;
  addEventListener("scroll", pin, { passive: true });
  addEventListener("resize", fit);
  visualViewport?.addEventListener("resize", reveal);
  visualViewport?.addEventListener("scroll", fit);
  fit();

  return () => {
    removeEventListener("scroll", pin);
    removeEventListener("resize", fit);
    visualViewport?.removeEventListener("resize", reveal);
    visualViewport?.removeEventListener("scroll", fit);
    cancelAnimationFrame(frame);
    body.style.cssText = saved;
    scrollTo({ left: x, top: y, behavior: "instant" });
  };
}

// Less than this is the toolbar settling, not a keyboard.
const MIN_KEYBOARD = 80;

// The page's height without a keyboard, the tallest seen at this width, as
// iOS can shorten it while the keyboard is up.
let baseline = 0;
let baselineWidth = 0;

const typing = () => {
  const field = document.activeElement;
  return !!field?.matches("input, textarea") && !!dialog?.contains(field);
};

// Keeps the sheet above the on-screen keyboard and within the space it
// leaves, which iOS doesn't take from the page's height.
function fit() {
  const view = visualViewport;
  if (!view || !dialog) return;
  if (innerWidth !== baselineWidth) baseline = 0;
  baselineWidth = innerWidth;
  baseline = Math.max(baseline, innerHeight);
  const open = typing();
  const keyboard = open ? baseline - view.offsetTop - view.height : 0;
  dialog.style.setProperty(
    "--keyboard",
    `${keyboard >= MIN_KEYBOARD ? Math.round(keyboard) : 0}px`,
  );
  if (open) dialog.style.setProperty("--view", `${view.height}px`);
  else dialog.style.removeProperty("--view");
}

// Scrolls the sheet alone to the field, where scrollIntoView would scroll
// the page too.
function reveal() {
  fit();
  const field = document.activeElement;
  const card = dialog?.firstElementChild;
  if (!field || !card?.contains(field)) return;
  const room = card.getBoundingClientRect();
  const box = field.getBoundingClientRect();
  const margin = 16;
  if (box.bottom + margin > room.bottom) {
    card.scrollTop += box.bottom + margin - room.bottom;
  } else if (box.top - margin < room.top) {
    card.scrollTop -= room.top - box.top + margin;
  }
}

function create() {
  document.body.insertAdjacentHTML(
    "beforeend",
    html`
      <!-- Paper below the sheet, for when it lags the keyboard. -->
      <dialog
        class="text-ink open:animate-rise max-sm:after:bg-paper m-0 mt-auto mb-(--keyboard) max-h-none w-full max-w-none overflow-visible bg-transparent p-0 max-sm:after:absolute max-sm:after:inset-x-0 max-sm:after:top-full max-sm:after:h-32 sm:m-auto sm:max-w-md"
        aria-labelledby="order-title"
      >
        <div
          autofocus
          tabindex="-1"
          class="bg-paper pb-safe-6 relative max-h-[calc(min(100dvh,var(--view,100dvh))-max(--spacing(8),env(safe-area-inset-top)))] overflow-y-auto overscroll-contain rounded-t-4xl p-6 shadow-2xl outline-none sm:rounded-4xl sm:p-8"
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

          <div data-head class="flex items-center gap-4 pr-10">
            <img data-thumb alt="" class="h-24 w-auto shrink-0" />
            <div>
              <h2 id="order-title" data-title class="heading-2"></h2>
              <p data-price class="text-muted text-fine mt-2 font-mono"></p>
            </div>
          </div>

          <form data-form class="mt-6" novalidate>
            <p
              data-intro
              class="text-muted text-body leading-relaxed text-pretty"
            ></p>
            <label class="mt-5 block">
              <span class="label">Name</span>
              <input
                name="name"
                type="text"
                required
                autocapitalize="words"
                maxlength="100"
                autocomplete="name"
                placeholder="Your name"
                class="field"
              />
            </label>
            <label class="mt-4 block">
              <span class="label">Email</span>
              <input
                name="email"
                type="email"
                required
                autocomplete="email"
                inputmode="email"
                placeholder="you@example.com"
                class="field"
              />
            </label>
            <label class="mt-4 block">
              <span class="label">Anything we should know?</span>
              <textarea
                name="note"
                rows="2"
                maxlength="2000"
                placeholder="Height, weight, where you ski…"
                class="field resize-none"
              ></textarea>
            </label>
            <p
              data-error
              class="text-crimson text-fine mt-3 min-h-5 text-center text-balance"
              role="alert"
            ></p>
            <button type="submit" class="btn-primary mt-2 w-full">
              <span data-label>Request my pair</span>
            </button>
          </form>

          <div data-done hidden class="py-6 text-center">
            <div
              class="bg-crimson mx-auto grid size-14 place-items-center rounded-full text-white"
            >
              <svg
                viewBox="0 0 24 24"
                class="size-7"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </div>
            <h3 class="heading-2 mt-5">You're on the list</h3>
            <p class="text-muted text-body mx-auto mt-2 max-w-xs text-balance">
              We'll be in touch at
              <span data-email class="text-ink"></span> soon.
            </p>
            <button type="button" data-close class="btn-ghost mt-6">
              Done
            </button>
          </div>
        </div>
      </dialog>
    `,
  );

  const element = document.body.lastElementChild as HTMLDialogElement;
  const form = element.querySelector("form")!;
  const errorText = element.querySelector("[data-error]")!;
  const submit = form.querySelector("button")!;
  const label = form.querySelector("[data-label]")!;

  element.addEventListener("close", () => {
    release?.();
    release = undefined;
  });

  // Tapping another field with the keyboard up focuses it here, before iOS
  // can scroll the page to it.
  let tap: { field: HTMLElement; x: number; y: number } | undefined;
  element.addEventListener("focusin", reveal);
  element.addEventListener(
    "touchstart",
    (event) => {
      const field = (event.target as Element).closest("label")?.control;
      const [touch] = event.touches;
      tap =
        event.touches.length === 1 && field && typing()
          ? { field, x: touch.clientX, y: touch.clientY }
          : undefined;
    },
    { passive: true },
  );
  element.addEventListener(
    "touchmove",
    (event) => {
      const [touch] = event.touches;
      if (tap && Math.hypot(touch.clientX - tap.x, touch.clientY - tap.y) > 16)
        tap = undefined;
    },
    { passive: true },
  );
  element.addEventListener("touchend", () => {
    if (tap && tap.field !== document.activeElement)
      tap.field.focus({ preventScroll: true });
    tap = undefined;
  });

  element.addEventListener("click", (event) => {
    const target = event.target as Element;
    if (target === element || target.closest("[data-close]")) element.close();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const order = current!;
    const data = new FormData(form);
    const name = String(data.get("name")).trim();
    const email = String(data.get("email")).trim();

    if (!name) {
      errorText.textContent = "Enter your name so we know who's asking.";
      form.querySelector<HTMLInputElement>("[name=name]")!.focus();
      return;
    }
    if (!form.email.checkValidity() || !email) {
      errorText.textContent = "Enter an email so we can reach you.";
      form.email.focus();
      return;
    }

    errorText.textContent = "";
    submit.disabled = true;
    label.textContent = "Requesting…";

    try {
      await post("/api/order", {
        ...(await order.attachments?.()),
        name,
        email,
        note: String(data.get("note") ?? ""),
        prompt: order.prompt,
        edits: order.edits,
        design: order.design,
        marks: order.marks,
        model: order.model,
        outlines: order.outlines,
        ski: order.ski,
      });

      element.querySelector("[data-email]")!.textContent = email;
      // The thank-you stands on its own, without the pair and price.
      element.querySelector("[data-head]")!.setAttribute("hidden", "");
      form.setAttribute("hidden", "");
      form.reset();
      element.querySelector("[data-done]")!.removeAttribute("hidden");
    } catch (error) {
      errorText.textContent =
        (error as Error).message || "Something went wrong. Try again?";
    } finally {
      submit.disabled = false;
      label.textContent = "Request my pair";
    }
  });

  return element;
}
