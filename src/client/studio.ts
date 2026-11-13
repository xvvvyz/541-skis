import {
  copyDesign,
  getDesign,
  requestDesign,
  saveCard,
  saveLayout,
  setGallery,
} from "./api";
import { arranger } from "./arrange";
import { autosize } from "./autosize";
import { designCard } from "./card";
import { loadLayers, type Placed } from "./cutout";
import { $, drawLogos } from "./dom";
import { frameKey, type Frame } from "./frame";
import { cleanArt } from "./guide";
import { copyCanvas, loadBitmap, loadImage, withBitmap } from "./image";
import { loadLibrary, saveToLibrary, type Design } from "./library";
import { openOrder, stockOrder } from "./order";
import { stopPageZoom } from "./pagezoom";
import { pillRow, wayOf } from "./pills";
import {
  imageFiles,
  loadPieces,
  loadUploads,
  newUpload,
  REFERENCE_SIZE,
  spotDecals,
  uploadFile,
  type PlacedUpload,
} from "./pictures";
import { positioner } from "./position";
import { PRESETS, type Preset } from "./presets";
import { CHANGES, IDEAS, STYLES, styleOf, toggleStyle } from "./prompts";
import { share } from "./share";
import { DEFAULT_SKI, PRICE, SKIS, skiId, type Ski, type SkiId } from "./ski";
import {
  artTopsheets,
  blankArt,
  cropArt,
  cutPair,
  dashedPair,
  inkOf,
  renderFlat,
  STUDIO_HEIGHT,
  type Art,
  type Cut,
  type Ink,
  type Topsheets,
} from "./topsheet";
import { MAX_UPLOADS, plainUploads, uploadsKey } from "./uploads";
import { latest, recall, remember, versions } from "./versions";
import { SkiViewer } from "./viewer";

// Decals are all of the design's; those moved by hand are drawn among its
// images instead of in their spots.
type Loaded = Omit<Design, "uploads"> & {
  image: Art;
  decals: Placed[];
  uploads: PlacedUpload[];
};

// What's drawn over a design's art.
const cutOf = (item?: Loaded): Cut =>
  item ? { decals: item.decals, frame: item.frame, uploads: item.uploads } : {};

function press(selector: string, selected: (element: HTMLElement) => boolean) {
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    element.setAttribute("aria-pressed", String(selected(element)));
  }
}

// What went wrong, for the customer: the server's words, or else a
// fallback, as for a dropped connection.
const messageOf = (error: unknown, fallback: string) =>
  error instanceof TypeError || !(error as Error).message
    ? fallback
    : (error as Error).message;

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
const cropper = positioner($("[data-crop]"), moved);
const arrange = arranger(flat, $("[data-piece-tools]"), {
  change: setUploads,
  remove: removePiece,
  select: markPieces,
  zoomed: (zoomed) => ($("[data-fit]").hidden = !zoomed),
});
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
let mode: "3d" | "flat" | "crop" = "flat";
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
  const [image, decals, uploads] = await Promise.all([
    next && loadBitmap(next.src),
    loadLayers(next?.layers),
    loadUploads(next?.uploads),
  ]);
  if (pick !== picked) {
    image?.close();
    return;
  }
  design = next && image && { ...next, decals, image, uploads };
  arrange.select(null);
  showReference();
  if (!design && mode === "crop") setMode("flat");
  render();
  markDesign();
  if (design) loadAncestors(design);
}

