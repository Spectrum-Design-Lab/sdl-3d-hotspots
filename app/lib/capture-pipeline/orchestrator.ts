/**
 * Real `processCapture` job body — runs inside the worker process.
 *
 * Pipeline:
 *   1. Idempotently claim the job (QUEUED → PROCESSING). Bail if someone else
 *      already grabbed it, or if the capture is already terminal. Protects
 *      against pg-boss double-delivery (e.g. a timed-out worker resurrecting).
 *   2. Load Capture + ProductConfig + ShopStorage + Shopify admin client.
 *   3. Download raw.zip from the merchant's bucket (signed GET via the
 *      configured StorageBackend).
 *   4. Extract into a temp dir, scan frames, evenly-sample to the target count,
 *      run sharp conversion, upload converted frames back to the bucket under
 *      `<shopId>/captures/<id>/frames/`.
 *   5. Write the resulting frame array into `ProductConfig.imageSequenceJson`
 *      (with `viewerType = IMAGE_360`).
 *   6. Mark Capture COMPLETED + frameCountActual. On throw, FAILED +
 *      errorMessage.
 */
import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { PrismaClient } from "@prisma/client";
import { DEFAULT_PIPELINE, SUPPORTED_EXTENSIONS } from "@spectrum-design-lab/shared";
import prisma from "../../db.server";
import {
  loadDefaultStorageForShop,
  loadStorageForShopById,
  IMMUTABLE_CACHE_CONTROL,
} from "../storage.server";
import shopify from "../../shopify.server";
import type { AdminGraphqlClient } from "../sdl3d-graphql.server";
import {
  processedFramesKeyPrefix,
  type CaptureStatus,
} from "../captures-shared";
import type { ImageSequenceFrame } from "../sdl3d-shared";
import type { ProcessingContext } from "./types";
import { scanDirectory } from "./scanner";
import { sampleFrames } from "./sampler";
import { convertFrames } from "./converter";
import { uploadFrames } from "./uploader";
import { validateCaptureFrames } from "./validator";

/** Job payload pushed onto pg-boss by API actions or smoke tests. */
export type ProcessCaptureJobData = {
  shopId: string;
  captureId: string;
};

/** Streamed `getObject` body → Buffer. */
async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/** Extract zip contents into `destDir`, returning the list of relative files written. */
async function extractZip(zipBuffer: Buffer, destDir: string): Promise<string[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(zipBuffer);
  const written: string[] = [];

  await Promise.all(
    Object.entries(zip.files).map(async ([relPath, entry]) => {
      if (entry.dir) return;
      // Drop common macOS metadata noise that scanner would skip anyway.
      if (relPath.includes("__MACOSX") || path.basename(relPath).startsWith("._")) return;
      const ext = path.extname(relPath).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) return;
      const out = path.join(destDir, path.basename(relPath));
      const buf = await entry.async("nodebuffer");
      await writeFile(out, buf);
      written.push(out);
    }),
  );

  return written;
}

/**
 * Atomic claim — only transitions QUEUED/PENDING/UPLOADING → PROCESSING.
 * Returns true if we won the race. Slice 9 PR #3 bumps `attempts` on every
 * successful claim so the dashboard can surface retry counts without
 * peeking at pg-boss internals; also explicitly excludes CANCELLED so a
 * merchant-cancelled capture never re-enters the pipeline if pg-boss
 * happens to re-deliver the job during the cancel window.
 */
async function claimCapture(
  ctx: PrismaClient,
  captureId: string,
): Promise<boolean> {
  const result = await ctx.capture.updateMany({
    where: {
      id: captureId,
      status: { in: ["QUEUED", "PENDING", "UPLOADING"] },
      cancelledAt: null,
    },
    data: {
      status: "PROCESSING",
      startedAt: new Date(),
      errorMessage: null,
      attempts: { increment: 1 },
    },
  });
  return result.count > 0;
}

/**
 * Re-read the capture row mid-pipeline to honor merchant cancellation. Each
 * heavy step (extract, validate, sample, convert, upload, write) calls this
 * first and bails out cleanly if `cancelledAt` was set after the claim. We
 * mark `completedAt` so the dead-letter UI can sort cancelled rows by when
 * they stopped, not when they started.
 */
async function isCancelled(
  ctx: PrismaClient,
  captureId: string,
): Promise<boolean> {
  const row = await ctx.capture.findUnique({
    where: { id: captureId },
    select: { cancelledAt: true, status: true },
  });
  if (!row) return true; // row vanished — treat as cancelled to bail out safely
  return row.cancelledAt !== null || row.status === "CANCELLED";
}

async function finaliseCancelled(
  ctx: PrismaClient,
  captureId: string,
): Promise<void> {
  await ctx.capture.update({
    where: { id: captureId },
    data: {
      status: "CANCELLED",
      completedAt: new Date(),
    },
  });
  console.log(`[capture-pipeline] capture ${captureId} cancelled mid-pipeline; bailing out.`);
}

