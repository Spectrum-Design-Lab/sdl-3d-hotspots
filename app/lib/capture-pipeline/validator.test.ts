import { describe, it, expect } from "vitest";
import type { Frame } from "@spectrum-design-lab/shared";
import { parseFilenamesForFrames, validateCaptureFrames } from "./validator";

function frame(index: number, filename = `frame_${String(index).padStart(3, "0")}.jpg`): Frame {
  return {
    filename,
    index,
    sourcePath: `/tmp/${filename}`,
  };
}

function makeFrames(count: number, startAt = 1): Frame[] {
  const out: Frame[] = [];
  for (let i = 0; i < count; i++) out.push(frame(startAt + i));
  return out;
}

describe("validateCaptureFrames — hard-fail floors", () => {
  it("hard-fails when no frames parsed", () => {
    const outcome = validateCaptureFrames("capture", [], { selectedCount: 72 });
    expect(outcome.hardFail).toBe(true);
    expect(outcome.summary).toMatch(/no usable frames/i);
    expect(outcome.report.valid).toBe(false);
    expect(outcome.report.totalFound).toBe(0);
  });

  it("hard-fails when fewer than half the target count", () => {
    const outcome = validateCaptureFrames("capture", makeFrames(20), {
      selectedCount: 72,
    });
    expect(outcome.hardFail).toBe(true);
    expect(outcome.summary).toMatch(/your upload contained 20 frames/i);
    expect(outcome.summary).toMatch(/at least 36 unique source frames/i);
  });

  it("hard-fails at the exact minimum-1 boundary", () => {
    // 72 target → minimum is 36; 35 should hard-fail
    const outcome = validateCaptureFrames("capture", makeFrames(35), {
      selectedCount: 72,
    });
    expect(outcome.hardFail).toBe(true);
  });

  it("passes at the exact minimum boundary", () => {
    const outcome = validateCaptureFrames("capture", makeFrames(36), {
      selectedCount: 72,
    });
    expect(outcome.hardFail).toBe(false);
  });

  it("enforces an absolute minimum of 2 frames regardless of target", () => {
    // selectedCount=2 → ceil(2/2)=1 but the floor is 2; 1 frame should fail.
    const outcome = validateCaptureFrames("capture", makeFrames(1), {
      selectedCount: 2,
    });
    expect(outcome.hardFail).toBe(true);
  });
});

describe("validateCaptureFrames — soft warnings", () => {
  it("returns a clean report when input is perfect", () => {
    const outcome = validateCaptureFrames("capture", makeFrames(72), {
      selectedCount: 72,
    });
    expect(outcome.hardFail).toBe(false);
    expect(outcome.summary).toBeNull();
    expect(outcome.report.valid).toBe(true);
    expect(outcome.report.issues).toHaveLength(0);
  });

  it("warns about duplicate frame indices", () => {
    const frames = [
      ...makeFrames(72),
      frame(5, "duplicate_5.jpg"),
      frame(10, "duplicate_10.jpg"),
    ];
    const outcome = validateCaptureFrames("capture", frames, { selectedCount: 72 });
    expect(outcome.hardFail).toBe(false);
    const dupes = outcome.report.issues.filter((i) => i.type === "duplicate");
    expect(dupes).toHaveLength(2);
    expect(outcome.summary).toMatch(/2 duplicate indexes/);
  });

  it("warns about skipped filenames", () => {
    const outcome = validateCaptureFrames("capture", makeFrames(72), {
      selectedCount: 72,
      skippedFilenames: ["weird-name.jpg", "another.png"],
    });
    expect(outcome.hardFail).toBe(false);
    const naming = outcome.report.issues.filter((i) => i.type === "naming_error");
    expect(naming).toHaveLength(2);
    expect(outcome.summary).toMatch(/2 unparseable filenames skipped/);
  });

  it("caps issues at 51 (50 + one truncation marker)", () => {
    const outcome = validateCaptureFrames("capture", makeFrames(72), {
      selectedCount: 72,
      skippedFilenames: Array.from({ length: 80 }, (_, i) => `bad_${i}.jpg`),
    });
    expect(outcome.report.issues.length).toBeLessThanOrEqual(51);
    const last = outcome.report.issues[outcome.report.issues.length - 1];
    expect(last.message).toMatch(/truncated/i);
  });

  it("does not flag a unique-frame run as duplicate", () => {
    const outcome = validateCaptureFrames("capture", makeFrames(40), {
      selectedCount: 72,
    });
    expect(outcome.report.issues.filter((i) => i.type === "duplicate")).toHaveLength(0);
  });
});

describe("parseFilenamesForFrames — client pre-flight", () => {
  it("parses FRAME_PATTERN filenames", () => {
    const result = parseFilenamesForFrames([
      "MyProduct_frame_001.jpg",
      "MyProduct_frame_002.jpg",
      "MyProduct_frame_003.jpg",
    ]);
    expect(result.frames).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);
    expect(result.frames.map((f) => f.index).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("falls back to trailing digits for non-FRAME_PATTERN names", () => {
    const result = parseFilenamesForFrames(["0001.jpg", "0002.jpg", "0003.jpg"]);
    expect(result.frames).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);
    expect(result.frames.map((f) => f.index)).toEqual([1, 2, 3]);
  });

  it("collects unparseable image filenames as skipped", () => {
    const result = parseFilenamesForFrames([
      "frame_001.jpg",
      "thumbnail.jpg",
      "preview.png",
    ]);
    expect(result.frames).toHaveLength(1);
    expect(result.skipped.sort()).toEqual(["preview.png", "thumbnail.jpg"]);
  });

  it("silently drops files without a supported image extension", () => {
    const result = parseFilenamesForFrames([
      "frame_001.jpg",
      "manifest.json",
      "notes.txt",
    ]);
    expect(result.frames).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it("returns empty Frame.sourcePath (browser has no path)", () => {
    const result = parseFilenamesForFrames(["frame_001.jpg"]);
    expect(result.frames[0].sourcePath).toBe("");
  });

  it("pairs with validateCaptureFrames to hard-fail a small upload", () => {
    const filenames = Array.from({ length: 5 }, (_, i) =>
      `frame_${String(i + 1).padStart(3, "0")}.jpg`,
    );
    const parsed = parseFilenamesForFrames(filenames);
    const outcome = validateCaptureFrames("capture", parsed.frames, {
      selectedCount: 72,
      skippedFilenames: parsed.skipped,
    });
    expect(outcome.hardFail).toBe(true);
    expect(outcome.summary).toMatch(/contained 5 frames/i);
  });
});

describe("validateCaptureFrames — report shape", () => {
  it("records totalFound as the unique-index count, not the raw input length", () => {
    // 72 frames + 3 duplicates of indices 1/2/3 → unique = 72
    const frames = [
      ...makeFrames(72),
      frame(1, "dup_1.jpg"),
      frame(2, "dup_2.jpg"),
      frame(3, "dup_3.jpg"),
    ];
    const outcome = validateCaptureFrames("capture", frames, { selectedCount: 72 });
    expect(outcome.report.totalFound).toBe(72);
  });

  it("preserves the productKey passed in", () => {
    const outcome = validateCaptureFrames("PRD-0042", makeFrames(72), {
      selectedCount: 72,
    });
    expect(outcome.report.productKey).toBe("PRD-0042");
  });

  it("stamps a parseable ISO timestamp", () => {
    const outcome = validateCaptureFrames("capture", makeFrames(72), {
      selectedCount: 72,
    });
    expect(() => new Date(outcome.report.timestamp).toISOString()).not.toThrow();
  });
});
