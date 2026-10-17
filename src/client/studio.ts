import {
  getDesign,
  requestDesign,
  saveCard,
  setGallery,
  type DesignRequest,
} from "./api";
import { designCard } from "./card";
import { contentBox } from "./box";
import { cleanArt, guideFlaws, layoutGuide } from "./guide";
import { copyCanvas, loadBitmap, toJpeg, withBitmap } from "./image";
import { loadLibrary, saveToLibrary, type Design } from "./library";
import { LOGO } from "./logo";
import { openOrder } from "./order";
import { stopPageZoom } from "./pagezoom";
import { pillRow } from "./pills";
import { PRESETS } from "./presets";
import { CHANGES, IDEAS, STYLES, styleOf, toggleStyle } from "./prompts";
import { share } from "./share";
import {
  DEFAULT_SKI,
  LARGEST,
  PRICE,
  SKIS,
  skiId,
  type Ski,
  type SkiId,
} from "./ski";
import {
  artTopsheets,
  blankArt,
  cutPair,
  dashedPair,
  PAD,
  renderFlat,
  STUDIO_HEIGHT,
  type Topsheets,
} from "./topsheet";
import { latest, recall, remember, versions } from "./versions";
import { SkiViewer } from "./viewer";
import { zoomable } from "./zoom";

const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

// Marks which of a set of buttons is selected.
function press(selector: string, selected: (element: HTMLElement) => boolean) {
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    element.setAttribute("aria-pressed", String(selected(element)));
  }
}

// Lets the browser paint a click before the heavy work that follows it.
const nextFrame = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => setTimeout(resolve, 0)),
  );

for (const path of document.querySelectorAll("[data-logo]")) {
  path.setAttribute("d", LOGO);
}

// The page never zooms, only the skis do, on gestures of their own.
stopPageZoom("[data-viewer], [data-flat]");

const viewer = new SkiViewer($("[data-viewer]"), { autoRotate: true });
const form = $<HTMLFormElement>("[data-form]");
const textarea = form.querySelector("textarea")!;
const errorText = $("[data-error]");
const editForm = $<HTMLFormElement>("[data-edit]");
const change = editForm.querySelector("input")!;
const editError = $("[data-edit-error]");
const flat = $("[data-flat]");
const flatZoom = zoomable(flat, uncover);
const loading = $("[data-loading]");

const params = new URLSearchParams(location.search);
const shared = location.pathname.match(/^\/d\/([\w-]{16})$/)?.[1];
const requested = params.get("d");

// The length last picked here. Storage can be unavailable.
const LENGTH = "541-length";
function lastLength() {
  try {
    return localStorage.getItem(LENGTH);
  } catch {
    return null;
  }
}

// The length on show, from the link, else the last picked, except for a
// link to a design, which opens as shared. Opening a design keeps it.
let ski: Ski =
  SKIS[skiId(params.get("ski") ?? (shared || requested ? null : lastLength()))];
let mode: "3d" | "flat" = "3d";
let bindings = false;
let design: (Design & { image: ImageBitmap }) | undefined;
let sheets: Topsheets | undefined;
let library: Design[] = [];

// The plain black pair, shown until there is a design. It can be ordered
// as is.
const blank = blankArt();

// Showing a design

function markSelected(id?: string) {
  press("[data-preset]", (pill) => pill.dataset.preset === (id ?? ""));
  press("[data-version]", (pill) => pill.dataset.version === id);
  // A design's tile shows its latest version, and stands for all of them.
  const item = id ? recall(id) : undefined;
  const chain = new Set(item ? versions(item).map((other) => other.id) : []);
  press("[data-design]", (tile) => chain.has(tile.dataset.design!));
  markBlank(id);
  updateRows();
}

// Centers each row's pressed pill and sets its arrows.
function updateRows() {
  for (const row of [examples, styleRow, versionRow, libraryRow]) {
    row.update();
  }
}

// The latest pick. An earlier one that finishes loading after it is dropped,
// so quick clicks end on the last one made.
let picked = 0;

