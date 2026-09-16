#!/usr/bin/env node
// Bundles app/web/static/js/core/main.js and everything it imports (real
// ES modules — see git history for the old manifest.json + concat-only
// approach) into app/web/static/js/dist/bundle.min.js.
//
// `bundle: true` lets esbuild resolve the whole import graph itself, so
// manifest.json's hand-maintained load order is gone: script order now
// just follows the `import` statements, the same way it would in any other
// ESM codebase. `format: "esm"` (rather than "iife") is what makes step 2
// possible: `splitting: true` below turns spin/wheel/*'s lazy `import()`
// (see spin/wheel/loader.js) into a real separate chunk — canvas build/
// draw, spin animation, audio cues and confetti only ever get downloaded
// once someone actually reaches the roulette — instead of esbuild silently
// inlining it into the entry bundle.
//
// Usage:
//   node scripts/build-js.mjs          # one-off build
//   node scripts/build-js.mjs --watch  # rebuild on change (local dev)

import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const JS_DIR = path.join(ROOT, "app/web/static/js");
const DIST_DIR = path.join(JS_DIR, "dist");
const ENTRY = path.join(JS_DIR, "core/main.js");

const buildOptions = {
  entryPoints: [ENTRY],
  bundle: true,
  format: "esm",
  splitting: true,
  // Code-splitting requires an outdir (esbuild picks chunk file names
  // itself), so the fixed "bundle.min.js" name from before is pinned via
  // entryNames instead — app/web/server/shared/assets.py and index.html
  // both still point at dist/bundle.min.js. Lazy chunks (currently just
  // the wheel) land alongside it as content-hashed files under
  // dist/chunks/, which is what actually busts their cache on change —
  // they're loaded via relative import() from bundle.min.js, not through
  // the ?v= query param index.html stamps onto the entry file.
  entryNames: "bundle.min",
  chunkNames: "chunks/[name]-[hash]",
  minify: true,
  sourcemap: true,
  target: "es2020",
  outdir: DIST_DIR,
  legalComments: "none",
};

async function build() {
  const result = await esbuild.build(buildOptions);
  if (result.errors.length) {
    process.exitCode = 1;
    return;
  }
  const fs = await import("node:fs");
  const entries = await fs.promises.readdir(DIST_DIR, { recursive: true });
  const jsFiles = entries.filter((f) => f.endsWith(".js"));
  let totalBytes = 0;
  for (const f of jsFiles) {
    const { size } = await fs.promises.stat(path.join(DIST_DIR, f));
    totalBytes += size;
  }
  console.log(
    `[build-js] bundled ${path.relative(ROOT, ENTRY)} -> ${path.relative(
      ROOT,
      DIST_DIR
    )}/ (${jsFiles.length} file(s), ${(totalBytes / 1024).toFixed(1)} KB minified)`
  );
}

async function main() {
  const watchMode = process.argv.includes("--watch");
  if (watchMode) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log("[build-js] watching for changes...");
    return;
  }
  await build();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
