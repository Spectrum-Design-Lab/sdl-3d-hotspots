/**
 * Pre-flight validation for a freshly-scanned capture. Runs *before* the
 * heavy sharp conversion + bucket upload so the merchant sees actionable
 * problems within seconds instead of after a 30–60 s pipeline failure.
 *
 * Two classes of issue:
 *   - **hardFail** — orchestrator marks the Capture FAILED and stops. The
 *     `summary` becomes the merchant-facing `errorMessage`. Reserved for
 *     "we literally cannot produce a turntable from this input."
 *   - **soft-warn** — orchestrator persists the report into
 *     `Capture.validationJson` and keeps going. The uploader UI renders
 *     the issues alongside the success banner ("72 frames live; 3 duplicate
 *     frame indices were de-duped, 1 file was skipped").
 *
 * Shape stays compatible with `ValidationReport` from
 * `@spectrum-design-lab/shared` so the same wire format works between the
 * unified app, sdl-platform's ops dashboard, and any future tooling.
 */
import {
  FRAME_PATTERNS,
  SUPPORTED_EXTENSIONS,
  type Frame,
  type ValidationIssue,
  type ValidationReport,
} from "@spectrum-design-lab/shared";

/**
 * Pure-logic mirror of the scanner's filename parsing — kept here so it can
 * run in the browser (no fs imports) for pre-flight validation in the
 * uploader UI. Server-side scanner uses the same FRAME_PATTERNS + trailing-
 * digit fallback so a file the merchant sees pass pre-flight will also
 * parse on the worker.
 */
function parseFrameFromFilename(
  filename: string,
): { productKey: string; index: number } | null {
  for (const pattern of FRAME_PATTERNS) {
    const match = filename.match(pattern);
    if (match) {
      return { productKey: match[1], index: parseInt(match[2], 10) };
    }
  }
  const dot = filename.lastIndexOf(".");
  const base = dot === -1 ? filename : filename.slice(0, dot);
  const trailing = base.match(/(\d+)$/);
  if (trailing) {
    return { productKey: "capture", index: parseInt(trailing[1], 10) };
  }
  return null;
}

export type ParsedFrameSet = {
  frames: Frame[];
  /** Image-extension files we couldn't assign a frame index to. */
  skipped: string[];
};

/**
 * Client-side equivalent of `scanDirectory` for a flat list of filenames
 * (typically the basenames from a `FileList`). Discards files without a
 * supported image extension; collects unparseable ones into `skipped`.
 *
 * Returns Frames with `sourcePath: ""` since the browser has no path —
 * the validator only reads `filename` + `index`, so this is harmless.
 */
export function parseFilenamesForFrames(filenames: string[]): ParsedFrameSet {
  const frames: Frame[] = [];
  const skipped: string[] = [];

  for (const filename of filenames) {
    const dot = filename.lastIndexOf(".");
    const ext = dot === -1 ? "" : filename.slice(dot).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

    const parsed = parseFrameFromFilename(filename);
    if (!parsed) {
      skipped.push(filename);
      continue;
    }

    frames.push({ filename, index: parsed.index, sourcePath: "" });
  }

  return { frames, skipped };
}

export type CaptureValidationOptions = {
  /** Number of frames the sampler will pick. Sets the hard-fail floor. */
  selectedCount: number;
  /**
   * Image files (correct extension) the scanner couldn't assign a frame
   * index to. Surfaced as `naming_error` issues so the merchant knows
   * which filenames to rename.
   */
  skippedFilenames?: string[];
};

export type CaptureValidationOutcome = {
  report: ValidationReport;
  /** True ⇒ orchestrator should mark Capture FAILED and skip convert/upload. */
  hardFail: boolean;
  /** One-line summary for `Capture.errorMessage` (hard-fail) or status banner (warn). */
  summary: string | null;
};

const ISSUES_DISPLAY_CAP = 50;

export function validateCaptureFrames(
  productKey: string,
  frames: Frame[],
  opts: CaptureValidationOptions,
): CaptureValidationOutcome {
  const { selectedCount, skippedFilenames = [] } = opts;
  const issues: ValidationIssue[] = [];

  const byIndex = new Map<number, Frame[]>();
  for (const frame of frames) {
    const list = byIndex.get(frame.index) ?? [];
    list.push(frame);
    byIndex.set(frame.index, list);
  }

  for (const [index, dupes] of byIndex) {
    if (dupes.length > 1) {
      issues.push({
        type: "duplicate",
        frameIndex: index,
        filename: dupes.map((d) => d.filename).join(", "),
        message: `Frame index ${index} appears ${dupes.length} times — only one copy will be used.`,
      });
    }
  }

  for (const filename of skippedFilenames) {
    issues.push({
      type: "naming_error",
      filename,
      message: `Could not infer a frame number from "${filename}" — file was skipped. Frame filenames should end with a sequence number (e.g. \`frame_001.jpg\`).`,
    });
  }

  const uniqueCount = byIndex.size;
  const minimumViable = Math.max(2, Math.ceil(selectedCount / 2));

  let hardFail = false;
  let summary: string | null = null;

  if (uniqueCount === 0) {
    hardFail = true;
    summary =
      `No usable frames in this upload. Frame filenames need to end with a sequence number — e.g. \`frame_001.jpg\` or \`shot-072.png\`. Rename the files and re-upload.`;
  } else if (uniqueCount < minimumViable) {
    hardFail = true;
    const frameWord = uniqueCount === 1 ? "frame" : "frames";
    summary =
      `Your upload contained ${uniqueCount} ${frameWord}, but a ${selectedCount}-frame turntable needs at least ${minimumViable} unique source frames to look smooth. Add more frames to the same capture and re-upload.`;
  } else if (issues.length > 0) {
    const dupeCount = issues.filter((i) => i.type === "duplicate").length;
    const namingCount = issues.filter((i) => i.type === "naming_error").length;
    const parts: string[] = [];
    if (dupeCount > 0) {
      parts.push(`${dupeCount} duplicate index${dupeCount === 1 ? "" : "es"}`);
    }
    if (namingCount > 0) {
      parts.push(
        `${namingCount} unparseable filename${namingCount === 1 ? "" : "s"} skipped`,
      );
    }
    summary = `Proceeded with ${uniqueCount} unique frames (${parts.join(", ")}).`;
  }

  const cappedIssues: ValidationIssue[] =
    issues.length > ISSUES_DISPLAY_CAP
      ? [
          ...issues.slice(0, ISSUES_DISPLAY_CAP),
          {
            type: "naming_error",
            message: `…and ${issues.length - ISSUES_DISPLAY_CAP} more issues truncated for display.`,
          },
        ]
      : issues;

  return {
    report: {
      productKey,
      totalExpected: selectedCount,
      totalFound: uniqueCount,
      missingCount: 0,
      issues: cappedIssues,
      valid: !hardFail && issues.length === 0,
      timestamp: new Date().toISOString(),
    },
    hardFail,
    summary,
  };
}
