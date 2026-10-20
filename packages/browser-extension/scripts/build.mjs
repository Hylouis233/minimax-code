// Builds the extension into something a browser can actually load.
//
// A browser extension runtime executes **JavaScript only**. The extension's
// source is TypeScript, so loading the source directory registers a service
// worker that then cannot run — the extension looks installed and does
// nothing. A probe against a real Chrome showed exactly that:
// `.plan/board/validation/extension-load-evidence.json`.
//
// So the source directory is not the loadable artefact. This script produces
// `dist/`, which is:
//
//   dist/manifest.json                  the manifest, with the built paths
//   dist/background/service-worker.js   the bundled service worker
//   dist/options.html, dist/options.js  the bundled options page
//
// Load `dist/` as an unpacked extension. The source `manifest.json` stays the
// single declaration of the extension's metadata; this script only rewrites
// the two paths that point at source, and it says so where it rewrites them.

import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(packageRoot, "dist");

/** The browser this targets. The manifest's `minimum_chrome_version` says the same. */
const BROWSER_TARGET = ["chrome116", "edge116"];

await rm(outDir, { recursive: true, force: true });
await mkdir(join(outDir, "background"), { recursive: true });

const common = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: BROWSER_TARGET,
  // The service worker runs as a module, so the bundle must be an ES module
  // and the manifest's `background.type` must stay "module".
  sourcemap: false,
  minify: false,
  legalComments: "none",
};

await build({
  ...common,
  entryPoints: [join(packageRoot, "src/background/service-worker.ts")],
  outfile: join(outDir, "background/service-worker.js"),
});

await build({
  ...common,
  entryPoints: [join(packageRoot, "src/options.ts")],
  outfile: join(outDir, "options.js"),
});

// The options page is HTML; its script reference has to point at the bundle.
const optionsHtml = await readFile(join(packageRoot, "options.html"), "utf8");
const rewrittenOptions = optionsHtml.replace(
  /(src\s*=\s*)["'][^"']*options[^"']*["']/u,
  '$1"options.js"',
);
await writeFile(join(outDir, "options.html"), rewrittenOptions, "utf8");

// The manifest is copied with the two source paths rewritten to the built
// ones. Nothing else about it changes: it is the single declaration of the
// extension's metadata, and the build only relocates it.
const manifest = JSON.parse(await readFile(join(packageRoot, "manifest.json"), "utf8"));
if (manifest.background?.service_worker) {
  manifest.background.service_worker = "background/service-worker.js";
}
if (manifest.options_ui?.page) {
  manifest.options_ui.page = "options.html";
}
await writeFile(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

// The manifest's icon, if the extension ever has one, is copied verbatim.
if (manifest.icons) {
  for (const icon of Object.values(manifest.icons)) {
    await cp(join(packageRoot, icon), join(outDir, icon));
  }
}

process.stdout.write(`Built the extension into ${outDir}\n`);
