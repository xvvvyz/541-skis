// A row of pills that scrolls sideways, one of them pressed, with arrows at
// its ends that step to the previous or next pill, as do the left and right
// arrow keys. The pressed one is centered, as far as the row's ends allow.

const ARROWS = {
  back: { label: "Previous", path: "M10 3.5 5.5 8l4.5 4.5", side: "left-0" },
  next: { label: "Next", path: "M6 3.5 10.5 8 6 12.5", side: "right-0" },
};

type Way = keyof typeof ARROWS;

const KEYS: Partial<Record<string, Way>> = {
  ArrowLeft: "back",
  ArrowRight: "next",
};

// The way an arrow key steps, unless it's part of a shortcut.
export const wayOf = (event: KeyboardEvent) =>
  event.altKey || event.ctrlKey || event.metaKey ? undefined : KEYS[event.key];

// The row sits in a positioned box that holds its arrows.
export function pillRow(row: HTMLElement, name: string) {
  const pressed = () => {
    const pills = [...row.children] as HTMLElement[];
    return {
      at: pills.findIndex((pill) => pill.ariaPressed === "true"),
      pills,
    };
  };

  const [back, next] = (["back", "next"] as const).map((way) => {
    const { label, path, side } = ARROWS[way];
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = true;
    button.className = `page-btn ${side}`;
    button.setAttribute("aria-label", `${label} ${name}`);
    button.innerHTML = `<svg viewBox="0 0 16 16" class="size-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
    button.addEventListener("click", () => step(way));
    return button;
  });
  row.after(back, next);

  // From the focused pill, for keys, as a row may have none pressed.
  function step(way: Way, from?: HTMLElement) {
    const { at, pills } = pressed();
    const i = from ? pills.indexOf(from) : at;
    const pill = pills[way === "next" ? i + 1 : i - 1];
    pill?.click();
    return pill;
  }

  row.addEventListener("keydown", (event) => {
    const way = wayOf(event);
    const from = event.target as HTMLElement;
    if (!way || from.parentElement !== row) return;
    event.preventDefault();
    step(way, from)?.focus({ preventScroll: true });
  });

  // It jumps to the pressed pill the first time the row is on show, then
  // glides. With none pressed, it starts at the first.
  let shown = false;
  function update() {
    const { at, pills } = pressed();
    const first = row.firstElementChild as HTMLElement | null;
    const last = row.lastElementChild as HTMLElement | null;
    if (first && last && row.clientWidth) {
      const pad = parseFloat(getComputedStyle(row).paddingLeft);
      const span = last.offsetLeft + last.offsetWidth - first.offsetLeft;
      const pill = pills[at];
      // Room the pills leave in a row they don't fill. They slide along it
      // rather than scroll, so the pressed one comes to the middle, as far
      // as keeps them all clear of the arrows. The end spacer also stands
      // in for padding, which Safari leaves out of how far a row scrolls.
      const spare = Math.max(0, row.clientWidth - 2 * pad - span);
      const middle = pill
        ? row.clientWidth / 2 -
          pad -
          (pill.offsetLeft - first.offsetLeft + pill.offsetWidth / 2)
        : 0;
      const slide = Math.min(spare, Math.max(0, middle));
      row.style.setProperty("--start", `${slide}px`);
      row.style.setProperty("--end", `${pad + spare - slide}px`);
      // A row that scrolls centers the pressed pill, measured from the
      // row's start rather than where it has scrolled to, so a scroll still
      // under way can't throw it off.
      row.scrollTo({
        behavior: shown ? "smooth" : "instant",
        left:
          pill && !spare
            ? pill.offsetLeft + (pill.offsetWidth - row.clientWidth) / 2
            : 0,
      });
      if (shown) row.dataset.glide = "";
      shown = true;
    }
    back.disabled = at <= 0;
    next.disabled = at >= pills.length - 1;
  }

  // The pills change width when their font arrives, and the room at the
  // ends with the row's.
  document.fonts.ready.then(update);
  new ResizeObserver(() => update()).observe(row);

  return {
    show(pills: HTMLElement[]) {
      row.replaceChildren(...pills);
      update();
    },
    step,
    update,
  };
}
