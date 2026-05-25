import { describe, it, expect } from "vitest";
import {
  slugifyFolderName,
  rawCaptureKey,
  processedFramesKeyPrefix,
  FOLDER_NAME_MAX_LENGTH,
} from "./captures-shared";

describe("slugifyFolderName", () => {
  it("returns null for empty / whitespace input", () => {
    expect(slugifyFolderName("")).toBeNull();
    expect(slugifyFolderName("   ")).toBeNull();
    expect(slugifyFolderName("\t\n")).toBeNull();
  });

  it("preserves already-safe slugs", () => {
    expect(slugifyFolderName("prd-0042")).toBe("prd-0042");
    expect(slugifyFolderName("sneaker_v3")).toBe("sneaker_v3");
    expect(slugifyFolderName("a-b_c-1")).toBe("a-b_c-1");
  });

  it("lowercases mixed-case input", () => {
    expect(slugifyFolderName("PRD-0042")).toBe("prd-0042");
    expect(slugifyFolderName("MyProduct")).toBe("myproduct");
  });

  it("replaces spaces and special chars with hyphens", () => {
    expect(slugifyFolderName("My Product 42")).toBe("my-product-42");
    expect(slugifyFolderName("foo/bar:baz")).toBe("foo-bar-baz");
    expect(slugifyFolderName("hello.world")).toBe("hello-world");
  });

  it("collapses runs of hyphens", () => {
    expect(slugifyFolderName("a---b")).toBe("a-b");
    expect(slugifyFolderName("a   b")).toBe("a-b");
    expect(slugifyFolderName("a / b")).toBe("a-b");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugifyFolderName("-foo-")).toBe("foo");
    expect(slugifyFolderName("---bar---")).toBe("bar");
    expect(slugifyFolderName("  baz  ")).toBe("baz");
  });

  it("caps length at FOLDER_NAME_MAX_LENGTH", () => {
    const long = "a".repeat(200);
    const result = slugifyFolderName(long);
    expect(result?.length).toBe(FOLDER_NAME_MAX_LENGTH);
  });

  it("returns null when input has no safe characters at all", () => {
    expect(slugifyFolderName("!@#$%^&*()")).toBeNull();
    expect(slugifyFolderName("///")).toBeNull();
  });
});

describe("rawCaptureKey / processedFramesKeyPrefix — folderName-or-id semantics", () => {
  it("builds raw.zip key under the supplied folder", () => {
    expect(rawCaptureKey("shop1", "PRD-0042")).toBe(
      "shop1/captures/PRD-0042/raw.zip",
    );
  });

  it("builds frames prefix under the supplied folder", () => {
    expect(processedFramesKeyPrefix("shop1", "PRD-0042")).toBe(
      "shop1/captures/PRD-0042/frames",
    );
  });

  it("falls back to a captureId when caller passes it", () => {
    expect(rawCaptureKey("shop1", "clxabc123")).toBe(
      "shop1/captures/clxabc123/raw.zip",
    );
  });
});
