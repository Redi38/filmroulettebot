#!/usr/bin/env node
// Bundles app/web/static/js/**/*.js (currently loaded as 29 separate
// <script defer> tags — see git history of index.html) into one minified
// file so the page makes a single request instead of 29 round trips.
//
// Deliberately NOT using esbuild's `bundle: true` / ESM resolution: the
// source files are plain classic scripts with no import/export, relying on
// load order and shared globals (see manifest.json's comment). So instead
// we just concatenate them in manifest order — which is semantically
// identical to loading them as separate <script> tags in that order, since
// classic scripts share one global lexical environment — and hand the
// result to esbuild purely as a minifier.
//
// Usage:
//   node scripts/build-js.mjs          # one-off build
//   node scripts/build-js.mjs --watch  # rebuild on change (local dev)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const JS_DIR = path.join(ROOT, "app/web/static/js");
const DIST_DIR = path.join(JS_DIR, "dist");
const CONCAT_FILE = path.join(DIST_DIR, "_bundle.concat.js");
const OUT_FILE = path.join(DIST_DIR, "bundle.min.js");

async function loadManifest() {
  const raw = await readFile(path.join(JS_DIR, "manifest.json"), "utf8");
  return JSON.parse(raw).files;
}

async function concat(files) {
  const parts = [];
  for (const rel of files) {
    const abs = path.join(JS_DIR, rel);
    const src = await readFile(abs, "utf8");
    // Boundary comment: makes the (unminified) concat file readable, and
    // gives the sourcemap something to point stack traces at.
    parts.push(`// ---- ${rel} ----\n${src.trimEnd()}\n`);
  }
  return parts.join("\n");
}

async function build() {
  const files = await loadManifest();
  if (!existsSync(DIST_DIR)) await mkdir(DIST_DIR, { recursive: true });

  const concatenated = await concat(files);
  await writeFile(CONCAT_FILE, concatenated, "utf8");

  const result = await esbuild.build({
    entryPoints: [CONCAT_FILE],
    bundle: false,
    minify: true,
    sourcemap: true,
    target: "es2019",
    outfile: OUT_FILE,
    legalComments: "none",
  });

  if (result.errors.length) {
    process.exitCode = 1;
    return;
  }

  const { size } = await import("node:fs").then((fs) =>
    fs.promises.stat(OUT_FILE)
  );
  console.log(
    `[build-js] bundled ${files.length} files -> ${path.relative(
      ROOT,
      OUT_FILE
    )} (${(size / 1024).toFixed(1)} KB minified)`
  );
}

async function main() {
  const watchMode = process.argv.includes("--watch");
  await build();
  if (!watchMode) return;

  console.log("[build-js] watching for changes...");
  const files = await loadManifest();
  let pending = false;
  const rebuild = async () => {
    if (pending) return;
    pending = true;
    setTimeout(async () => {
      pending = false;
      try {
        await build();
      } catch (err) {
        console.error(err);
      }
    }, 100); // debounce
  };
  for (const rel of files) {
    watch(path.join(JS_DIR, rel), rebuild);
  }
  watch(path.join(JS_DIR, "manifest.json"), rebuild);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
