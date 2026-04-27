import { describe, it, expect } from "vitest";
import {
  interpolateHotspotPosition,
  isHotspot360Visible,
  detectViewerTypeFromFilename,
  isValidConfigExport,
  safeJsonParse,
  defaultViewerSettings,
  normalizeViewerTypeToDb,
  viewerTypeDbToWire,
} from "./sdl3d-shared";
import type { Hotspot360 } from "./sdl3d-shared";

describe("interpolateHotspotPosition", () => {
  const keyframes = [
    { frame: 0, x: 10, y: 20 },
    { frame: 10, x: 50, y: 60 },
    { frame: 20, x: 90, y: 100 },
  ];

  it("returns exact keyframe position", () => {
    expect(interpolateHotspotPosition(keyframes, 0)).toEqual({ x: 10, y: 20 });
    expect(interpolateHotspotPosition(keyframes, 10)).toEqual({ x: 50, y: 60 });
  });

  it("interpolates between keyframes with spline curve", () => {
    const result = interpolateHotspotPosition(keyframes, 5);
    // Catmull-Rom spline through collinear points produces slightly different values than linear
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(27.5, 1);
    expect(result!.y).toBeCloseTo(37.5, 1);
  });

  it("uses linear interpolation with only 2 keyframes", () => {
    const twoKf = [
      { frame: 0, x: 10, y: 20 },
      { frame: 10, x: 50, y: 60 },
    ];
    expect(interpolateHotspotPosition(twoKf, 5)).toEqual({ x: 30, y: 40 });
  });

  it("clamps to first keyframe before range", () => {
    expect(interpolateHotspotPosition(keyframes, -5)).toEqual({ x: 10, y: 20 });
  });

  it("clamps to last keyframe after range", () => {
    expect(interpolateHotspotPosition(keyframes, 25)).toEqual({ x: 90, y: 100 });
  });

  it("returns null for empty keyframes", () => {
    expect(interpolateHotspotPosition([], 5)).toBeNull();
  });

  it("handles single keyframe", () => {
    expect(interpolateHotspotPosition([{ frame: 5, x: 50, y: 50 }], 0)).toEqual({ x: 50, y: 50 });
    expect(interpolateHotspotPosition([{ frame: 5, x: 50, y: 50 }], 10)).toEqual({ x: 50, y: 50 });
  });

  it("handles unsorted keyframes", () => {
    const unsorted = [
      { frame: 20, x: 90, y: 100 },
      { frame: 0, x: 10, y: 20 },
      { frame: 10, x: 50, y: 60 },
    ];
    const result = interpolateHotspotPosition(unsorted, 5);
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(27.5, 1);
    expect(result!.y).toBeCloseTo(37.5, 1);
  });
});

describe("isHotspot360Visible", () => {
  const hotspot: Hotspot360 = {
    id: "hs1",
    sortOrder: 0,
    visible: true,
    title: "Test",
    body: "",
    style: "card",
    color: null,
    visibleFrameStart: 5,
    visibleFrameEnd: 15,
    keyframes: [],
    ctaLabel: null,
    ctaUrl: null,
  };

  it("visible within range", () => {
    expect(isHotspot360Visible(hotspot, 5)).toBe(true);
    expect(isHotspot360Visible(hotspot, 10)).toBe(true);
    expect(isHotspot360Visible(hotspot, 15)).toBe(true);
  });

  it("not visible outside range", () => {
    expect(isHotspot360Visible(hotspot, 4)).toBe(false);
    expect(isHotspot360Visible(hotspot, 16)).toBe(false);
  });

  it("not visible when visible=false", () => {
    expect(isHotspot360Visible({ ...hotspot, visible: false }, 10)).toBe(false);
  });
});

