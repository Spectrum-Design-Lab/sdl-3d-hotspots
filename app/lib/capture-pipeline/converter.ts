import sharp from "sharp";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { Frame, ImageFormat } from "@spectrum-design-lab/shared";
import type { ProcessingContext } from "./types";

export type ConvertOptions = {
  format: ImageFormat;
  quality: number;
  outputDir: string;
  /** Subfolder name inside `outputDir` (typically the capture id). */
  productFolder: string;
  /** Parallel sharp jobs (defaults to 4). */
  concurrency?: number;
};

async function convertFrame(
  frame: Frame,
  index: number,
  opts: ConvertOptions,
): Promise<Frame> {
  const outDir = path.join(opts.outputDir, opts.productFolder);
  await mkdir(outDir, { recursive: true });

  const ext = opts.format === "jpg" ? "jpg" : opts.format;
  const outFilename = `frame_${String(index + 1).padStart(3, "0")}.${ext}`;
  const outputPath = path.join(outDir, outFilename);

  const pipeline = sharp(frame.sourcePath);
  switch (opts.format) {
    case "webp":
      await pipeline.webp({ quality: opts.quality }).toFile(outputPath);
      break;
    case "jpg":
      await pipeline
        .jpeg({ quality: opts.quality, mozjpeg: true })
        .toFile(outputPath);
      break;
    case "png":
      await pipeline
        .png({ compressionLevel: Math.round((100 - opts.quality) / 10) })
        .toFile(outputPath);
      break;
  }

  return { ...frame, outputPath };
}

/**
 * Convert all selected frames to the target format on local disk.
 * Returns frames with `outputPath` pointing at the converted file.
 */
export async function convertFrames(
  _ctx: ProcessingContext,
  frames: Frame[],
  opts: ConvertOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<Frame[]> {
  const concurrency = opts.concurrency ?? 4;
  const results: Frame[] = new Array(frames.length);
  let completed = 0;

  for (let i = 0; i < frames.length; i += concurrency) {
    const batch = frames.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((frame, batchIdx) =>
        convertFrame(frame, i + batchIdx, opts),
      ),
    );
    for (let j = 0; j < batchResults.length; j++) {
      results[i + j] = batchResults[j];
    }
    completed += batchResults.length;
    onProgress?.(completed, frames.length);
  }

  return results;
}