// The controls and link for the design on show.
function markDesign() {
  $("[data-refine]").hidden = !design;
  // Blank is the same black wherever the pair sits.
  $<HTMLButtonElement>('[data-mode="crop"]').disabled = !design;
  $("[data-generate-label]").textContent = design
    ? "Generate another"
    : "Generate";
  window.history.replaceState(null, "", link(design));
  renderVersions();
  markSelected(design?.id);
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
// instant: one for each, as it's arranged now. Few, as each pair takes
// about 10 MB at the studio's resolution.
const cut = new Map<string, { arranged: string; sheets: Topsheets }>();

const pairKey = (item: Design | undefined, on: Ski) =>
  `${item?.id ?? ""}:${on.id}`;
const arrangedKey = (item: Design | undefined) =>
  `${frameKey(item?.frame)}:${uploadsKey(item?.uploads)}:${item?.layers?.length}`;

// The topsheets for a design on a ski, if they're cut as it's arranged now.
function cutFor(item: Design | undefined, on: Ski) {
  const entry = cut.get(pairKey(item, on));
  return entry?.arranged === arrangedKey(item) ? entry.sheets : undefined;
}

function render(rise = false) {
  // Loading shows only on the empty stage. Later designs load behind the
  // pair on show.
  loading.remove();
  if (mode === "crop") {
    cropper.show({
      ...cutOf(design),
      art: design?.image ?? blank,
      bindings,
      ski,
    });
    markFlip();
    return;
  }
  if (mode === "flat") {
    // A design or ski not seen yet is cut at once, for its marks' colours.
    // A picture just put down keeps the colours it had while it's cut
    // again, which is too slow to hold it up.
    const pair = pairKey(design, ski);
    if (shownInk?.pair !== pair && !cutFor(design, ski)) cutSheets();
    showFlat(rise);
    clearTimeout(inking);
    if (!cutFor(design, ski)) {
      inking = setTimeout(() => {
        cutSheets();
        if (mode === "flat") showFlat();
      }, 250);
    }
    return;
  }
  cutSheets();
}

let inking = 0;
let shownInk: { ink: Ink; pair: string } | undefined;

// The flat pair, where its pictures move, with the marks in the colours
// last picked for it.
function showFlat(rise = false) {
  const ready = cutFor(design, ski);
  const pair = pairKey(design, ski);
  if (ready) shownInk = { ink: inkOf(ready), pair };
  const cut = cutOf(design);
  arrange.show(
    {
      ...cut,
      art: design?.image ?? blank,
      bindings,
      decals: spotDecals(cut.decals, cut.uploads),
      ink: shownInk!.ink,
      ski,
      uploads: design?.uploads ?? [],
    },
    rise,
  );
  markPieces(arrange.selected);
}

function cutSheets() {
  sheets = cutFor(design, ski);
  if (!sheets) {
    const pair = pairKey(design, ski);
    cut.delete(pair);
    if (cut.size > 6) cut.delete(cut.keys().next().value!);
    sheets = artTopsheets(
      ski,
      design?.image ?? blank,
      STUDIO_HEIGHT,
      cutOf(design),
    );
    cut.set(pair, { arranged: arrangedKey(design), sheets });
  }
  viewer.setSki(ski);
  viewer.setTopsheets(sheets);
}

// A shared design's copy in your designs keeps the move too, and its maker's
// link shows it once it settles.
function moved(frame: Frame) {
  if (!design || frameKey(frame) === frameKey(design.frame)) return;
  design.frame = frame;
  markFlip();
  remembered(design.id, { frame });
  syncLayout(design);
}

// A change to a design kept in what this visit knows of it and in your
// designs, whose tile is drawn again.
function remembered(id: string, change: Partial<Design>, redraw = true) {
  const seen = recall(id);
  if (seen) Object.assign(seen, change);
  const mine = library.find((item) => item.id === id);
  if (mine) {
    Object.assign(mine, change);
    saveToLibrary(mine);
    if (!redraw) return;
    thumbnails.delete(id);
    renderLibrary();
  }
}

// The decals still on a design, as the worker keeps them, sent only once
// one's been taken off.
const decalIds = (item: Loaded) => item.layers?.map((layer) => layer.id);
const trimmed = new WeakSet<Loaded>();

// Saves where the pair sits and its images, for a design made here, soon
// after they settle. Its link's cards and the gallery's mark colours, which
// take a while to draw, wait until it's been left alone a little longer.
let syncing = 0;
let carding = 0;
function syncLayout(item: Loaded, { cards = true } = {}) {
  const { owner } = item;
  if (!item.saved || !owner) return;
  const layout = () => ({
    decals: trimmed.has(item) ? decalIds(item) : undefined,
    frame: item.frame,
    reference: item.reference ?? null,
    uploads: plainUploads(item.uploads),
  });
  clearTimeout(syncing);
  syncing = setTimeout(() => {
    saveLayout(item.id, owner, layout()).catch(() => {});
  }, 800);
  // Nothing on show changed when only the reference picture did.
  if (!cards) return;
  clearTimeout(carding);
  carding = setTimeout(async () => {
    try {
      const cards = await linkCards(item.image, cutOf(item));
      await saveLayout(item.id, owner, layout(), defaultInk(item), cards);
    } catch {}
  }, 8000);
}

// At the default length, as the gallery's small copy draws them.
function defaultInk(item: Loaded) {
  const on = SKIS[DEFAULT_SKI];
  return inkOf(
    cutFor(item, on) ??
      artTopsheets(on, item.image, STUDIO_HEIGHT, cutOf(item)),
  );
}

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
  for (const button of document.querySelectorAll<HTMLElement>(
    "[data-length]",
  )) {
    const first = SKIS[button.dataset.length as SkiId];
    button.setAttribute("aria-pressed", String(first.length === ski.length));
  }
  for (const item of document.querySelectorAll<HTMLElement>("[data-ski]")) {
    item.setAttribute("aria-checked", String(item.dataset.ski === id));
  }
}