async function select(next?: Design) {
  // Show the click straight away, before the design has loaded.
  markSelected(next?.id);
  const pick = ++picked;
  await nextFrame();
  // Saved art arrives straight from the model; clean it once.
  if (next?.src.startsWith("/art/")) next.src = await cleanArt(next.src);
  const image = next && (await loadBitmap(next.src));
  if (pick !== picked) {
    image?.close();
    return;
  }
  design = next && image && { ...next, image };
  $("[data-refine]").hidden = !design;
  window.history.replaceState(null, "", link(design));
  render();
  renderVersions();
  markSelected(design?.id);
  if (design) loadAncestors(design);
}

// Saved designs have their own page; examples open by name. The length on
// show goes along, so the link opens to what's on screen. Blank always names
// it, as a bare /design opens the latest design.
function link(item?: Design) {
  const url = new URL(item?.saved ? `/d/${item.id}` : "/design", location.href);
  if (item && !item.saved) url.searchParams.set("d", item.id);
  if (!item || ski.id !== DEFAULT_SKI) url.searchParams.set("ski", ski.id);
  return url.pathname + url.search;
}

// Shows a design's prompt in the box, ready to generate a variation.
function showPrompt(item?: Design) {
  textarea.value = item?.prompt ?? "";
  markStyle();
}

function describe(item: Design) {
  return [item.prompt, ...(item.edits ?? [])].join(" → ");
}

function presetDesign(id: string): Design {
  const preset = PRESETS.find((p) => p.id === id) ?? PRESETS[0];
  return { created: 0, id: preset.id, prompt: preset.prompt, src: preset.art };
}

// A design by id: one seen already, an example, or one saved on the server.
async function findDesign(id: string) {
  const seen = recall(id);
  if (seen) return seen;
  if (PRESETS.some((preset) => preset.id === id)) {
    return remember(presetDesign(id));
  }
  const saved = await getDesign(id);
  return saved && remember(saved);
}

// Cut topsheets for the last few designs and skis, so switching back is
// instant. Few, as each pair takes about 10 MB at the studio's resolution.
const cut = new Map<string, Topsheets>();

function render() {
  const key = `${design?.id ?? ""}:${ski.id}`;
  if (!cut.has(key)) {
    if (cut.size > 6) cut.delete(cut.keys().next().value!);
    cut.set(key, artTopsheets(ski, design?.image ?? blank, STUDIO_HEIGHT));
  }
  sheets = cut.get(key)!;
  viewer.setSki(ski);
  viewer.setTopsheets(sheets);
  // Loading shows only on the empty stage. Later designs load behind the
  // pair on show.
  loading.remove();
  if (mode === "flat") renderFlatView();
}

// The flat pair rises into place as the view opens, and is redrawn in place
// after, for a new design or size, or when the area's height changes.
let flatHeight = 0;
function renderFlatView(rise = false) {
  flatHeight = flat.clientHeight;
  if (!sheets || !flatHeight) return;
  // The biggest pair fits the room inside the padding, which keeps clear of
  // the controls over it, and shorter ones are drawn to the same scale.
  const fit = (contentBox(flat).height * ski.length) / LARGEST.length;
  // Drawn at the topsheets' own resolution, so zooming in stays sharp.
  const height = Math.max(fit * devicePixelRatio, sheets[0].height);
  const canvas = renderFlat(ski, sheets, Math.round(height), { bindings });
  canvas.style.height = `${fit}px`;
  if (rise) canvas.className = "animate-rise";
  canvas.setAttribute("role", "img");
  canvas.setAttribute(
    "aria-label",
    `Your design cut to the ${ski.id} cm shape`,
  );
  flat.replaceChildren(canvas);
  flatZoom.show(canvas, fit * PAD);
}

new ResizeObserver(() => {
  if (mode === "flat" && flat.clientHeight !== flatHeight) renderFlatView();
}).observe(flat);

// The skis draw over the stage's controls. One they cover lets pointers
// through, so a drag that starts on it moves the skis.
const controls = document.querySelectorAll<HTMLElement>("[data-control]");
let uncovering = 0;
function uncover() {
  uncovering ||= requestAnimationFrame(() => {
    uncovering = 0;
    for (const control of controls) {
      const box = control.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const covered = mode === "flat" ? flatCovers(x, y) : viewer.covers(x, y);
      control.style.pointerEvents = covered ? "none" : "";
    }
  });
}
viewer.onDraw = uncover;

