import { describe, it, expect } from "vitest";
import { ImageSequenceFrameSchema, ImageSequenceSchema } from "./sdl3d-schemas";

// Contract: the storefront viewer must consume frames hosted on ANY origin —
// not just Shopify CDN. The platform pipeline (sdl-platform) writes absolute
// URLs from DigitalOcean Spaces (production), local dev server (testing), and
// is designed to plug in additional providers (S3, R2, Bunny, custom).
//
// These tests guard the schema layer that bridges the platform writer and the
// hotspots reader.

describe("ImageSequenceFrameSchema — origin-agnostic URL acceptance", () => {
  const cases: Array<[string, string]> = [
    ["Shopify CDN", "https://cdn.shopify.com/s/files/1/0123/4567/files/frame_001.webp"],
    ["DigitalOcean Spaces", "https://sdl-prod.nyc3.cdn.digitaloceanspaces.com/PRD-0001/frame_001.webp"],
    ["DO Spaces direct (no CDN)", "https://sdl-prod.nyc3.digitaloceanspaces.com/PRD-0001/frame_001.webp"],
    ["AWS S3 path-style", "https://s3.us-east-1.amazonaws.com/my-bucket/PRD-0001/frame_001.webp"],
    ["AWS S3 vhost-style", "https://my-bucket.s3.us-east-1.amazonaws.com/PRD-0001/frame_001.webp"],
    ["Cloudflare R2 public", "https://pub-abc123.r2.dev/PRD-0001/frame_001.webp"],
    ["Bunny CDN", "https://sdl.b-cdn.net/PRD-0001/frame_001.webp"],
    ["Custom domain", "https://media.spectrumdesignlab.com/360/PRD-0001/frame_001.webp"],
    ["Local dev server", "http://localhost:3360/api/360/files/PRD-0001/frame_001.webp"],
  ];

  it.each(cases)("accepts %s URL", (_label, url) => {
    expect(
      ImageSequenceFrameSchema.safeParse({ index: 0, imageUrl: url }).success,
    ).toBe(true);
  });

  it("accepts platform-written frame (no imageGid, just URL)", () => {
    expect(
      ImageSequenceFrameSchema.safeParse({
        index: 0,
        imageUrl: "https://sdl-prod.nyc3.cdn.digitaloceanspaces.com/PRD-0001/frame_001.webp",
      }).success,
    ).toBe(true);
  });

  it("accepts hotspots-app-written frame (Shopify GID + Shopify CDN URL)", () => {
    expect(
      ImageSequenceFrameSchema.safeParse({
        index: 0,
        imageGid: "gid://shopify/MediaImage/12345",
        imageUrl: "https://cdn.shopify.com/s/files/1/0123/4567/files/frame_001.webp",
      }).success,
    ).toBe(true);
  });
});

describe("ImageSequenceSchema — mixed-origin sequence integrity", () => {
  it("round-trips a sequence with all-DO-Spaces frames (platform-only path)", () => {
    const platformSequence = Array.from({ length: 36 }, (_, i) => ({
      index: i,
      imageUrl: `https://sdl-prod.nyc3.cdn.digitaloceanspaces.com/PRD-0001/frame_${String(i + 1).padStart(3, "0")}.webp`,
    }));

    const json = JSON.stringify(platformSequence);
    const parsed = ImageSequenceSchema.safeParse(JSON.parse(json));

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toHaveLength(36);
      expect(parsed.data[0].imageUrl).toContain("digitaloceanspaces.com");
      expect(parsed.data[0].imageGid).toBeUndefined();
    }
  });

  it("round-trips a sequence with all-Shopify frames (hotspots-app-only path)", () => {
    const shopifySequence = Array.from({ length: 36 }, (_, i) => ({
      index: i,
      imageGid: `gid://shopify/MediaImage/${1000 + i}`,
      imageUrl: `https://cdn.shopify.com/s/files/1/0123/4567/files/frame_${String(i + 1).padStart(3, "0")}.webp`,
    }));

    const parsed = ImageSequenceSchema.safeParse(shopifySequence);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data[0].imageGid).toBe("gid://shopify/MediaImage/1000");
    }
  });

  it("preserves frame order — the storefront viewer relies on array index", () => {
    const sequence = [
      { index: 0, imageUrl: "https://cdn.example.com/c.webp" },
      { index: 1, imageUrl: "https://cdn.example.com/a.webp" },
      { index: 2, imageUrl: "https://cdn.example.com/b.webp" },
    ];

    const parsed = ImageSequenceSchema.safeParse(sequence);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.map((f) => f.imageUrl)).toEqual([
        "https://cdn.example.com/c.webp",
        "https://cdn.example.com/a.webp",
        "https://cdn.example.com/b.webp",
      ]);
    }
  });
});

describe("ImageSequenceSchema — payload simulating a real platform publish", () => {
  // This mirrors the JSON the platform writes to sdl_3d.image_sequence.
  // If pullMetafieldsToDraft (sdl3d-sync.server.ts) parses this successfully,
  // the storefront read path will too — same schema, same JSON.
  const platformPayload = JSON.stringify([
    { index: 0, imageUrl: "https://sdl-prod.nyc3.cdn.digitaloceanspaces.com/PRD-0001/frame_001.webp" },
    { index: 1, imageUrl: "https://sdl-prod.nyc3.cdn.digitaloceanspaces.com/PRD-0001/frame_002.webp" },
    { index: 2, imageUrl: "https://sdl-prod.nyc3.cdn.digitaloceanspaces.com/PRD-0001/frame_003.webp" },
  ]);

  it("pullMetafieldsToDraft can validate platform output (same Zod schema)", () => {
    const parsed = ImageSequenceSchema.safeParse(JSON.parse(platformPayload));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toHaveLength(3);
      expect(parsed.data.every((f) => f.imageUrl.startsWith("https://"))).toBe(true);
    }
  });
});