async function chooseSki(id: SkiId) {
  pickSki(id);
  try {
    localStorage.setItem(LENGTH, ski.id);
  } catch {}
  window.history.replaceState(null, "", link(design));
  await nextFrame();
  render();
}

// A length's button picks it. The 193's opens its shapes too, but only
// once it's picked: until then, the click stops it.
for (const button of document.querySelectorAll<HTMLElement>("[data-length]")) {
  button.addEventListener("click", (event) => {
    const first = SKIS[button.dataset.length as SkiId];
    if (first.length === ski.length) return;
    event.preventDefault();
    chooseSki(first.id);
  });
}

const shapeMenu = $("#shapes");
shapeMenu.addEventListener("toggle", (event) => {
  if ((event as ToggleEvent).newState !== "open") return;
  const below = $("[data-length='193']").getBoundingClientRect();
  shapeMenu.style.left = `${below.left}px`;
  shapeMenu.style.top = `${below.bottom + 6}px`;
});
// It's placed once, so it closes rather than drift from its button.
for (const type of ["resize", "scroll"]) {
  window.addEventListener(type, () => shapeMenu.hidePopover(), {
    capture: true,
    passive: true,
  });
}
for (const item of shapeMenu.querySelectorAll<HTMLElement>("[data-ski]")) {
  const each = SKIS[item.dataset.ski as SkiId];
  item.querySelector("[data-dims]")!.textContent =
    `${each.tip}/${each.waist}/${each.tail}`;
  item.addEventListener("click", () => {
    shapeMenu.hidePopover();
    if (each.id !== ski.id) chooseSki(each.id);
  });
}
// Known from the start and kept, so the buttons never change as it loads. A
// shared design's page comes with it marked already.
pickSki(ski.id);

const DRAG = { "3d": "rotate", crop: "move", flat: "move pictures" } as const;

function setMode(next: typeof mode) {
  mode = next;
  press("[data-mode]", (button) => button.dataset.mode === mode);
  for (const layer of document.querySelectorAll<HTMLElement>("[data-show]")) {
    layer.hidden = layer.dataset.show !== mode;
  }
  $("[data-drag]").textContent = DRAG[mode];
  $("[data-zoom]").textContent = mode === "crop" ? "size" : "zoom";
  $("[data-fit]").hidden = true;
  if (mode !== "flat") arrange.select(null);
}

// On a phone the stage is above the controls, and may be scrolled away.
function revealStage() {
  if (matchMedia("(max-width: 1023px)").matches) {
    $("[data-viewer]").parentElement!.scrollIntoView({ behavior: "smooth" });
  }
}

function showMode(next: typeof mode) {
  setMode(next);
  if (mode === "crop") {
    render();
    $("[data-crop]").focus({ preventScroll: true });
    return;
  }
  if (mode === "flat") {
    arrange.resetView();
    render(true);
    return;
  }
  cutSheets();
  viewer.reset();
}

$("[data-fit]").addEventListener("click", () => arrange.resetView());

