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
  coordToDisplay,
  coordFromDisplay,
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

  // Slice 7 PR #6 — wraparound
  describe("with wrap option", () => {
    const wrap = { wrap: true, totalFrames: 72 };
    // Two keyframes spanning the wrap seam: kf at frame 5 (x=100) and
    // kf at frame 70 (x=0). The wrap path goes 70 → 71 → 0 → 5 (span=7).
    const wrapKfs = [
      { frame: 5, x: 100, y: 100 },
      { frame: 70, x: 0, y: 0 },
    ];

    it("returns last keyframe exactly at last.frame", () => {
      expect(interpolateHotspotPosition(wrapKfs, 70, wrap)).toEqual({ x: 0, y: 0 });
    });

    it("returns first keyframe exactly at first.frame", () => {
      expect(interpolateHotspotPosition(wrapKfs, 5, wrap)).toEqual({ x: 100, y: 100 });
    });

    it("interpolates 1/7 of the way past last on frame 71", () => {
      const result = interpolateHotspotPosition(wrapKfs, 71, wrap);
      expect(result).not.toBeNull();
      expect(result!.x).toBeCloseTo(100 / 7, 2);
      expect(result!.y).toBeCloseTo(100 / 7, 2);
    });

    it("interpolates across the seam — frame 0 is 2/7 along", () => {
      const result = interpolateHotspotPosition(wrapKfs, 0, wrap);
      expect(result).not.toBeNull();
      expect(result!.x).toBeCloseTo((100 * 2) / 7, 2);
      expect(result!.y).toBeCloseTo((100 * 2) / 7, 2);
    });

    it("interpolates across the seam — frame 3 is 5/7 along", () => {
      const result = interpolateHotspotPosition(wrapKfs, 3, wrap);
      expect(result).not.toBeNull();
      expect(result!.x).toBeCloseTo((100 * 5) / 7, 2);
      expect(result!.y).toBeCloseTo((100 * 5) / 7, 2);
    });

    it("single keyframe + wrap holds position across the range", () => {
      const single = [{ frame: 50, x: 42, y: 42 }];
      expect(interpolateHotspotPosition(single, 0, wrap)).toEqual({ x: 42, y: 42 });
      expect(interpolateHotspotPosition(single, 50, wrap)).toEqual({ x: 42, y: 42 });
      expect(interpolateHotspotPosition(single, 71, wrap)).toEqual({ x: 42, y: 42 });
    });

    it("no totalFrames falls through to linear behaviour", () => {
      // Without totalFrames the wrap option is meaningless; existing
      // clamp-before-first / clamp-after-last paths apply.
      expect(interpolateHotspotPosition(wrapKfs, 0, { wrap: true })).toEqual({ x: 100, y: 100 });
      expect(interpolateHotspotPosition(wrapKfs, 71, { wrap: true })).toEqual({ x: 0, y: 0 });
    });

    it("non-wrap call on the same keyframes regresses to clamp", () => {
      // Existing callers without the option get the original behaviour
      // verbatim — frame 0 clamps to first keyframe, frame 71 to last.
      expect(interpolateHotspotPosition(wrapKfs, 0)).toEqual({ x: 100, y: 100 });
      expect(interpolateHotspotPosition(wrapKfs, 71)).toEqual({ x: 0, y: 0 });
    });
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

  // Slice 7 PR #6 — wraparound visibility
  describe("with wraparound range (start > end)", () => {
    const wrap: Hotspot360 = {
      ...hotspot,
      visibleFrameStart: 70,
      visibleFrameEnd: 5,
    };

    it("visible past start when totalFrames known", () => {
      expect(isHotspot360Visible(wrap, 70, 72)).toBe(true);
      expect(isHotspot360Visible(wrap, 71, 72)).toBe(true);
    });

    it("visible before end when totalFrames known", () => {
      expect(isHotspot360Visible(wrap, 0, 72)).toBe(true);
      expect(isHotspot360Visible(wrap, 5, 72)).toBe(true);
    });

    it("not visible in the gap between end and start", () => {
      expect(isHotspot360Visible(wrap, 6, 72)).toBe(false);
      expect(isHotspot360Visible(wrap, 35, 72)).toBe(false);
      expect(isHotspot360Visible(wrap, 69, 72)).toBe(false);
    });

    it("without totalFrames degrades to the linear check (returns false)", () => {
      // Legacy callers that don't know about wrap continue to read the
      // inverted range as "invalid" — same as before PR #6.
      expect(isHotspot360Visible(wrap, 0)).toBe(false);
      expect(isHotspot360Visible(wrap, 71)).toBe(false);
    });
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

describe("coordToDisplay / coordFromDisplay (Slice 7 PR #7)", () => {
  it("scales storage [0, 100] to display [0, 1000]", () => {
    expect(coordToDisplay(0)).toBe(0);
    expect(coordToDisplay(50)).toBe(500);
    expect(coordToDisplay(100)).toBe(1000);
  });

  it("rounds fractional storage to nearest display integer", () => {
    expect(coordToDisplay(51.2)).toBe(512);
    expect(coordToDisplay(0.05)).toBe(1);
    expect(coordToDisplay(99.95)).toBe(1000);
  });

  it("clamps out-of-range storage to [0, 1000]", () => {
    expect(coordToDisplay(-5)).toBe(0);
    expect(coordToDisplay(150)).toBe(1000);
  });

  it("treats non-finite storage as 0 (defensive — should never happen)", () => {
    expect(coordToDisplay(Number.NaN)).toBe(0);
    expect(coordToDisplay(Infinity)).toBe(0);
    expect(coordToDisplay(-Infinity)).toBe(0);
  });

  it("scales display [0, 1000] to storage [0, 100]", () => {
    expect(coordFromDisplay(0)).toBe(0);
    expect(coordFromDisplay(500)).toBe(50);
    expect(coordFromDisplay(1000)).toBe(100);
  });

  it("clamps out-of-range display to [0, 100]", () => {
    expect(coordFromDisplay(-5)).toBe(0);
    expect(coordFromDisplay(1500)).toBe(100);
  });

  it("returns NaN for non-finite display (mid-edit / cleared field)", () => {
    expect(coordFromDisplay(Number.NaN)).toBeNaN();
  });

  it("round-trip is exact at boundary integers", () => {
    for (const display of [0, 1, 250, 500, 999, 1000]) {
      const stored = coordFromDisplay(display);
      expect(coordToDisplay(stored)).toBe(display);
    }
  });
});