function flatCovers(x: number, y: number) {
  const canvas = flat.querySelector("canvas");
  const box = canvas?.getBoundingClientRect();
  if (!canvas || !box) return false;
  if (x < box.left || x >= box.right || y < box.top || y >= box.bottom) {
    return false;
  }
  const [, , , alpha] = canvas
    .getContext("2d")!
    .getImageData(
      Math.floor(((x - box.left) / box.width) * canvas.width),
      Math.floor(((y - box.top) / box.height) * canvas.height),
      1,
      1,
    ).data;
  return alpha > 0;
}

// Versions

// A row like the examples', from the original to the latest change, once
// there's more than one. Changes after the one on show stay, dimmed.
const versionRow = pillRow($("[data-version-row]"), "version");

function renderVersions() {
  const chain = design ? versions(design) : [];
  const at = chain.findIndex((item) => item.id === design?.id);
  $("[data-versions]").hidden = chain.length < 2;
  versionRow.show(
    (chain.length > 1 ? chain : []).map((item, i) => {
      const text = item.edits?.at(-1) ?? "Original";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pill data-later:text-muted/60 max-w-48";
      button.dataset.version = item.id;
      if (i > at) button.dataset.later = "";
      button.setAttribute("aria-pressed", String(i === at));
      const label = document.createElement("span");
      label.className = "truncate";
      label.textContent = text;
      button.append(label);
      button.addEventListener("click", () => {
        if (item.id !== design?.id) select(item);
      });
      return button;
    }),
  );
}

// Fetches any earlier versions that aren't here yet, all the way back, then
// redraws. Ones that are here can still come from ones that aren't, like a
// saved change to an example.
async function loadAncestors(item: Design) {
  for (let id = item.parent; id;) {
    const parent = await findDesign(id);
    if (!parent) break;
    id = parent.parent;
  }
  renderVersions();
}

// Size, view and bindings.

function pickSki(id: SkiId) {
  ski = SKIS[id];
  $("[data-specs]").textContent =
    `${ski.tip}/${ski.waist}/${ski.tail} · ${ski.radius} m`;
  press("[data-ski]", (button) => button.dataset.ski === id);
}

for (const button of document.querySelectorAll<HTMLElement>("[data-ski]")) {
  button.addEventListener("click", async () => {
    pickSki(button.dataset.ski as SkiId);
    try {
      localStorage.setItem(LENGTH, ski.id);
    } catch {}
    window.history.replaceState(null, "", link(design));
    await nextFrame();
    render();
  });
}
// Known from the start and kept, so the buttons never change as it loads. A
// shared design's page comes with it marked already.
pickSki(ski.id);

function setMode(next: typeof mode) {
  mode = next;
  press("[data-mode]", (button) => button.dataset.mode === mode);
  for (const layer of document.querySelectorAll<HTMLElement>("[data-show]")) {
    layer.hidden = layer.dataset.show !== mode;
  }
  $("[data-drag]").textContent = mode === "flat" ? "pan" : "rotate";
  uncover();
}

for (const button of document.querySelectorAll<HTMLElement>("[data-mode]")) {
  button.addEventListener("click", () => {
    setMode(button.dataset.mode as typeof mode);
    if (mode === "flat") {
      flatZoom.reset();
      requestAnimationFrame(() => renderFlatView(true));
    } else {
      viewer.reset();
    }
  });
}

// Bindings preview the pair as it would be skied. Display only.
$("[data-bindings]").addEventListener("click", () => {
  bindings = !bindings;
  press("[data-bindings]", () => bindings);
  viewer.setBindings(bindings);
  if (mode === "flat") renderFlatView();
});

// Sharing

const cards = new Map<string, Promise<HTMLCanvasElement>>();

// The gallery's small copy, as wide as the examples' on the home page, and
// the marks' colours from the full art, which the small copy can't match.
function galleryCopy({ id, image }: Design & { image: ImageBitmap }) {
  const canvas = document.createElement("canvas");
  canvas.width = 132;
  canvas.height = Math.round((image.height * canvas.width) / image.width);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const sheets =
    cut.get(`${id}:${DEFAULT_SKI}`) ??
    artTopsheets(SKIS[DEFAULT_SKI], image, STUDIO_HEIGHT);
  return {
    ink: {
      marks: sheets.map((sheet) => sheet.dataset.ink!),
      outlines: sheets.map((sheet) => sheet.dataset.outline ?? ""),
    },
    thumbnail: canvas.toDataURL("image/jpeg", 0.85),
  };
}

