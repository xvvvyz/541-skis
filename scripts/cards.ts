// The link previews for the example designs, <id>-<length>.jpg: the
// studio's own share card, named for the example, drawn at build time as the
// server can't. Kept in node_modules/.cache/example-cards, and drawn again
// only once something they come from changes.

import {
  createCanvas,
  GlobalFonts,
  Image,
  loadImage,
  Path2D,
  type Canvas,
} from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { designCard } from "../src/client/card";
import { PRESETS } from "../src/client/presets";
import { SKIS } from "../src/client/ski";

const CACHE = "node_modules/.cache/example-cards";
const FONTS = {
  "Big Shoulders Display": "scripts/fonts/BigShouldersDisplay-ExtraBold.ttf",
  "Geist Mono": "scripts/fonts/GeistMono-Medium.ttf",
};

export async function exampleCards(dir: string) {
  const stamp = await inputsHash();
  if ((await readFile(`${CACHE}.stamp`, "utf8").catch(() => "")) === stamp) {
    await cp(CACHE, dir, { recursive: true });
    return;
  }
  await draw(dir);
  await rm(CACHE, { force: true, recursive: true });
  await cp(dir, CACHE, { recursive: true });
  await writeFile(`${CACHE}.stamp`, stamp);
}

async function draw(dir: string) {
  // What the card's code takes from the browser. Its images load from
  // static, as the site's paths are served from there.
  class SiteImage extends Image {
    override set src(value) {
      super.src =
        typeof value === "string" && value.startsWith("/")
          ? readFileSync(`static${value}`)
          : value;
    }
  }
  Object.assign(globalThis, {
    document: {
      createElement: () => Object.assign(createCanvas(1, 1), { dataset: {} }),
      fonts: { load: async () => [] },
    },
    Image: SiteImage,
    Path2D,
  });
  for (const [family, path] of Object.entries(FONTS)) {
    GlobalFonts.registerFromPath(path, family);
  }

  await mkdir(dir, { recursive: true });
  for (const preset of PRESETS) {
    const art = await loadImage(await readFile(`static${preset.art}`));
    for (const ski of Object.values(SKIS)) {
      const card = (await designCard(ski, art as unknown as HTMLImageElement, {
        frame: preset.frame,
        label: `${preset.label} `,
      })) as unknown as Canvas;
      await writeFile(
        `${dir}/${preset.id}-${ski.id}.jpg`,
        await card.encode("jpeg", 88),
      );
    }
  }
}

async function inputsHash() {
  const sources = new Set<string>();
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const walk = async (file: string) => {
    if (sources.has(file)) return;
    sources.add(file);
    if (!file.endsWith(".ts")) return;
    for (const { path } of transpiler.scanImports(await readFile(file))) {
      if (!path.startsWith(".")) continue;
      const next = resolve(dirname(file), path);
      await walk(next.match(/\.\w+$/) ? next : `${next}.ts`);
    }
  };
  await walk(resolve(import.meta.path));
  const files = [
    ...sources,
    ...Object.values(FONTS),
    "static/images/hood-topo.svg",
    ...PRESETS.map((preset) => `static${preset.art}`),
  ];
  const hash = new Bun.CryptoHasher("sha256");
  for (const file of files) hash.update(await readFile(file));
  return hash.digest("hex");
}
