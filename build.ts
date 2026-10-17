import { $ } from "bun";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { PRESETS } from "./src/client/presets";

// Builds into a fresh folder, then copies it over dist and drops anything
// stale. dist stays the same folder, so a running dev server keeps serving
// it, even when something else builds (like wrangler deploy --dry-run).
const out = `.build-${process.pid}`;

await rm(out, { force: true, recursive: true });
await mkdir(`${out}/assets`, { recursive: true });
await cp("static", out, { recursive: true });
await cp("src/pages", out, { recursive: true });

// The home page's rack cuts its pairs from these, so they start downloading
// with the page rather than once its script runs.
const home = `${out}/index.html`;
const preloads = PRESETS.map(
  (preset) =>
    `<link rel="preload" as="image" type="image/webp" href="${preset.thumbnail}" />`,
).join("\n    ");
await writeFile(
  home,
  (await readFile(home, "utf8")).replace("</head>", `  ${preloads}\n  </head>`),
);

const result = await Bun.build({
  entrypoints: ["src/client/home.ts", "src/client/studio.ts"],
  minify: true,
  outdir: `${out}/assets`,
  splitting: true,
  target: "browser",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  await rm(out, { force: true, recursive: true });
  process.exit(1);
}

await $`tailwindcss -i src/styles.css -o ${out}/assets/app.css --minify`.quiet();

const files = (dir: string) =>
  readdir(dir, { recursive: true }).then((names) => new Set(names));
const fresh = await files(out);
await mkdir("dist", { recursive: true });
await cp(out, "dist", { force: true, recursive: true });
for (const name of await files("dist")) {
  if (!fresh.has(name))
    await rm(`dist/${name}`, { force: true, recursive: true });
}
await rm(out, { force: true, recursive: true });