function galleryToggle(item: Design & { image: ImageBitmap }) {
  const owner = item.owner;
  if (!owner) return undefined;
  return (show?: boolean) =>
    setGallery(item.id, owner, show, show ? galleryCopy(item) : undefined);
}

// The plain black pair shares too, as it can be ordered as is.
$("[data-share]").addEventListener("click", () => {
  const current = { design, ski };
  const key = `${design?.id ?? ""}:${ski.id}`;
  share({
    gallery: design && galleryToggle(design),
    preview: () => {
      if (!cards.has(key)) {
        cards.set(
          key,
          current.design
            ? designCard(current.ski, current.design.image)
            : designCard(current.ski, blank, "Black "),
        );
      }
      return cards.get(key)!;
    },
    url: new URL(link(design), location.origin).href,
  });
});

// Prompt and examples

textarea.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    form.requestSubmit();
  }
});

// Small chips that start blank or load an example and its prompt. With none
// selected, next starts at the first example.
const examples = pillRow($("[data-presets]"), "example", { start: 1 });
examples.show(
  [undefined, ...PRESETS].map((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pill";
    button.dataset.preset = preset?.id ?? "";
    button.textContent = preset?.label ?? "Blank";
    button.addEventListener("click", () => {
      const example = preset && remember(presetDesign(preset.id));
      showPrompt(example);
      select(example);
    });
    return button;
  }),
);

// Cycles an empty field's placeholder through examples, except for reduced
// motion.
function cycleHint(
  field: HTMLInputElement | HTMLTextAreaElement,
  hint: (example: string) => string,
  examples: string[],
) {
  let at = 0;
  const show = () => (field.placeholder = hint(examples[at]));
  show();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  setInterval(() => {
    if (field.value) return;
    at = (at + 1) % examples.length;
    show();
  }, 3500);
}

cycleHint(textarea, (idea) => `Describe your design, like:\n${idea}`, IDEAS);
cycleHint(change, (edit) => `Change it: “${edit}”`, CHANGES);

const styleRow = pillRow($("[data-styles]"), "style");
styleRow.show(
  STYLES.map((style) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pill gap-1.5 pl-3";
    button.dataset.style = style.label;
    button.innerHTML = `<svg viewBox="0 0 16 16" class="size-3.5 transition-transform in-aria-pressed:rotate-45" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>`;
    button.append(style.label);
    button.addEventListener("click", () => {
      textarea.value = toggleStyle(textarea.value, style);
      markStyle();
      // With no subject yet, the first line waits for one.
      if (textarea.value.startsWith("\n")) {
        textarea.focus();
        textarea.setSelectionRange(0, 0);
      }
    });
    return button;
  }),
);

function markStyle() {
  const style = styleOf(textarea.value);
  press("[data-style]", (pill) => pill.dataset.style === style?.label);
  styleRow.update();
}

textarea.addEventListener("input", markStyle);

// Generating

const busyMessages = [
  "Mixing the paint…",
  "Sketching it out…",
  "Laying up the topsheet…",
  "Pressing the layers…",
  "Trimming to shape…",
  "Almost there…",
];

const retryMessages = [
  "Tidying the edges…",
  "Pressing the layers…",
  "Trimming to shape…",
  "Almost there…",
];

// The progress bar can't know how far along the image model is, so it eases
// toward full: about 85% at the usual 20s, filling only once it's done.
const PACE = 10.5; // seconds

function busy(on: boolean, messages = busyMessages) {
  const overlay = $("[data-busy]");
  const progress = $("[data-progress]");
  for (const input of document.querySelectorAll<
    HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement
  >("[data-controls] :is(button, input, textarea)")) {
    input.disabled = on;
  }
  // Arrows with nowhere to go stay off.
  if (!on) updateRows();
  clearInterval(Number(overlay.dataset.timer));
  clearTimeout(Number(overlay.dataset.closing));
  if (!on) {
    // Fill the bar, then lift the overlay once it has.
    progress.style.scale = "1 1";
    overlay.dataset.closing = String(
      setTimeout(() => {
        overlay.hidden = true;
        progress.style.scale = "";
      }, 300),
    );
    return;
  }

  overlay.hidden = false;
  const started = Date.now();
  const tick = () => {
    const seconds = (Date.now() - started) / 1000;
    $("[data-elapsed]").textContent = String(Math.floor(seconds));
    $("[data-busy-text]").textContent =
      messages[Math.min(messages.length - 1, Math.floor(seconds / 4))];
    progress.style.scale = `${1 - Math.exp(-seconds / PACE)} 1`;
  };
  tick();
  overlay.dataset.timer = String(setInterval(tick, 250));
}

