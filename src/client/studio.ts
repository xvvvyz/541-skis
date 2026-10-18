import {
  getDesign,
  requestDesign,
  saveCard,
  saveFrame,
  setGallery,
} from "./api";
import { autosize } from "./autosize";
import { designCard } from "./card";
import { contentBox } from "./box";
import { $, drawLogos } from "./dom";
import { frameKey, type Frame } from "./frame";
import { cleanArt } from "./guide";
import { copyCanvas, loadBitmap, loadImage, withBitmap } from "./image";
import { loadLibrary, saveToLibrary, type Design } from "./library";
import { openOrder, stockOrder } from "./order";
import { stopPageZoom } from "./pagezoom";
import { pillRow, wayOf } from "./pills";
import { positioner } from "./position";
import { PRESETS, type Preset } from "./presets";
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
  cropArt,
  cutPair,
  dashedPair,
  inkOf,
  PAD,
  renderFlat,
  STUDIO_HEIGHT,
  type Topsheets,
} from "./topsheet";
import { latest, recall, remember, versions } from "./versions";
import { SkiViewer } from "./viewer";
import { zoomable } from "./zoom";

type Loaded = Design & { image: ImageBitmap };

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

drawLogos();
stopPageZoom("[data-viewer], [data-flat]");

const viewer = new SkiViewer($("[data-viewer]"), { autoRotate: true });
const form = $<HTMLFormElement>("[data-form]");
const textarea = form.querySelector("textarea")!;
autosize(textarea);
const errorText = $("[data-error]");
const editForm = $<HTMLFormElement>("[data-edit]");
const change = editForm.querySelector("input")!;
const editError = $("[data-edit-error]");
const flat = $("[data-flat]");
const flatZoom = zoomable(flat);
const cropper = positioner($("[data-crop]"), moved);
const loading = $("[data-loading]");

const params = new URLSearchParams(location.search);
const shared = location.pathname.match(/^\/d\/([\w-]{16})$/)?.[1];
const requested = params.get("d");

// Storage can be unavailable.
const LENGTH = "541-length";
function lastLength() {
  try {
    return localStorage.getItem(LENGTH);
  } catch {
    return null;
  }
}

// A link to a design leaves out the default length, so it doesn't fall back
// to the last picked.
let ski: Ski =
  SKIS[skiId(params.get("ski") ?? (shared || requested ? null : lastLength()))];
let mode: "3d" | "flat" | "crop" = "3d";
let bindings = false;
let design: Loaded | undefined;
let sheets: Topsheets | undefined;
let library: Design[] = [];

const blank = blankArt();

// Showing a design

function markSelected(id?: string) {
  press("[data-version]", (pill) => pill.dataset.version === id);
  // Your design's tile shows its latest version, and stands for all of them.
  const item = id ? recall(id) : undefined;
  const chain = new Set(item ? versions(item).map((other) => other.id) : []);
  press("[data-design]", (tile) => chain.has(tile.dataset.design!));
  press("[data-example]", (tile) => tile.dataset.example === id);
  press("[data-blank]", () => !id);
  for (const row of [styleRow, versionRow, libraryRow]) row.update();
}

// An earlier pick that finishes loading after a later one is dropped.
let picked = 0;

async function select(next?: Design) {
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
  // Blank is the same black wherever the pair sits.
  $<HTMLButtonElement>('[data-mode="crop"]').disabled = !design;
  if (!design && mode === "crop") setMode("3d");
  $("[data-generate-label]").textContent = design
    ? "Generate another"
    : "Generate";
  window.history.replaceState(null, "", link(design));
  render();
  renderVersions();
  markSelected(design?.id);
  if (design) loadAncestors(design);
}

// Blank always names the length, as a bare /design opens the latest design.
function link(item?: Design) {
  const url = new URL(item?.saved ? `/d/${item.id}` : "/design", location.href);
  if (item && !item.saved) url.searchParams.set("d", item.id);
  if (!item || ski.id !== DEFAULT_SKI) url.searchParams.set("ski", ski.id);
  return url.pathname + url.search;
}

function showPrompt(item?: Design) {
  textarea.value = item?.prompt ?? "";
  markStyle();
}

function describe(item: Design) {
  return [item.prompt, ...(item.edits ?? [])].join(" → ");
}

