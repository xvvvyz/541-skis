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
    ? "No payment today. Your design is an AI-generated preview, so Jesse will review it and confirm the final artwork with you, along with sizing, timing and shipping, before your skis are built."
    : "No payment today. Leave your email and Jesse will reach out personally to sort out sizing, timing and shipping.";
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
}

function create() {
  document.body.insertAdjacentHTML(
    "beforeend",
    html`
      <dialog
        class="text-ink open:animate-rise m-0 mt-auto w-full max-w-none overflow-visible bg-transparent p-0 sm:m-auto sm:max-w-md"
        aria-labelledby="order-title"
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
      const response = await fetch("/api/order", {
        body: JSON.stringify({
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
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error);

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