// Draws a new design from the prompt, or, given a change, edits the
// current one and keeps its history.
async function generate(edit?: string) {
  const editing = edit !== undefined;
  const prompt = editing ? edit : textarea.value.trim();
  const output = editing ? editError : errorText;
  if (!prompt) {
    output.textContent = editing
      ? "Describe what to change first."
      : "Describe your design first.";
    (editing ? change : textarea).focus();
    return;
  }
  if (editing && !design) return;

  errorText.textContent = "";
  editError.textContent = "";
  // Done typing: let the keyboard go, so the preview has the screen.
  (document.activeElement as HTMLElement | null)?.blur();
  busy(true);
  if (matchMedia("(max-width: 1023px)").matches) {
    $("[data-viewer]").parentElement!.scrollIntoView({ behavior: "smooth" });
  }

  try {
    const result = await draw(
      {
        guide: layoutGuide(ski).toDataURL("image/png"),
        parent: editing ? design?.id : undefined,
        prompt,
        ski: ski.id,
      },
      ski,
    );
    const next = remember(result.design);
    addToLibrary(next);
    showPrompt(next);
    await select(next);
    viewer.reset();
    uploadCard(next, result.cardToken);
  } catch (error) {
    output.textContent =
      error instanceof TypeError || !(error as Error).message
        ? "Something went wrong. Try again?"
        : (error as Error).message;
  } finally {
    busy(false);
    renderVersions();
  }
}

// Draws a design and cleans its art. A new design that copied the guide is
// drawn once more, keeping the better of the two. Edits keep their parent's
// layout, so another try rarely helps them.
async function draw(body: DesignRequest, on: Ski) {
  let result = await requestDesign(body);
  const flaws = body.parent ? 0 : await guideFlaws(result.design.src, on);
  if (flaws >= 1) {
    busy(true, retryMessages);
    try {
      const again = await requestDesign(body);
      if ((await guideFlaws(again.design.src, on)) < flaws) result = again;
    } catch {}
  }
  const src = await cleanArt(result.design.src);
  return { ...result, design: { ...result.design, src } };
}

// Saves the link previews for a new design, one for each length, so a link
// shows the length it opens at. In the background; without them, shared
// links fall back to a generic card.
async function uploadCard(item: Design, token: string) {
  try {
    const images: Record<string, string> = {};
    await withBitmap(item.src, async (image) => {
      for (const each of Object.values(SKIS)) {
        const card = await designCard(each, image);
        images[each.id] = card.toDataURL("image/jpeg", 0.88);
      }
    });
    await saveCard(item.id, token, images);
  } catch {}
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  generate();
});

// The box clears as soon as a change is applied, and gets it back if the
// change fails.
editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const edit = change.value.trim();
  if (edit) change.value = "";
  const before = design?.id;
  await generate(edit);
  if (edit && design?.id === before && !change.value) change.value = edit;
});

// Your designs: the latest version of each, newest first, in a row like
// the examples'.

const thumbnails = new Map<string, Promise<HTMLCanvasElement>>();

// The cards for your designs and the empty slots, narrow enough on a phone
// for four to fit between the arrows, and the pair drawn in each.
const CARD =
  "bg-chip hover:bg-chip-hover aria-pressed:ring-ink flex h-36 w-[min(4rem,calc((100%-5.5rem)/4))] shrink-0 cursor-pointer items-center justify-center rounded-2xl p-1.5 transition disabled-dim aria-pressed:ring-1";
const PAIR = "h-full w-auto max-w-full object-contain";
const libraryList = $("[data-library-row]");
const libraryRow = pillRow(libraryList, "design");

function addToLibrary(item: Design) {
  library = [item, ...library].slice(0, 60);
  saveToLibrary(item);
  renderLibrary();
}

