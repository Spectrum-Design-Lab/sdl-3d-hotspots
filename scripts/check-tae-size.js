#!/usr/bin/env node
/**
 * TAE bundle-size guard. Runs after `npm run build:tae` and fails CI
 * if any output exceeds its budget. Catches accidental schema imports
 * (Zod adds ~12 KB minified) and protects the 10 KB AppBlockJavaScript
 * cap on viewer.js.
 *
 * Budgets are intentionally loose buffers above current sizes — bumped
 * when a deliberate feature lands; failing means a contributor should
 * confirm the growth is wanted before bumping the budget.
 */
import { statSync } from "node:fs";
import { resolve } from "node:path";

const ASSETS_DIR = "extensions/product-3d-viewer/assets";

const BUDGETS = [
  { file: "viewer.js", maxBytes: 9_500, reason: "10KB AppBlockJavaScript cap, with 500 byte buffer" },
  { file: "viewer-3d.js", maxBytes: 30_000, reason: "lazy-loaded, generous budget but catches Zod leakage" },
  { file: "viewer-360.js", maxBytes: 30_000, reason: "lazy-loaded, generous budget but catches Zod leakage" },
];

let failed = false;
for (const { file, maxBytes, reason } of BUDGETS) {
  const path = resolve(ASSETS_DIR, file);
  try {
    const { size } = statSync(path);
    const pct = ((size / maxBytes) * 100).toFixed(1);
    const status = size <= maxBytes ? "OK" : "FAIL";
    const tag = status === "OK" ? "\x1b[32m" : "\x1b[31m";
    console.log(`${tag}${status}\x1b[0m  ${file.padEnd(16)} ${String(size).padStart(6)} / ${maxBytes} bytes  (${pct}%)`);
    if (size > maxBytes) {
      console.log(`       budget reason: ${reason}`);
      failed = true;
    }
  } catch (e) {
    console.log(`\x1b[31mFAIL\x1b[0m  ${file} — missing or unreadable (${e.message})`);
    failed = true;
  }
}

if (failed) {
  console.error("\nTAE bundle-size guard failed. Investigate before bumping budgets in scripts/check-tae-size.js.");
  process.exit(1);
}