function presetDesign(preset: Preset): Design {
  return {
    created: 0,
    frame: preset.frame,
    id: preset.id,
    prompt: preset.prompt,
    src: preset.art,
  };
}

async function findDesign(id: string) {
  const seen = recall(id);
  if (seen) return seen;
  const preset = PRESETS.find((each) => each.id === id);
  if (preset) return remember(presetDesign(preset));
  const saved = await getDesign(id);
  return saved && remember(saved);
}

// Cut topsheets for the last few designs and skis, so switching back is
// instant. Few, as each pair takes about 10 MB at the studio's resolution.
const cut = new Map<string, Topsheets>();

const cutKey = (item: Design | undefined, on: Ski) =>
  `${item?.id ?? ""}:${on.id}:${frameKey(item?.frame)}`;

function render() {
  // Loading shows only on the empty stage. Later designs load behind the
  // pair on show.
  loading.remove();
  if (mode === "crop") {
    const art = design?.image ?? blank;
    cropper.show({ art, bindings, frame: design?.frame, ski });
    markFlip();
    return;
  }
  cutSheets();
  if (mode === "flat") renderFlatView();
}

function cutSheets() {
  const key = cutKey(design, ski);
  if (!cut.has(key)) {
    if (cut.size > 6) cut.delete(cut.keys().next().value!);
    cut.set(
      key,
      artTopsheets(ski, design?.image ?? blank, STUDIO_HEIGHT, {
        frame: design?.frame,
      }),
    );
  }
  sheets = cut.get(key)!;
  viewer.setSki(ski);
  viewer.setTopsheets(sheets);
}

// A shared design's copy in your designs keeps the move too, and its maker's
// link shows it once it settles.
function moved(frame: Frame) {
  if (!design || frameKey(frame) === frameKey(design.frame)) return;
  design.frame = frame;
  markFlip();
  const { id } = design;
  const seen = recall(id);
  if (seen) seen.frame = frame;
  const mine = library.find((item) => item.id === id);
  if (mine) {
    mine.frame = frame;
    saveToLibrary(mine);
    thumbnails.delete(id);
    renderLibrary();
  }
  if (design.saved && design.owner) syncFrame(design, design.owner, frame);
}

let syncing = 0;
function syncFrame(item: Loaded, owner: string, frame: Frame) {
  clearTimeout(syncing);
  syncing = setTimeout(async () => {
    try {
      const cards = await linkCards(item.image, frame);
      await saveFrame(item.id, owner, frame, defaultInk(item), cards);
    } catch {}
  }, 1500);
}

// At the default length, as the gallery's small copy draws them.
function defaultInk(item: Loaded) {
  const on = SKIS[DEFAULT_SKI];
  return inkOf(
    cut.get(cutKey(item, on)) ??
      artTopsheets(on, item.image, STUDIO_HEIGHT, { frame: item.frame }),
  );
}

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

// Versions

const versionRow = pillRow($("[data-version-row]"));

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

// Versions that are here can still come from ones that aren't, like a saved
// change to an example, so it goes all the way back.
async function loadAncestors(item: Design) {
  for (let id = item.parent; id;) {
    const parent = await findDesign(id);
    if (!parent) break;
    id = parent.parent;
  }
  renderVersions();
}

// Size, view and bindings