async function markFailed(
  ctx: PrismaClient,
  captureId: string,
  errorMessage: string,
  validationJson?: string | null,
): Promise<void> {
  await ctx.capture.update({
    where: { id: captureId },
    data: {
      status: "FAILED",
      errorMessage,
      completedAt: new Date(),
      ...(validationJson !== undefined ? { validationJson } : {}),
    },
  });
}

/**
 * Run the capture-processing pipeline. Caller is responsible for setting up
 * the `ProcessingContext` (storage, shopify, prisma) bound to the right shop.
 *
 * Top-level errors are caught and surfaced as `Capture.status = FAILED` with
 * `errorMessage` set — the worker handler should NOT re-throw, since pg-boss
 * would otherwise re-deliver the same broken job indefinitely.
 */
export async function processCapture(
  ctx: ProcessingContext,
  captureId: string,
): Promise<void> {
  const claimed = await claimCapture(ctx.prisma, captureId);
  const current = await ctx.prisma.capture.findUnique({ where: { id: captureId } });
  if (!current) {
    console.warn(`[capture-pipeline] capture ${captureId} not found; nothing to do.`);
    return;
  }
  if (!claimed) {
    const status = current.status as CaptureStatus;
    console.log(
      `[capture-pipeline] capture ${captureId} not claimable (status=${status}); skipping.`,
    );
    return;
  }

  const capture = current;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), `sdl3d-capture-${captureId}-`));
  const rawDir = path.join(tempDir, "raw");
  const convertedDir = path.join(tempDir, "converted");
  await mkdir(rawDir, { recursive: true });
  await mkdir(convertedDir, { recursive: true });

  try {
    const config = await ctx.prisma.productConfig.findUnique({
      where: { id: capture.productConfigId },
    });
    if (!config) {
      throw new Error(`ProductConfig ${capture.productConfigId} not found.`);
    }

    if (await isCancelled(ctx.prisma, captureId)) {
      await finaliseCancelled(ctx.prisma, captureId);
      return;
    }

    // 1. Download raw.zip from merchant bucket.
    const stream = await ctx.storage.getObject(capture.rawKey);
    const zipBuffer = await streamToBuffer(stream as NodeJS.ReadableStream);

    if (await isCancelled(ctx.prisma, captureId)) {
      await finaliseCancelled(ctx.prisma, captureId);
      return;
    }

    // 2. Extract into temp dir.
    const extracted = await extractZip(zipBuffer, rawDir);
    if (extracted.length === 0) {
      throw new Error(
        "Raw zip contained no supported image files. Expected .jpg/.jpeg/.png/.webp (single folder of turntable frames).",
      );
    }

    // 3. Scan → group by product key. For captures we always take the largest
    //    group (a single product per zip — merchant uploads one product at a
    //    time via the editor UI).
    const scans = await scanDirectory(ctx, rawDir);
    if (scans.length === 0) {
      throw new Error("Scanner found no parseable frames in the raw zip.");
    }
    const primary = scans.reduce((a, b) => (a.frames.length >= b.frames.length ? a : b));

    // 3b. Pre-flight validation. Runs *before* the heavy sharp + upload steps
    //     so a merchant gets an actionable error in seconds instead of after
    //     a full pipeline cycle. Hard-fail cases (no parseable frames, fewer
    //     than half the target count) short-circuit with the validator's
    //     summary as the capture's errorMessage. Soft-warns (duplicates,
    //     unparseable filenames the scanner skipped) get persisted into
    //     validationJson and the pipeline proceeds.
    const selectedCount =
      capture.frameCountTarget || DEFAULT_PIPELINE.selectedFrames;
    const validation = validateCaptureFrames(primary.productKey, primary.frames, {
      selectedCount,
      skippedFilenames: primary.skippedFilenames,
    });
    const validationJson = JSON.stringify(validation.report);
    if (validation.hardFail) {
      await markFailed(
        ctx.prisma,
        captureId,
        validation.summary ??
          "Validation failed: capture input could not be processed.",
        validationJson,
      );
      return;
    }

    // 4. Sample evenly to the target frame count.
    const sampled = sampleFrames(ctx, primary.frames, {
      totalFrames: DEFAULT_PIPELINE.totalFrames,
      selectedCount,
    });
    if (sampled.length === 0) {
      throw new Error("Sampler returned 0 frames — raw set was empty or unparseable.");
    }

    if (await isCancelled(ctx.prisma, captureId)) {
      await finaliseCancelled(ctx.prisma, captureId);
      return;
    }

    // 5. Convert with sharp.
    const converted = await convertFrames(ctx, sampled, {
      format: DEFAULT_PIPELINE.outputFormat,
      quality: DEFAULT_PIPELINE.quality,
      outputDir: convertedDir,
      productFolder: captureId,
      concurrency: 4,
    });

    if (await isCancelled(ctx.prisma, captureId)) {
      await finaliseCancelled(ctx.prisma, captureId);
      return;
    }

    // 6. Upload converted frames back to the merchant's bucket.
    const keyPrefix = processedFramesKeyPrefix(ctx.shopId, captureId);
    const uploaded = await uploadFrames(ctx, converted, { keyPrefix });

    // 7. Write imageSequenceJson into the ProductConfig.
    const frames: ImageSequenceFrame[] = uploaded.frames.map((f, i) => ({
      index: i,
      imageUrl: f.outputPath ?? "",
    }));
    if (frames.some((f) => !f.imageUrl)) {
      throw new Error("uploader returned a frame with no public URL.");
    }
    await ctx.prisma.productConfig.update({
      where: { id: config.id },
      data: {
        viewerType: "IMAGE_360",
        imageSequenceJson: JSON.stringify(frames),
        frameCount: frames.length,
      },
    });

    // 8. Write a small processed manifest alongside the frames. Nothing in the
    //    app reads this today, but it makes the bucket self-describing for
    //    cli-360 / debug tooling, and lets us track which capture produced
    //    which set of frames after the fact.
    const manifestKey = `${keyPrefix}/manifest.json`;
    const manifest = {
      captureId,
      shopId: ctx.shopId,
      productConfigId: config.id,
      frameCount: frames.length,
      cdnBaseUrl: uploaded.cdnBaseUrl,
      frames: frames.map((f) => f.imageUrl),
      producedAt: new Date().toISOString(),
    };
    await ctx.storage.putObject(
      manifestKey,
      JSON.stringify(manifest, null, 2),
      {
        contentType: "application/json",
        acl: "public-read",
        cacheControl: IMMUTABLE_CACHE_CONTROL,
      },
    );

    await ctx.prisma.capture.update({
      where: { id: captureId },
      data: {
        status: "COMPLETED",
        frameCountActual: frames.length,
        processedManifestKey: manifestKey,
        completedAt: new Date(),
        // Persist the soft-warn report only — clean runs leave the column
        // null so the UI can show a plain "all good" banner.
        ...(validation.report.issues.length > 0 ? { validationJson } : {}),
        ...((capture.rawSizeBytes ?? 0) === 0
          ? { rawSizeBytes: zipBuffer.byteLength }
          : {}),
      },
    });

    console.log(
      `[capture-pipeline] capture ${captureId} completed: ${frames.length} frames at ${uploaded.cdnBaseUrl}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[capture-pipeline] capture ${captureId} FAILED:`, message);
    await markFailed(ctx.prisma, captureId, message);
    // Intentionally not re-thrown — see jsdoc on this function.
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Worker job entrypoint. Builds the `ProcessingContext` for the target shop
 * and delegates to `processCapture`. Separated so an API action that runs the
 * pipeline inline (e.g. for tests) can call `processCapture` directly with a
 * pre-built context.
 */
export async function runProcessCaptureJob(
  data: ProcessCaptureJobData,
): Promise<void> {
  // Prefer the storage row stamped on the capture at signRawUpload time so we
  // pull raw.zip from the bucket the merchant uploaded *to*, even if they've
  // since flipped the shop's default to a different provider. Pre-5B captures
  // have no storageId, so we fall back to the current default.
  const captureRow = await prisma.capture.findUnique({
    where: { id: data.captureId },
    select: { storageId: true },
  });
  if (!captureRow) {
    console.warn(`[capture-pipeline] capture ${data.captureId} not found; nothing to do.`);
    return;
  }

  let storage = captureRow.storageId
    ? await loadStorageForShopById(data.shopId, captureRow.storageId)
    : null;

  if (!storage && captureRow.storageId) {
    // Stamped storage row was deleted (or pointed at a different shop). Fail
    // loud rather than silently moving bytes to a different bucket — the
    // merchant must reconfigure or delete the capture.
    await markFailed(
      prisma,
      data.captureId,
      `This capture's storage provider has been removed. Re-create the provider with the same bucket to retry, or delete the capture.`,
    );
    return;
  }

  if (!storage) {
    storage = await loadDefaultStorageForShop(data.shopId);
  }

  if (!storage) {
    await markFailed(
      prisma,
      data.captureId,
      `No ShopStorage row for shopId=${data.shopId}; merchant has not configured a bucket. Open Settings → Storage to connect one.`,
    );
    return;
  }

  const shopRow = await prisma.shop.findUnique({ where: { id: data.shopId } });
  if (!shopRow) {
    await markFailed(prisma, data.captureId, `Shop row ${data.shopId} not found.`);
    return;
  }

  const adminClient = await buildAdminClientForShop(shopRow.shopDomain, data.captureId);
  if (!adminClient) return; // markFailed already called

  const ctx: ProcessingContext = {
    shopId: data.shopId,
    storage,
    shopify: adminClient,
    prisma,
  };

  await processCapture(ctx, data.captureId);
}

async function buildAdminClientForShop(
  shopDomain: string,
  captureId: string,
): Promise<AdminGraphqlClient | null> {
  try {
    const { admin } = await shopify.unauthenticated.admin(shopDomain);
    return admin;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(
      prisma,
      captureId,
      `Could not build Shopify admin client for ${shopDomain}: ${message}. The merchant may need to re-install the app.`,
    );
    return null;
  }
}