describe("detectViewerTypeFromFilename", () => {
  it("detects GLB as MODEL_3D", () => {
    expect(detectViewerTypeFromFilename("model.glb")).toBe("MODEL_3D");
    expect(detectViewerTypeFromFilename("model.GLB")).toBe("MODEL_3D");
  });

  it("detects GLTF as MODEL_3D", () => {
    expect(detectViewerTypeFromFilename("model.gltf")).toBe("MODEL_3D");
  });

  it("detects images as IMAGE_360", () => {
    expect(detectViewerTypeFromFilename("photo.jpg")).toBe("IMAGE_360");
    expect(detectViewerTypeFromFilename("frame.png")).toBe("IMAGE_360");
    expect(detectViewerTypeFromFilename("pic.webp")).toBe("IMAGE_360");
  });
});

describe("isValidConfigExport", () => {
  it("accepts lowercase viewerType (canonical wire format)", () => {
    expect(
      isValidConfigExport({
        version: 1,
        viewerType: "model_3d",
        enabled: true,
        sourceMode: "APP",
        viewerSettings: {},
        hotspots: [],
        hotspots360: [],
      }),
    ).toBe(true);
    expect(
      isValidConfigExport({
        version: 1,
        viewerType: "image_360",
        enabled: true,
        sourceMode: "APP",
        viewerSettings: {},
        hotspots: [],
        hotspots360: [],
      }),
    ).toBe(true);
  });

  it("accepts legacy uppercase viewerType (pre-Phase 2 exports)", () => {
    expect(
      isValidConfigExport({
        version: 1,
        viewerType: "MODEL_3D",
        enabled: true,
        sourceMode: "APP",
        viewerSettings: {},
        hotspots: [],
        hotspots360: [],
      }),
    ).toBe(true);
  });

  it("rejects unknown viewerType", () => {
    expect(
      isValidConfigExport({
        version: 1,
        viewerType: "bogus",
        enabled: true,
        sourceMode: "APP",
        viewerSettings: {},
        hotspots: [],
        hotspots360: [],
      }),
    ).toBe(false);
  });

  it("rejects null/undefined", () => {
    expect(isValidConfigExport(null)).toBe(false);
    expect(isValidConfigExport(undefined)).toBe(false);
  });

  it("rejects wrong version", () => {
    expect(
      isValidConfigExport({
        version: 2,
        viewerType: "model_3d",
        enabled: true,
        sourceMode: "APP",
        viewerSettings: {},
        hotspots: [],
        hotspots360: [],
      }),
    ).toBe(false);
  });
});

describe("normalizeViewerTypeToDb", () => {
  it("normalizes lowercase wire to DB enum", () => {
    expect(normalizeViewerTypeToDb("model_3d")).toBe("MODEL_3D");
    expect(normalizeViewerTypeToDb("image_360")).toBe("IMAGE_360");
  });

  it("accepts legacy uppercase", () => {
    expect(normalizeViewerTypeToDb("MODEL_3D")).toBe("MODEL_3D");
    expect(normalizeViewerTypeToDb("IMAGE_360")).toBe("IMAGE_360");
  });

  it("defaults to MODEL_3D on unknown input", () => {
    expect(normalizeViewerTypeToDb("bogus")).toBe("MODEL_3D");
    expect(normalizeViewerTypeToDb(null)).toBe("MODEL_3D");
  });
});

describe("viewerTypeDbToWire", () => {
  it("converts DB enum to lowercase wire format", () => {
    expect(viewerTypeDbToWire("MODEL_3D")).toBe("model_3d");
    expect(viewerTypeDbToWire("IMAGE_360")).toBe("image_360");
  });
});

describe("safeJsonParse", () => {
  it("parses valid JSON", () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
  });

  it("returns fallback for invalid JSON", () => {
    expect(safeJsonParse("not json", { fallback: true })).toEqual({ fallback: true });
  });

  it("returns fallback for null/undefined", () => {
    expect(safeJsonParse(null, "default")).toBe("default");
    expect(safeJsonParse(undefined, "default")).toBe("default");
  });
});

describe("defaultViewerSettings", () => {
  it("has expected defaults", () => {
    expect(defaultViewerSettings.autoRotate).toBe(true);
    expect(defaultViewerSettings.cameraControls).toBe(true);
    expect(defaultViewerSettings.exposure).toBe(1);
    expect(defaultViewerSettings.rotationMode).toBe("free");
    expect(defaultViewerSettings.hotspotStyle).toBe("card");
  });
});
