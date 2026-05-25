import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { scanDirectory } from "./scanner";
import type { ProcessingContext } from "./types";

// scanDirectory only uses ctx for the type signature today — it never reads
// from it. A minimal stub keeps the test independent of the production
// ProcessingContext shape (storage / shopify / prisma).
const ctx = {} as unknown as ProcessingContext;

async function makeImage(filePath: string): Promise<void> {
  // Smallest valid JPEG payload — we just need the bytes on disk; scanner
  // only looks at the filename + extension.
  await writeFile(filePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
}

describe("scanDirectory — flat zip layout (orchestrator's normal case)", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "scanner-test-"));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("parses frame_NNN.jpg in a flat dir", async () => {
    for (let i = 1; i <= 5; i++) {
      await makeImage(
        path.join(tempDir, `frame_${String(i).padStart(3, "0")}.jpg`),
      );
    }
    const results = await scanDirectory(ctx, tempDir);
    expect(results).toHaveLength(1);
    expect(results[0].frames).toHaveLength(5);
    expect(results[0].skippedFilenames).toHaveLength(0);
  });

  it("falls back to trailing digits when no FRAME_PATTERN matches", async () => {
    // `001.jpg` doesn't match any FRAME_PATTERN (they all require a
    // separator) — the top-level branch used to drop these silently.
    for (let i = 1; i <= 3; i++) {
      await makeImage(
        path.join(tempDir, `${String(i).padStart(3, "0")}.jpg`),
      );
    }
    const results = await scanDirectory(ctx, tempDir);
    expect(results).toHaveLength(1);
    expect(results[0].frames).toHaveLength(3);
    expect(results[0].frames.map((f) => f.index).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(results[0].skippedFilenames).toHaveLength(0);
  });

  it("records filenames with no inferable frame index as skipped", async () => {
    await makeImage(path.join(tempDir, "frame_001.jpg"));
    await makeImage(path.join(tempDir, "frame_002.jpg"));
    await makeImage(path.join(tempDir, "thumbnail.jpg")); // no digits
    await makeImage(path.join(tempDir, "preview.png")); // no digits

    const results = await scanDirectory(ctx, tempDir);
    expect(results).toHaveLength(1);
    expect(results[0].frames).toHaveLength(2);
    expect(results[0].skippedFilenames.sort()).toEqual([
      "preview.png",
      "thumbnail.jpg",
    ]);
  });

  it("returns a stub result when every file is skipped", async () => {
    await makeImage(path.join(tempDir, "thumbnail.jpg"));
    await makeImage(path.join(tempDir, "preview.png"));
    const results = await scanDirectory(ctx, tempDir);
    expect(results).toHaveLength(1);
    expect(results[0].frames).toHaveLength(0);
    expect(results[0].skippedFilenames).toHaveLength(2);
  });
});

describe("scanDirectory — nested subdirectory layout", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "scanner-test-nested-"));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("groups subdirectory frames under the folder name as the productKey", async () => {
    const subDir = path.join(tempDir, "MyProduct");
    await mkdir(subDir);
    for (let i = 1; i <= 4; i++) {
      await makeImage(path.join(subDir, `${String(i).padStart(3, "0")}.jpg`));
    }
    const results = await scanDirectory(ctx, tempDir);
    expect(results).toHaveLength(1);
    expect(results[0].productKey).toBe("MyProduct");
    expect(results[0].frames).toHaveLength(4);
  });

  it("attributes skipped filenames from a nested dir to the primary bucket", async () => {
    const subDir = path.join(tempDir, "MyProduct");
    await mkdir(subDir);
    await makeImage(path.join(subDir, "001.jpg"));
    await makeImage(path.join(subDir, "002.jpg"));
    await makeImage(path.join(subDir, "logo.jpg"));
    const results = await scanDirectory(ctx, tempDir);
    expect(results).toHaveLength(1);
    expect(results[0].frames).toHaveLength(2);
    expect(results[0].skippedFilenames).toEqual(["logo.jpg"]);
  });
});

describe("scanDirectory — non-image extensions", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "scanner-test-ext-"));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("ignores files without a supported extension entirely (not skipped, not counted)", async () => {
    await makeImage(path.join(tempDir, "frame_001.jpg"));
    await writeFile(path.join(tempDir, "metadata.json"), "{}");
    await writeFile(path.join(tempDir, "notes.txt"), "ignore me");
    const results = await scanDirectory(ctx, tempDir);
    expect(results).toHaveLength(1);
    expect(results[0].frames).toHaveLength(1);
    expect(results[0].skippedFilenames).toHaveLength(0);
  });
});
