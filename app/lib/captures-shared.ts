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

/**
 * Bucket key for the raw zip a merchant uploads.
 *
 * `folderOrId` is either the merchant-supplied (slugified) folderName or
 * the capture's cuid id as a fallback. The caller decides — pass
 * `capture.folderName ?? capture.id`.
 */
export function rawCaptureKey(shopId: string, folderOrId: string): string {
  return `${shopId}/captures/${folderOrId}/raw.zip`;
}

/** Bucket key prefix for processed frames produced from one capture. */
export function processedFramesKeyPrefix(
  shopId: string,
  folderOrId: string,
): string {
  return `${shopId}/captures/${folderOrId}/frames`;
}

/**
 * Bucket key for an icon uploaded to the merchant's CDN icon library.
 * Keyed by shop + assetId so collisions are impossible even if the
 * merchant uploads two files with the same name. We don't strip the
 * extension — Content-Type sniffing on the storefront prefers a real
 * extension. `safeFilename` should already be slugified (lowercase,
 * a-z0-9_-, max ~64 chars) by the caller.
 */
export function iconLibraryKey(
  shopId: string,
  assetId: string,
  safeFilename: string,
): string {
  return `${shopId}/icons/${assetId}-${safeFilename}`;
}

/** Maximum length of the merchant-supplied folder name. Mirrors the
 *  bucket-key sanity limit and keeps the URL within typical CDN length
 *  caps when combined with the shopId + frames prefix. */
export const FOLDER_NAME_MAX_LENGTH = 64;

/**
 * Normalize an arbitrary merchant string into a URL-safe bucket folder
 * name: lowercase, alphanumeric + hyphen + underscore only, hyphen
 * collapses, max 64 chars. Returns `null` for empty / whitespace-only
 * input so callers can branch on "blank → use captureId fallback."
 *
 * Used in both the client uploader (for live feedback) and the server
 * signRawUpload action (the authoritative slug). Keep the rules in
 * sync — divergence would let the client think a name is valid that
 * the server rejects.
 */
export function slugifyFolderName(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, FOLDER_NAME_MAX_LENGTH);
  return slug.length > 0 ? slug : null;
}
