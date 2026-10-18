// A sideways-scrolling row of pills that keeps the pressed one centered, so
// tapping the next one over steps through them, as do the arrow keys.

type Way = "back" | "next";

const KEYS: Partial<Record<string, Way>> = {
  ArrowLeft: "back",
  ArrowRight: "next",
};

export const wayOf = (event: KeyboardEvent) =>
  event.altKey || event.ctrlKey || event.metaKey ? undefined : KEYS[event.key];

export function pillRow(row: HTMLElement) {
  const pressed = () => {
    const pills = [...row.children] as HTMLElement[];
    return {
      at: pills.findIndex((pill) => pill.ariaPressed === "true"),
      pills,
    };
  };

  // Keys step from the focused pill, as a row may have none pressed.
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

  // How far the row can scroll each way, which sizes the fades.
  function fade() {
    const rest = row.scrollWidth - row.clientWidth - row.scrollLeft;
    row.style.setProperty("--before", `${row.scrollLeft}px`);
    row.style.setProperty("--after", `${Math.max(0, rest)}px`);
  }
  row.addEventListener("scroll", fade, { passive: true });

  let shown = false;
  function update() {
    const { at, pills } = pressed();
    const first = row.firstElementChild as HTMLElement | null;
    const last = row.lastElementChild as HTMLElement | null;
    if (first && last && row.clientWidth) {
      const pad = parseFloat(getComputedStyle(row).paddingLeft);
      const span = last.offsetLeft + last.offsetWidth - first.offsetLeft;
      const pill = pills[at];
      // Pills that don't fill the row slide along it instead of scrolling.
      const spare = Math.max(0, row.clientWidth - 2 * pad - span);
      const middle = pill
        ? row.clientWidth / 2 -
          pad -
          (pill.offsetLeft - first.offsetLeft + pill.offsetWidth / 2)
        : 0;
      const slide = Math.min(spare, Math.max(0, middle));
      row.style.setProperty("--start", `${slide}px`);
      row.style.setProperty("--end", `${pad + spare - slide}px`);
      // Measured from the row's start, so a scroll under way can't skew it.
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
    fade();
  }

  // Pills resize when their font loads.
  document.fonts.ready.then(update);
  new ResizeObserver(update).observe(row);

  return {
    show(pills: HTMLElement[]) {
      row.replaceChildren(...pills);
      update();
    },
    step,
    update,
  };
}