for (const button of document.querySelectorAll<HTMLElement>("[data-mode]")) {
  button.addEventListener("click", () =>
    showMode(button.dataset.mode as typeof mode),
  );
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
  if (mode !== "3d") render();
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
  const key = `${pairKey(design, ski)}:${arrangedKey(design)}`;
  const preset = PRESETS.find((each) => each.id === design?.id);
  share({
    gallery: design && galleryToggle(design),
    preview: () => {
      if (!cards.has(key)) {
        cards.set(
          key,
          current.design
            ? designCard(current.ski, current.design.image, {
                ...cutOf(current.design),
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
// toward full: about 85% at the usual 30s, filling only once it's done.
// Changes that only move decals come back in a few seconds.
const PACE = 16; // seconds

function busy(on: boolean) {
  const overlay = $("[data-busy]");
  const progress = $("[data-progress]");
  for (const input of document.querySelectorAll<
    HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement
  >(
    "[data-controls] :is(button, input, textarea):not([data-ski], [data-length])",
  )) {
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
      busyMessages[Math.min(busyMessages.length - 1, Math.floor(seconds / 6))];
    progress.style.scale = `${1 - Math.exp(-seconds / PACE)} 1`;
  };
  tick();
  overlay.dataset.timer = String(setInterval(tick, 250));
}

async function generate(edit?: string) {
  const editing = edit !== undefined;
  // A picture to match is enough to go on, with nothing typed.
  const prompt = editing
    ? edit
    : textarea.value.trim() ||
      (referenceOf() ? "A design that looks like my picture." : "");
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
  revealStage();

  try {
    const result = await requestDesign({
      frame: editing ? design?.frame : undefined,
      parent: editing ? design?.id : undefined,
      prompt,
      // A new design can look like a picture of the customer's.
      reference: referenceOf() ?? null,
      // Your images stay as the art changes behind them.
      uploads: plainUploads(design?.uploads),
    });
    result.design.src = await cleanArt(result.design.src);
    const next = remember(result.design);
    addToLibrary(next);
    showPrompt(next);
    await select(next);
    viewer.reset();
    uploadCard(next, result.cardToken);
  } catch (error) {
    output.textContent = messageOf(error, "Something went wrong. Try again?");
  } finally {
    busy(false);
    renderVersions();
  }
}

// One for each length, so a link shows the length it opens at.
async function linkCards(image: Art, cut: Cut) {
  const cards: Record<string, string> = {};
  for (const each of Object.values(SKIS)) {
    const card = await designCard(each, image, cut);
    cards[each.id] = card.toDataURL("image/jpeg", 0.88);
  }
  return cards;
}

// Without these, shared links fall back to a generic card.
async function uploadCard(item: Design, token: string) {
  try {
    const pieces = await loadPieces(item.layers, item.uploads);
    const cards = await withBitmap(item.src, (image) =>
      linkCards(image, { ...pieces, frame: item.frame }),
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

// Your images

const uploadInput = $<HTMLInputElement>("[data-upload]");
const uploadLabel = $("[data-upload-label]");
const uploadError = $("[data-upload-error]");

// Changes the design's images, bottom first, and saves them. A design that
// isn't yours, or the plain black pair, becomes yours first: a copy with
// your images, as a new version.
function setUploads(list: PlacedUpload[]) {
  if (!design) {
    design = {
      created: Date.now(),
      decals: [],
      id: "",
      image: blank,
      prompt: "",
      reference: waitingReference,
      src: "",
      uploads: list,
    };
  } else {
    design.uploads = list;
  }
  const item = design;
  if (!item.owner) {
    own(item);
  } else {
    remembered(item.id, { layers: item.layers, uploads: plainUploads(list) });
    syncLayout(item);
  }
  render();
}

let owning: Loaded | undefined;
async function own(item: Loaded) {
  if (owning === item) return;
  owning = item;
  const sent = plainUploads(item.uploads);
  const blankSrc = item.id ? undefined : blank.toDataURL("image/jpeg", 0.9);
  try {
    const result = await copyDesign({
      art: blankSrc,
      decals: decalIds(item),
      frame: item.frame,
      parent: item.id || undefined,
      reference: item.reference ?? null,
      uploads: sent,
    });
    const next = remember({
      ...result.design,
      src: item.src || blankSrc!,
    });
    addToLibrary(next);
    uploadCard(next, result.cardToken);
    if (design !== item) return;
    // Anything changed while it saved is saved now.
    design = {
      ...next,
      decals: item.decals,
      image: item.image,
      uploads: item.uploads,
    };
    if (uploadsKey(sent) !== uploadsKey(item.uploads)) setUploads(item.uploads);
    markDesign();
  } catch (error) {
    uploadError.textContent =
      (error as Error).message ||
      "Your images couldn't be saved. They'll show here, but won't be in a link.";
  } finally {
    owning = undefined;
  }
}

async function addFiles(files: File[]) {
  if (!files.length) return;
  uploadError.textContent = "";
  const room = MAX_UPLOADS - (design?.uploads.length ?? 0);
  if (room <= 0) {
    uploadError.textContent = `A pair takes up to ${MAX_UPLOADS} images and moved decals.`;
    return;
  }
  uploadLabel.ariaBusy = "true";
  $("[data-upload-text]").textContent = "Adding…";
  try {
    // Sent all at once, then placed in turn, each clear of the last.
    const sent = await Promise.all(
      files.slice(0, room).map((file) => uploadFile(file)),
    );
    const added: PlacedUpload[] = [];
    for (const { id, image } of sent) {
      const others = [...(design?.uploads ?? []), ...added];
      added.push({ ...newUpload(ski, id, image, others), image });
    }
    if (files.length > room) {
      uploadError.textContent = `Added ${room}: a pair takes up to ${MAX_UPLOADS}.`;
    }
    const list = [...(design?.uploads ?? []), ...added];
    if (mode !== "flat") showMode("flat");
    revealStage();
    setUploads(list);
    // Picked and zoomed in on, so it's plain what to do next.
    arrange.focus(list.length - 1);
  } catch (error) {
    uploadError.textContent = messageOf(
      error,
      "That image didn't upload. Try again?",
    );
  } finally {
    uploadLabel.ariaBusy = null;
    $("[data-upload-text]").textContent = "Add image";
  }
}

uploadInput.addEventListener("change", () => {
  const files = imageFiles(uploadInput.files);
  // Picking the same file again still fires.
  uploadInput.value = "";
  addFiles(files);
});

// Drop anywhere on the page.
const dropZone = $("[data-drop]");
const carriesFiles = (event: DragEvent) =>
  !!event.dataTransfer?.types.includes("Files");
let dragDepth = 0;
document.addEventListener("dragenter", (event) => {
  if (!carriesFiles(event) || uploadInput.disabled) return;
  dragDepth++;
  dropZone.hidden = false;
});
document.addEventListener("dragleave", (event) => {
  if (!carriesFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropZone.hidden = true;
});
document.addEventListener("dragover", (event) => {
  if (carriesFiles(event)) event.preventDefault();
});
// An image dropped or pasted on the prompt is a picture for the design to
// look like; anywhere else, it goes on the skis.
const onPrompt = (event: Event) => event.target === textarea;

document.addEventListener("drop", (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  dropZone.hidden = true;
  const files = imageFiles(event.dataTransfer?.files);
  if (uploadInput.disabled || !files.length) return;
  if (onPrompt(event)) attachReference(files[0]);
  else addFiles(files);
});

// Paste an image anywhere, unless it's text going into a field.
document.addEventListener("paste", (event) => {
  const files = imageFiles(event.clipboardData?.files);
  if (!files.length || uploadInput.disabled) return;
  if (onPrompt(event)) {
    event.preventDefault();
    attachReference(files[0]);
    return;
  }
  const typing = (event.target as HTMLElement).closest("input, textarea");
  if (typing && event.clipboardData?.getData("text")) return;
  event.preventDefault();
  addFiles(files);
});

// Taken off the skis. A decal's gone from the design, not just put back in
// its spot.
function removePiece(index: number) {
  if (!design) return;
  const removed = design.uploads[index];
  const list = design.uploads.filter((_, i) => i !== index);
  if (removed?.kind === "decal") {
    const kept = (layer: { id: string }) => layer.id !== removed.id;
    design.layers = design.layers?.filter(kept);
    design.decals = design.decals.filter(kept);
    trimmed.add(design);
  }
  arrange.select(null);
  setUploads(list);
  flat.focus({ preventScroll: true });
}

function changePiece(change: (upload: PlacedUpload) => PlacedUpload) {
  const i = arrange.selected;
  if (!design || i === null) return;
  setUploads(
    design.uploads.map((upload, j) => (j === i ? change(upload) : upload)),
  );
}

// To the bottom of the stack, so whatever it covered shows over it.
function sendBack() {
  const i = arrange.selected;
  if (!design || i === null || i === 0) return;
  const list = [design.uploads[i], ...design.uploads.filter((_, j) => j !== i)];
  arrange.select(0);
  setUploads(list);
}

// On both skis, or just the one last touched, staying where it shows there.
function toggleBoth() {
  changePiece((upload) => {
    if (upload.ski !== "both") return { ...upload, ski: "both" };
    const { mirror, ...rest } = upload;
    const right = arrange.active === 1;
    const flip = !!mirror && right;
    return {
      ...rest,
      r: flip ? -upload.r : upload.r,
      ski: right ? "right" : "left",
      x: flip ? -upload.x : upload.x,
    };
  });
}

$('[data-piece="both"]').addEventListener("click", toggleBoth);
$('[data-piece="back"]').addEventListener("click", sendBack);
$('[data-piece="remove"]').addEventListener("click", () => {
  if (arrange.selected !== null) removePiece(arrange.selected);
});

// The picked picture's tools, as they apply to it.
function markPieces(index: number | null) {
  const upload = index !== null ? design?.uploads[index] : undefined;
  press('[data-piece="both"]', () => upload?.ski === "both");
  // Hidden when there's nothing under it to bring up.
  $('[data-piece="back"]').hidden = !index;
}

// A reference picture: one the design should look like, shown to the AI
// but never put on the skis. It's the design's own, so every version made
// from it is asked to look like it too, until it's taken off. On the plain
// black pair, it waits for the first design.

const referenceInput = $<HTMLInputElement>("[data-reference-input]");
const referenceButton = $("[data-reference]");
let waitingReference: string | undefined;

const referenceOf = () => (design ? design.reference : waitingReference);

function setReference(id?: string) {
  if (!design) {
    waitingReference = id;
  } else {
    design.reference = id;
    remembered(design.id, { reference: id }, false);
    syncLayout(design, { cards: false });
  }
  showReference();
}

function showReference() {
  const id = referenceOf();
  $("[data-reference-icon]").toggleAttribute("hidden", !!id);
  $("[data-reference-remove]").hidden = !id;
  const thumb = $<HTMLImageElement>("[data-reference-thumb]");
  thumb.hidden = !id;
  if (id) thumb.src = `/upload/${id}`;
  const label = id
    ? "Remove the picture the design should look like"
    : "Attach a picture for the design to look like";
  referenceButton.setAttribute("aria-label", label);
  referenceButton.title = label;
}

async function attachReference(file: File) {
  errorText.textContent = "";
  referenceButton.ariaBusy = "true";
  try {
    setReference((await uploadFile(file, REFERENCE_SIZE)).id);
  } catch (error) {
    errorText.textContent = messageOf(
      error,
      "That image didn't attach. Try again?",
    );
  } finally {
    referenceButton.ariaBusy = null;
  }
}

referenceButton.addEventListener("click", () => {
  if (referenceOf()) setReference();
  else referenceInput.click();
});

referenceInput.addEventListener("change", () => {
  const [file] = imageFiles(referenceInput.files);
  referenceInput.value = "";
  if (file) attachReference(file);
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
      async () => {
        const pieces = await loadPieces(item.layers, item.uploads);
        return withBitmap(item.src, (image) =>
          cutPair(SKIS[DEFAULT_SKI], image, 280, {
            ...pieces,
            frame: item.frame,
          }),
        );
      },
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
  const name =
    PRESETS.find((each) => each.id === current.design.id)?.label ?? "Custom";
  openOrder({
    attachments: async () => ({
      art: cropArt(
        current.ski,
        current.design.image,
        cutOf(current.design),
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
    ski: `${name} ${ski.size}`,
    thumbnail,
    title: `${name} ${ski.name}`,
    reference: current.design.reference,
    uploads: current.design.uploads
      .filter((upload) => !upload.kind)
      .map((upload) => upload.id),
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