function pickSki(id: SkiId) {
  ski = SKIS[id];
  $("[data-specs]").innerHTML =
    `<span>${ski.tip}/${ski.waist}/${ski.tail}</span><span>${ski.radius} m</span>`;
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

const DRAG = { "3d": "rotate", flat: "pan", crop: "move" } as const;

function setMode(next: typeof mode) {
  mode = next;
  press("[data-mode]", (button) => button.dataset.mode === mode);
  for (const layer of document.querySelectorAll<HTMLElement>("[data-show]")) {
    layer.hidden = layer.dataset.show !== mode;
  }
  $("[data-drag]").textContent = DRAG[mode];
  $("[data-zoom]").textContent = mode === "crop" ? "size" : "zoom";
}

for (const button of document.querySelectorAll<HTMLElement>("[data-mode]")) {
  button.addEventListener("click", () => {
    setMode(button.dataset.mode as typeof mode);
    if (mode === "crop") {
      render();
      $("[data-crop]").focus({ preventScroll: true });
      return;
    }
    cutSheets();
    if (mode === "flat") {
      flatZoom.reset();
      requestAnimationFrame(() => renderFlatView(true));
    } else {
      viewer.reset();
    }
  });
}

function markFlip() {
  press("[data-flip]", () => !!design?.frame?.flip);
}

$("[data-flip]").addEventListener("click", cropper.flip);

// Display only; orders don't include them.
$("[data-bindings]").addEventListener("click", () => {
  bindings = !bindings;
  press("[data-bindings]", () => bindings);
  viewer.setBindings(bindings);
  if (mode === "flat") renderFlatView();
  if (mode === "crop") render();
});

// Sharing

const cards = new Map<string, Promise<HTMLCanvasElement>>();

// The whole art, which the gallery cuts with the design's frame, as tall as
// the examples' however wide it is.
function galleryCopy(item: Loaded) {
  const { image } = item;
  const canvas = document.createElement("canvas");
  canvas.height = 1100;
  canvas.width = Math.round((image.width * canvas.height) / image.height);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return {
    ink: defaultInk(item),
    thumbnail: canvas.toDataURL("image/jpeg", 0.85),
  };
}

function galleryToggle(item: Loaded) {
  const { owner } = item;
  if (!owner) return;
  return async (show?: boolean) => {
    // The sheet shows the change before the copy is drawn.
    if (show) await nextFrame();
    return setGallery(
      item.id,
      owner,
      show,
      show ? galleryCopy(item) : undefined,
    );
  };
}

// The plain black pair shares too, as it can be ordered as is.
$("[data-share]").addEventListener("click", () => {
  const current = { design, ski };
  const key = cutKey(design, ski);
  const preset = PRESETS.find((each) => each.id === design?.id);
  share({
    gallery: design && galleryToggle(design),
    preview: () => {
      if (!cards.has(key)) {
        cards.set(
          key,
          current.design
            ? designCard(current.ski, current.design.image, {
                frame: current.design.frame,
                label: preset && `${preset.label} `,
              })
            : designCard(current.ski, blank, { label: "Black " }),
        );
      }
      return cards.get(key)!;
    },
    url: new URL(link(design), location.origin).href,
  });
});

// Prompt

textarea.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    form.requestSubmit();
  }
});

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

const styleRow = pillRow($("[data-styles]"));
styleRow.show(
  STYLES.map((style) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pill";
    button.dataset.style = style.label;
    button.textContent = style.label;
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

// The progress bar can't know how far along the image model is, so it eases
// toward full: about 85% at the usual 20s, filling only once it's done.
const PACE = 10.5; // seconds

function busy(on: boolean) {
  const overlay = $("[data-busy]");
  const progress = $("[data-progress]");
  for (const input of document.querySelectorAll<
    HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement
  >("[data-controls] :is(button, input, textarea):not([data-ski])")) {
    input.disabled = on;
  }
  clearInterval(Number(overlay.dataset.timer));
  clearTimeout(Number(overlay.dataset.closing));
  if (!on) {
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
      busyMessages[Math.min(busyMessages.length - 1, Math.floor(seconds / 4))];
    progress.style.scale = `${1 - Math.exp(-seconds / PACE)} 1`;
  };
  tick();
  overlay.dataset.timer = String(setInterval(tick, 250));
}

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
    const result = await requestDesign({
      frame: editing ? design?.frame : undefined,
      parent: editing ? design?.id : undefined,
      prompt,
    });
    result.design.src = await cleanArt(result.design.src);
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

// One for each length, so a link shows the length it opens at.
async function linkCards(image: ImageBitmap, frame?: Frame) {
  const cards: Record<string, string> = {};
  for (const each of Object.values(SKIS)) {
    const card = await designCard(each, image, { frame });
    cards[each.id] = card.toDataURL("image/jpeg", 0.88);
  }
  return cards;
}

// Without these, shared links fall back to a generic card.
async function uploadCard(item: Design, token: string) {
  try {
    const cards = await withBitmap(item.src, (image) =>
      linkCards(image, item.frame),
    );
    await saveCard(item.id, token, cards);
  } catch {}
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  generate();
});

editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const edit = change.value.trim();
  if (edit) change.value = "";
  const before = design?.id;
  await generate(edit);
  if (edit && design?.id === before && !change.value) change.value = edit;
});

