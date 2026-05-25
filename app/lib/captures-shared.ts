/**
 * Capture-lifecycle constants shared between server (api.sdl3d.captures.tsx,
 * orchestrator) and client (editor uploader UI). Must stay free of any
 * `.server`-only imports.
 *
 *   PENDING     row created, signed URL minted, browser hasn't started PUT yet
 *   UPLOADING   client-reported progress while the browser PUTs to the bucket
 *   QUEUED      recordRawUpload called; pg-boss job enqueued
 *   PROCESSING  worker picked the job up (past idempotency check)
 *   COMPLETED   pipeline finished, frames live, imageSequenceJson written
 *   FAILED      anything threw; errorMessage holds the surface text
 *   CANCELLED   (Slice 9 PR #3) merchant called cancel; orchestrator bails
 *               between heavy steps. Distinct from FAILED so the dead-letter
 *               UI can separate "merchant changed their mind" from "we
 *               broke." Never auto-retried.
 */
export const CAPTURE_STATUSES = [
  "PENDING",
  "UPLOADING",
  "QUEUED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type CaptureStatus = (typeof CAPTURE_STATUSES)[number];

export const CAPTURE_TERMINAL_STATUSES: ReadonlySet<CaptureStatus> = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export function isTerminalStatus(status: string): boolean {
  return CAPTURE_TERMINAL_STATUSES.has(status as CaptureStatus);
}

/** Default target frame count (matches `DEFAULT_PIPELINE.selectedFrames`). */
export const DEFAULT_FRAME_COUNT_TARGET = 72;

/** Bucket key for the raw zip a merchant uploads. */
export function rawCaptureKey(shopId: string, captureId: string): string {
  return `${shopId}/captures/${captureId}/raw.zip`;
}

/** Bucket key prefix for processed frames produced from one capture. */
export function processedFramesKeyPrefix(
  shopId: string,
  captureId: string,
): string {
  return `${shopId}/captures/${captureId}/frames`;
}