function renderLibrary() {
  const tiles = latest(library);
  $("[data-library]").hidden = tiles.length === 0;
  libraryRow.show(
    tiles.map((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", `Show design: ${describe(item)}`);
      button.dataset.design = item.id;
      button.setAttribute("aria-pressed", "false");
      button.className = CARD;
      if (!thumbnails.has(item.id)) {
        thumbnails.set(
          item.id,
          withBitmap(item.src, (image) =>
            cutPair(SKIS[DEFAULT_SKI], image, 280),
          ),
        );
      }
      thumbnails.get(item.id)!.then((canvas) => {
        const copy = copyCanvas(canvas);
        copy.className = PAIR;
        button.replaceChildren(copy);
      });
      button.addEventListener("click", () => {
        showPrompt(item);
        select(item);
      });
      return button;
    }),
  );
  fillLibrary();
  markSelected(design?.id);
}

// Empty slots after your designs: at least one, and enough to make four
// cards or fill the row. Each starts a blank design and shows pressed
// while it's on show; blank picked another way presses the first.
const emptyPair = dashedPair(SKIS[DEFAULT_SKI], 280);
let blankSlot = 0;

function emptySlot(index: number) {
  const slot = document.createElement("button");
  slot.type = "button";
  slot.dataset.slot = "";
  slot.setAttribute("aria-label", "New blank design");
  slot.className = CARD;
  const pair = copyCanvas(emptyPair);
  pair.className = `${PAIR} opacity-40`;
  slot.append(pair);
  slot.addEventListener("click", () => {
    blankSlot = index;
    showPrompt();
    select();
  });
  return slot;
}

function markBlank(id?: string) {
  if (id) blankSlot = 0;
  const slots = libraryList.querySelectorAll("[data-slot]");
  const at = Math.min(blankSlot, slots.length - 1);
  slots.forEach((slot, i) => {
    slot.setAttribute("aria-pressed", String(!id && i === at));
  });
}

function fillLibrary() {
  for (const slot of libraryList.querySelectorAll("[data-slot]")) {
    slot.remove();
  }
  const style = getComputedStyle(libraryList);
  const gap = parseFloat(style.columnGap);
  const room =
    libraryList.clientWidth - 2 * parseFloat(style.paddingLeft) + gap;
  const slot = libraryList.appendChild(emptySlot(0));
  const cards = Math.max(4, Math.floor(room / (slot.offsetWidth + gap)));
  for (let i = 1; libraryList.childElementCount < cards; i++) {
    libraryList.append(emptySlot(i));
  }
  markBlank(design?.id);
  libraryRow.update();
}

new ResizeObserver(fillLibrary).observe(libraryList);

// Ordering

$("[data-order]").addEventListener("click", () => {
  if (!sheets) return;
  const thumbnail = renderFlat(ski, sheets, 400).toDataURL();
  if (!design) {
    openOrder({
      price: PRICE,
      ski: `${ski.id} cm, plain black`,
      thumbnail,
      title: ski.id,
    });
    return;
  }
  const current = { design, sheets, ski };
  openOrder({
    attachments: async () => ({
      art: current.design.src.startsWith("data:")
        ? current.design.src
        : await toJpeg(current.design.src),
      preview: renderFlat(current.ski, current.sheets, 1800).toDataURL(
        "image/jpeg",
        0.9,
      ),
    }),
    custom: true,
    design: current.design.saved ? current.design.id : undefined,
    edits: current.design.edits,
    marks: current.sheets.map((sheet) => sheet.dataset.ink!),
    outlines: current.sheets.map((sheet) => sheet.dataset.outline ?? ""),
    model: ski.id,
    price: PRICE,
    prompt: current.design.prompt,
    ski: `Custom ${ski.id} cm`,
    thumbnail,
    title: `Custom ${ski.id}`,
  });
});

// Start with a shared design, else the requested example, else the latest
// design, else blank. Customize from a ski's card starts that model blank.

library = await loadLibrary();
library.forEach(remember);
renderLibrary();
const start = shared
  ? await findDesign(shared)
  : requested
    ? presetDesign(requested)
    : params.has("ski")
      ? undefined
      : latest(library)[0];
showPrompt(start);
await select(start);
// A shared design joins your designs once its art is cleaned.
if (shared && start && !library.some((item) => item.id === start.id)) {
  addToLibrary({ ...start, added: Date.now() });
}
