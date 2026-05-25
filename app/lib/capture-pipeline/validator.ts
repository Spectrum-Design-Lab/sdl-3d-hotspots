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
import type {
  Frame,
  ValidationIssue,
  ValidationReport,
} from "@spectrum-design-lab/shared";

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
      `No frames could be parsed from the upload. Frame filenames should end with a sequence number (e.g. \`frame_001.jpg\` or \`shot-072.png\`). Rename the files and re-upload.`;
  } else if (uniqueCount < minimumViable) {
    hardFail = true;
    summary =
      `Only ${uniqueCount} parseable frame${uniqueCount === 1 ? "" : "s"} — need at least ${minimumViable} for a smooth ${selectedCount}-frame turntable. Add more frames and re-upload.`;
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
