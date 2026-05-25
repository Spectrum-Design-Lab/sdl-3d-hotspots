import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  FRAME_PATTERNS,
  SUPPORTED_EXTENSIONS,
  type Frame,
} from "@spectrum-design-lab/shared";
import type { ProcessingContext } from "./types";

export type ScanResult = {
  productKey: string;
  frames: Frame[];
  sourceDir: string;
  /**
   * Image files (correct extension) that the scanner couldn't assign a
   * frame index to — typically because the filename didn't match a
   * `FRAME_PATTERN` *and* didn't end in digits. The validator turns
   * these into `naming_error` issues for the merchant.
   */
  skippedFilenames: string[];
};

const DEFAULT_PRODUCT_KEY = "capture";

function parseFilename(
  filename: string,
): { productKey: string; frameIndex: number } | null {
  for (const pattern of FRAME_PATTERNS) {
    const match = filename.match(pattern);
    if (match) {
      return {
        productKey: match[1],
        frameIndex: parseInt(match[2], 10),
      };
    }
  }
  return null;
}

function extractFrameNumber(filename: string): number | null {
  const base = path.basename(filename, path.extname(filename));
  const match = base.match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Walk one flat directory, grouping image files by inferred product key.
 * Used both for top-level files in `sourceDir` and for each immediate
 * subdirectory — same fallback logic everywhere so a merchant's flat-ZIP
 * upload doesn't drop frames the subdirectory branch would have kept.
 */
async function scanFlatDirectory(
  dirPath: string,
  fallbackKey: string,
): Promise<{ grouped: Map<string, Frame[]>; skipped: string[] }> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const grouped = new Map<string, Frame[]>();
  const skipped: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

    const parsed = parseFilename(entry.name);
    const productKey = parsed?.productKey ?? fallbackKey;
    const frameIndex = parsed?.frameIndex ?? extractFrameNumber(entry.name);
    if (frameIndex === null) {
      skipped.push(entry.name);
      continue;
    }

    const frames = grouped.get(productKey) ?? [];
    frames.push({
      filename: entry.name,
      index: frameIndex,
      sourcePath: path.join(dirPath, entry.name),
    });
    grouped.set(productKey, frames);
  }

  return { grouped, skipped };
}

function buildResults(
  grouped: Map<string, Frame[]>,
  sourceDir: string,
  skippedFilenames: string[],
): ScanResult[] {
  const results: ScanResult[] = [];
  for (const [productKey, frames] of grouped) {
    frames.sort((a, b) => a.index - b.index);
    results.push({ productKey, frames, sourceDir, skippedFilenames: [] });
  }
  results.sort((a, b) => a.productKey.localeCompare(b.productKey));

  if (results.length === 0) {
    // Emit a stub so the orchestrator + validator can still surface a
    // skipped-only failure ("everything in the zip had unparseable names").
    return [
      {
        productKey: DEFAULT_PRODUCT_KEY,
        frames: [],
        sourceDir,
        skippedFilenames,
      },
    ];
  }

  // Attribute all skipped filenames to the primary (largest) bucket — they
  // can't be assigned to a productKey, so the bucket the orchestrator picks
  // up "owns" the warning.
  const primary = results.reduce((a, b) =>
    a.frames.length >= b.frames.length ? a : b,
  );
  primary.skippedFilenames = skippedFilenames;
  return results;
}

export async function scanDirectory(
  _ctx: ProcessingContext,
  sourceDir: string,
): Promise<ScanResult[]> {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  const grouped = new Map<string, Frame[]>();
  const skipped: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const sub = await scanFlatDirectory(
        path.join(sourceDir, entry.name),
        entry.name,
      );
      for (const [key, frames] of sub.grouped) {
        const existing = grouped.get(key) ?? [];
        existing.push(...frames);
        grouped.set(key, existing);
      }
      skipped.push(...sub.skipped);
    }
  }

  // Top-level loose files use the same fallback as subdirectories so a flat
  // merchant ZIP (the orchestrator's `extractZip` flattens entries via
  // `path.basename`) doesn't silently drop everything.
  const topLevel = await scanFlatDirectory(sourceDir, DEFAULT_PRODUCT_KEY);
  for (const [key, frames] of topLevel.grouped) {
    const existing = grouped.get(key) ?? [];
    existing.push(...frames);
    grouped.set(key, existing);
  }
  skipped.push(...topLevel.skipped);

  return buildResults(grouped, sourceDir, skipped);
}
