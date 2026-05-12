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
};

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

async function scanSubDirectory(
  dirPath: string,
  folderName: string,
): Promise<Map<string, Frame[]>> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const grouped = new Map<string, Frame[]>();

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

    const parsed = parseFilename(entry.name);
    const productKey = parsed?.productKey ?? folderName;
    const frameIndex = parsed?.frameIndex ?? extractFrameNumber(entry.name);
    if (frameIndex === null) continue;

    const frames = grouped.get(productKey) ?? [];
    frames.push({
      filename: entry.name,
      index: frameIndex,
      sourcePath: path.join(dirPath, entry.name),
    });
    grouped.set(productKey, frames);
  }

  return grouped;
}

function buildResults(
  grouped: Map<string, Frame[]>,
  sourceDir: string,
): ScanResult[] {
  const results: ScanResult[] = [];
  for (const [productKey, frames] of grouped) {
    frames.sort((a, b) => a.index - b.index);
    results.push({ productKey, frames, sourceDir });
  }
  results.sort((a, b) => a.productKey.localeCompare(b.productKey));
  return results;
}

export async function scanDirectory(
  _ctx: ProcessingContext,
  sourceDir: string,
): Promise<ScanResult[]> {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  const grouped = new Map<string, Frame[]>();

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const subResults = await scanSubDirectory(
        path.join(sourceDir, entry.name),
        entry.name,
      );
      for (const [key, frames] of subResults) {
        const existing = grouped.get(key) ?? [];
        existing.push(...frames);
        grouped.set(key, existing);
      }
      continue;
    }

    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

    const parsed = parseFilename(entry.name);
    if (!parsed) continue;

    const frames = grouped.get(parsed.productKey) ?? [];
    frames.push({
      filename: entry.name,
      index: parsed.frameIndex,
      sourcePath: path.join(sourceDir, entry.name),
    });
    grouped.set(parsed.productKey, frames);
  }

  return buildResults(grouped, sourceDir);
}
