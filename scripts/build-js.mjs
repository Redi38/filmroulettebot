#!/usr/bin/env node
// Bundles app/web/static/js/core/main.js and everything it imports (real
// ES modules — see git history for the old manifest.json + concat-only
// approach) into app/web/static/js/dist/bundle.min.js.
//
// `bundle: true` lets esbuild resolve the whole import graph itself, so
// manifest.json's hand-maintained load order is gone: script order now
// just follows the `import` statements, the same way it would in any other
// ESM codebase. `format: "esm"` (rather than "iife") is deliberate even
// though this step doesn't split anything yet — it's what step 2 (lazy
// `import()` for the spin wheel, splitting: true) will build on directly.
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
const OUT_FILE = path.join(DIST_DIR, "bundle.min.js");

const buildOptions = {
  entryPoints: [ENTRY],
  bundle: true,
  format: "esm",
  splitting: false, // step 2 turns this on once the spin wheel is a separate import()
  minify: true,
  sourcemap: true,
  target: "es2020",
  outfile: OUT_FILE,
  legalComments: "none",
};

async function build() {
  const result = await esbuild.build(buildOptions);
  if (result.errors.length) {
    process.exitCode = 1;
    return;
  }
  const { size } = await import("node:fs").then((fs) =>
    fs.promises.stat(OUT_FILE)
  );
  console.log(
    `[build-js] bundled ${path.relative(ROOT, ENTRY)} -> ${path.relative(
      ROOT,
      OUT_FILE
    )} (${(size / 1024).toFixed(1)} KB minified)`
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
