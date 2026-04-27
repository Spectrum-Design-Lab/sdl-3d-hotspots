import { describe, it, expect } from "vitest";
import {
  parseMetersTriplet,
  formatMetersTriplet,
  coerceViewerSettings,
  defaultViewerSettings,
} from "./sdl3d-serialization.server";

describe("parseMetersTriplet", () => {
  it("parses standard format", () => {
    expect(parseMetersTriplet("0.012m 0.034m 0.025m")).toEqual({ x: 0.012, y: 0.034, z: 0.025 });
  });

  it("parses without m suffix", () => {
    expect(parseMetersTriplet("1 2 3")).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("parses negative values", () => {
    expect(parseMetersTriplet("-1.5m 2.3m 0m")).toEqual({ x: -1.5, y: 2.3, z: 0 });
  });

  it("handles leading/trailing whitespace", () => {
    expect(parseMetersTriplet("  0m 0m 0m  ")).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("throws on invalid input", () => {
    expect(() => parseMetersTriplet("bad")).toThrow();
    expect(() => parseMetersTriplet("0m 0m")).toThrow();
  });
});

describe("formatMetersTriplet", () => {
  it("formats numbers", () => {
    expect(formatMetersTriplet(0.012, 0.034, 0.025)).toBe("0.012m 0.034m 0.025m");
  });

  it("formats string values", () => {
    expect(formatMetersTriplet("0", "1", "2")).toBe("0m 1m 2m");
  });
});

describe("coerceViewerSettings", () => {
  it("returns defaults for empty/null input", () => {
    const fromNull = coerceViewerSettings(null);
    const fromUndef = coerceViewerSettings(undefined);
    const fromEmpty = coerceViewerSettings({});

    // Core defaults are consistent
    for (const result of [fromNull, fromUndef, fromEmpty]) {
      expect(result.autoRotate).toBe(true);
      expect(result.cameraControls).toBe(true);
      expect(result.exposure).toBe(1);
      expect(result.rotationMode).toBe("free");
      expect(result.hotspotStyle).toBe("card");
      expect(result.showFullscreen).toBe(true);
      expect(result.showArButton).toBe(false);
      expect(result.horizontalLock).toBe(false);
    }
  });

  it("merges partial settings with defaults", () => {
    const result = coerceViewerSettings({ autoRotate: false, exposure: 2 });
    expect(result.autoRotate).toBe(false);
    expect(result.exposure).toBe(2);
    expect(result.cameraControls).toBe(true); // default
  });

  it("preserves valid overrides", () => {
    const result = coerceViewerSettings({
      backgroundColor: "#ff0000",
      hotspotStyle: "tooltip",
    });
    expect(result.backgroundColor).toBe("#ff0000");
    expect(result.hotspotStyle).toBe("tooltip");
  });
});
