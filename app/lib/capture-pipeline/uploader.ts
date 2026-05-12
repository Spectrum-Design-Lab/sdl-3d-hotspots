import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Frame } from "@spectrum-design-lab/shared";
import type { ProcessingContext } from "./types";

export type UploadOptions = {
  /**
   * Bucket key prefix the frames are placed under, e.g.
   *   `<shopId>/captures/<captureId>/frames`
   * Concrete key per frame is `${keyPrefix}/${basename(outputPath)}`.
   */
  keyPrefix: string;
  /**
   * Public CDN base URL for the bucket. Falls back to
   * `ctx.storage.publicBaseUrl` if omitted. Required either way — the
   * pipeline must produce absolute storefront-reachable URLs.
   */
  publicBaseUrl?: string | null;
  /** Parallel uploads (defaults to 6). */
  concurrency?: number;
};

export type UploadResult = {
  /** Frames with `outputPath` rewritten to the public CDN URL. */
  frames: Frame[];
  /** `${publicBaseUrl}/${keyPrefix}` — useful for callers logging "all frames live here". */
  cdnBaseUrl: string;
  /** Number of files uploaded. */
  uploadedCount: number;
};

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".webp":
      return "image/webp";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".glb":
      return "model/gltf-binary";
    default:
      return "application/octet-stream";
  }
}

function resolvePublicBaseUrl(
  ctx: ProcessingContext,
  override?: string | null,
): string {
  const candidate = (override ?? ctx.storage.publicBaseUrl ?? "").trim();
  if (!candidate) {
    throw new Error(
      "uploader: publicBaseUrl not set on ShopStorage and not overridden — set it under Storage settings.",
    );
  }
  return candidate.replace(/\/$/, "");
}

async function uploadFrame(
  ctx: ProcessingContext,
  frame: Frame,
  opts: UploadOptions,
  publicBase: string,
): Promise<Frame> {
  if (!frame.outputPath) {
    throw new Error(
      `Frame ${frame.filename} has no outputPath — convert before uploading.`,
    );
  }

  const body = await readFile(frame.outputPath);
  const filename = path.basename(frame.outputPath);
  const key = `${opts.keyPrefix.replace(/\/$/, "")}/${filename}`;

  await ctx.storage.putObject(key, body, getContentType(frame.outputPath));

  return { ...frame, outputPath: `${publicBase}/${key}` };
}

/**
 * Upload converted frames to the merchant's bucket via `ctx.storage`.
 * Returns frames with `outputPath` rewritten to absolute public URLs.
 */
export async function uploadFrames(
  ctx: ProcessingContext,
  frames: Frame[],
  opts: UploadOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<UploadResult> {
  const publicBase = resolvePublicBaseUrl(ctx, opts.publicBaseUrl);
  const concurrency = opts.concurrency ?? 6;
  const results: Frame[] = new Array(frames.length);
  let completed = 0;

  for (let i = 0; i < frames.length; i += concurrency) {
    const batch = frames.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((frame) => uploadFrame(ctx, frame, opts, publicBase)),
    );
    for (let j = 0; j < batchResults.length; j++) {
      results[i + j] = batchResults[j];
    }
    completed += batchResults.length;
    onProgress?.(completed, frames.length);
  }

  const keyPrefix = opts.keyPrefix.replace(/\/$/, "");
  return {
    frames: results,
    cdnBaseUrl: `${publicBase}/${keyPrefix}`,
    uploadedCount: results.length,
  };
}

/**
 * Upload a .glb 3D model. Stored at `${keyPrefix}/model.glb` and returns the
 * absolute public URL.
 */
export async function uploadModel(
  ctx: ProcessingContext,
  fileBuffer: Buffer,
  opts: UploadOptions,
): Promise<{ modelUrl: string; fileSize: number }> {
  const publicBase = resolvePublicBaseUrl(ctx, opts.publicBaseUrl);
  const key = `${opts.keyPrefix.replace(/\/$/, "")}/model.glb`;

  await ctx.storage.putObject(key, fileBuffer, "model/gltf-binary");

  return {
    modelUrl: `${publicBase}/${key}`,
    fileSize: fileBuffer.length,
  };
}