// Library

const thumbnails = new Map<string, Promise<HTMLCanvasElement>>();

const CARD =
  "bg-chip hover:bg-chip-hover aria-pressed:ring-ink flex h-36 w-16 shrink-0 cursor-pointer items-center justify-center rounded-2xl p-1.5 transition disabled-dim aria-pressed:ring-1";
const PAIR = "h-full w-auto max-w-full object-contain";
const libraryRow = pillRow($("[data-library-row]"));

function addToLibrary(item: Design) {
  library = [item, ...library].slice(0, 60);
  saveToLibrary(item);
  renderLibrary();
}

function libraryCard(
  label: string,
  pair: () => Promise<HTMLCanvasElement>,
  item?: Design,
) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", "false");
  button.className = CARD;
  const key = item?.id ?? "";
  if (!thumbnails.has(key)) thumbnails.set(key, pair());
  thumbnails.get(key)!.then((canvas) => {
    const copy = copyCanvas(canvas);
    copy.className = item ? PAIR : `${PAIR} opacity-40`;
    button.replaceChildren(copy);
  });
  button.addEventListener("click", () => {
    showPrompt(item);
    select(item);
  });
  return button;
}

function renderLibrary() {
  const blankCard = libraryCard("New blank design", async () =>
    dashedPair(SKIS[DEFAULT_SKI], 280),
  );
  blankCard.dataset.blank = "";
  const mine = latest(library).map((item) => {
    const tile = libraryCard(
      `Show design: ${describe(item)}`,
      () =>
        withBitmap(item.src, (image) =>
          cutPair(SKIS[DEFAULT_SKI], image, 280, { frame: item.frame }),
        ),
      item,
    );
    tile.dataset.design = item.id;
    return tile;
  });
  const examples = PRESETS.map((preset) => {
    const item = recall(preset.id) ?? remember(presetDesign(preset));
    const tile = libraryCard(
      `Show example: ${preset.label}`,
      async () =>
        cutPair(SKIS[DEFAULT_SKI], await loadImage(preset.thumbnail), 280, {
          frame: preset.frame,
        }),
      item,
    );
    tile.dataset.example = preset.id;
    return tile;
  });
  libraryRow.show([blankCard, ...mine, ...examples]);
  markSelected(design?.id);
}

// With nothing focused, the arrow keys step through the designs.
document.addEventListener("keydown", (event) => {
  const way = wayOf(event);
  if (!way || event.target !== document.body) return;
  event.preventDefault();
  libraryRow.step(way);
});

// Ordering

$("[data-order]").addEventListener("click", () => {
  cutSheets();
  if (!sheets) return;
  const thumbnail = renderFlat(ski, sheets, 400).toDataURL();
  if (!design) {
    openOrder(stockOrder(ski, thumbnail));
    return;
  }
  const current = { design, sheets, ski };
  const ink = inkOf(sheets);
  openOrder({
    attachments: async () => ({
      art: cropArt(
        current.ski,
        current.design.image,
        current.design.frame,
      ).toDataURL("image/jpeg", 0.9),
      preview: renderFlat(current.ski, current.sheets, 1800).toDataURL(
        "image/jpeg",
        0.9,
      ),
    }),
    custom: true,
    design: current.design.saved ? current.design.id : undefined,
    edits: current.design.edits,
    marks: ink.marks,
    outlines: ink.outlines,
    model: ski.id,
    price: PRICE,
    prompt: current.design.prompt,
    ski: `Custom ${ski.id} cm`,
    thumbnail,
    title: `Custom ${ski.id}`,
  });
});

// Start

library = await loadLibrary();
library.forEach(remember);
renderLibrary();
// Customize from a ski's card starts that model blank.
const start = shared
  ? await findDesign(shared)
  : requested
    ? await findDesign(requested)
    : params.has("ski")
      ? undefined
      : latest(library)[0];
try {
  showPrompt(start);
  await select(start);
} finally {
  for (const controls of document.querySelectorAll<HTMLElement>("[inert]")) {
    controls.inert = false;
  }
}

// A shared design joins your designs once its art is cleaned.
if (shared && start && !library.some((item) => item.id === start.id)) {
  addToLibrary({ ...start, added: Date.now() });
}
