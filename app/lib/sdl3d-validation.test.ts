import { describe, it, expect } from "vitest";
import {
  isMetersTriplet,
  isOrbitLike,
  isCssColorLike,
  getViewerSettingsFieldErrors,
  getHotspotFieldErrors,
  validateDraftForPublish,
} from "./sdl3d-validation";
import { defaultViewerSettings } from "./sdl3d-shared";

describe("isMetersTriplet", () => {
  it("accepts valid triplets", () => {
    expect(isMetersTriplet("0m 0m 0m")).toBe(true);
    expect(isMetersTriplet("0.012m 0.034m 0.025m")).toBe(true);
    expect(isMetersTriplet("-1.5m 2.3m 0m")).toBe(true);
    expect(isMetersTriplet("1 2 3")).toBe(true); // without m suffix
  });

  it("rejects invalid triplets", () => {
    expect(isMetersTriplet("0m 0m")).toBe(false);
    expect(isMetersTriplet("abc")).toBe(false);
    expect(isMetersTriplet("")).toBe(false);
  });
});

describe("isOrbitLike", () => {
  it("accepts three-part strings", () => {
    expect(isOrbitLike("0deg 75deg 105%")).toBe(true);
    expect(isOrbitLike("auto auto auto")).toBe(true);
  });

  it("rejects non-three-part strings", () => {
    expect(isOrbitLike("0deg 75deg")).toBe(false);
    expect(isOrbitLike("single")).toBe(false);
  });
});

describe("isCssColorLike", () => {
  it("accepts hex colors", () => {
    expect(isCssColorLike("#0b1020")).toBe(true);
    expect(isCssColorLike("#fff")).toBe(true);
    expect(isCssColorLike("#aabbccdd")).toBe(true);
  });

  it("accepts rgb/hsl", () => {
    expect(isCssColorLike("rgb(10, 20, 30)")).toBe(true);
    expect(isCssColorLike("rgba(0,0,0,0.5)")).toBe(true);
    expect(isCssColorLike("hsl(180, 50%, 50%)")).toBe(true);
  });

  it("rejects non-color strings", () => {
    expect(isCssColorLike("red")).toBe(false);
    expect(isCssColorLike("not a color")).toBe(false);
  });
});

describe("getViewerSettingsFieldErrors", () => {
  it("returns no errors for valid defaults", () => {
    const errors = getViewerSettingsFieldErrors(JSON.stringify(defaultViewerSettings));
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it("flags invalid cameraTarget", () => {
    const settings = { ...defaultViewerSettings, cameraTarget: "bad value" };
    const errors = getViewerSettingsFieldErrors(JSON.stringify(settings));
    expect(errors.cameraTarget).toBeDefined();
  });

  it("flags invalid cameraOrbit", () => {
    const settings = { ...defaultViewerSettings, cameraOrbit: "single" };
    const errors = getViewerSettingsFieldErrors(JSON.stringify(settings));
    expect(errors.cameraOrbit).toBeDefined();
  });

  it("flags invalid backgroundColor", () => {
    const settings = { ...defaultViewerSettings, backgroundColor: "not-a-color" };
    const errors = getViewerSettingsFieldErrors(JSON.stringify(settings));
    expect(errors.backgroundColor).toBeDefined();
  });

  it("returns empty for invalid JSON", () => {
    const errors = getViewerSettingsFieldErrors("not json");
    expect(Object.keys(errors)).toHaveLength(0);
  });
});

describe("getHotspotFieldErrors", () => {
  it("returns no errors for valid hotspot", () => {
    const errors = getHotspotFieldErrors({
      title: "Test",
      position: "0m 0m 0m",
      normal: "0m 1m 0m",
    });
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it("warns on missing title", () => {
    const errors = getHotspotFieldErrors({ title: "", position: "0m 0m 0m" });
    expect(errors.title).toBeDefined();
  });

  it("flags invalid position", () => {
    const errors = getHotspotFieldErrors({ title: "Test", position: "bad" });
    expect(errors.position).toBeDefined();
  });

  it("flags invalid normal", () => {
    const errors = getHotspotFieldErrors({
      title: "Test",
      position: "0m 0m 0m",
      normal: "bad",
    });
    expect(errors.normal).toBeDefined();
  });

  it("flags invalid focusOrbit", () => {
    const errors = getHotspotFieldErrors({
      title: "Test",
      position: "0m 0m 0m",
      focusOrbit: "single",
    });
    expect(errors.focusOrbit).toBeDefined();
  });
});

describe("validateDraftForPublish", () => {
  it("passes with valid 3D config", () => {
    const result = validateDraftForPublish({
      viewerSettingsJson: JSON.stringify(defaultViewerSettings),
      hotspots: [{ title: "Test", position: "0m 0m 0m" }],
      hasModel: true,
      viewerType: "MODEL_3D",
    });
    expect(result.isPublishReady).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails without model for MODEL_3D", () => {
    const result = validateDraftForPublish({
      viewerSettingsJson: JSON.stringify(defaultViewerSettings),
      hotspots: [],
      hasModel: false,
      viewerType: "MODEL_3D",
    });
    expect(result.isPublishReady).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("fails without frames for IMAGE_360", () => {
    const result = validateDraftForPublish({
      viewerSettingsJson: JSON.stringify(defaultViewerSettings),
      hotspots: [],
      hasModel: false,
      viewerType: "IMAGE_360",
      frameCount: 1,
    });
    expect(result.isPublishReady).toBe(false);
  });

  it("passes IMAGE_360 with sufficient frames", () => {
    const result = validateDraftForPublish({
      viewerSettingsJson: JSON.stringify(defaultViewerSettings),
      hotspots: [],
      hasModel: false,
      viewerType: "IMAGE_360",
      frameCount: 36,
    });
    expect(result.isPublishReady).toBe(true);
  });

  it("reports hotspot field errors", () => {
    const result = validateDraftForPublish({
      viewerSettingsJson: JSON.stringify(defaultViewerSettings),
      hotspots: [{ title: "Bad", position: "invalid" }],
      hasModel: true,
    });
    expect(result.isPublishReady).toBe(false);
    expect(result.errors.some((e) => e.includes("position"))).toBe(true);
  });
});
