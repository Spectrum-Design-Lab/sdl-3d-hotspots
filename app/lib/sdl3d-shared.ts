import type {
  ViewerSettingsZ,
  Hotspot360Z,
  Hotspot360KeyframeZ,
  ImageSequenceFrameZ,
  ConfigExportZ,
} from "./sdl3d-schemas";

export type ViewerType = "MODEL_3D" | "IMAGE_360";

// Types derived from Zod schemas — re-exported for backward compatibility
export type ImageSequenceFrame = ImageSequenceFrameZ;
export type Hotspot360Keyframe = Hotspot360KeyframeZ;
export type Hotspot360 = Hotspot360Z;

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t
  );
}

export function interpolateHotspotPosition(
  keyframes: Hotspot360Keyframe[],
  frame: number,
): { x: number; y: number } | null {
  if (!keyframes.length) return null;

  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);

  // Before first keyframe or after last — clamp
  if (frame <= sorted[0].frame) return { x: sorted[0].x, y: sorted[0].y };
  if (frame >= sorted[sorted.length - 1].frame) {
    return { x: sorted[sorted.length - 1].x, y: sorted[sorted.length - 1].y };
  }

  // Find bracketing segment
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (frame >= a.frame && frame <= b.frame) {
      const t = (frame - a.frame) / (b.frame - a.frame);

      // With fewer than 3 keyframes, use linear interpolation
      if (sorted.length < 3) {
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }

      // Catmull-Rom: use neighboring points, duplicate endpoints at boundaries
      const p0 = sorted[Math.max(i - 1, 0)];
      const p3 = sorted[Math.min(i + 2, sorted.length - 1)];
      return {
        x: catmullRom(p0.x, a.x, b.x, p3.x, t),
        y: catmullRom(p0.y, a.y, b.y, p3.y, t),
      };
    }
  }

  return null;
}

export function isHotspot360Visible(
  hotspot: Hotspot360,
  frame: number,
): boolean {
  return (
    hotspot.visible !== false &&
    frame >= hotspot.visibleFrameStart &&
    frame <= hotspot.visibleFrameEnd
  );
}

/**
 * Frame-index display helpers (Slice 7 PR #5). Storage stays 0-indexed
 * everywhere; the merchant-facing UI is 1-indexed. Conversion happens at
 * the form-field / label layer only — schema is untouched.
 */
export function frameToDisplay(stored: number): number {
  return stored + 1;
}

/**
 * Convert a typed display value back to storage, clamped to the valid
 * 0-indexed range. Returns NaN when the input isn't a finite number so
 * callers can treat "field cleared / mid-edit" as "no change" (per the
 * Slice 7 PR #5 edge-case spec). Display 0 → storage 0; display
 * frameCount+1 → storage frameCount-1.
 */
export function frameFromDisplay(display: number, frameCount: number): number {
  if (!Number.isFinite(display)) return Number.NaN;
  const max = Math.max(0, frameCount - 1);
  return Math.max(0, Math.min(max, Math.round(display) - 1));
}

/**
 * Detect viewer type from file extension.
 * GLB/GLTF -> MODEL_3D, images -> IMAGE_360
 */
export function detectViewerTypeFromFilename(filename: string): ViewerType {
  const ext = filename.toLowerCase().split(".").pop() || "";
  if (ext === "glb" || ext === "gltf") return "MODEL_3D";
  return "IMAGE_360";
}

export type ViewerSettings = ViewerSettingsZ;

export const defaultViewerSettings: ViewerSettings = {
  autoRotate: true,
  cameraControls: true,
  cameraOrbit: "0deg 75deg 105%",
  cameraTarget: "0m 0m 0m",
  fieldOfView: "auto",
  minCameraOrbit: null,
  maxCameraOrbit: null,
  exposure: 1,
  environmentImage: null,
  skyboxImage: null,
  poster: null,
  interactionPrompt: "auto",
  rotationMode: "free",
  horizontalLock: false,
  lockedPolarAngle: null,
  hotspotStyle: "card",
  showFullscreen: true,
  showArButton: false,
  backgroundColor: "#0b1020",
};

/** Shape used for JSON import/export of product configurations (wire format — viewerType is lowercase). */
export type ConfigExport = ConfigExportZ;

export { validateConfigExport } from "./sdl3d-schemas";

/**
 * @deprecated Use validateConfigExport() from sdl3d-schemas for richer error reporting.
 * Kept for backward compatibility.
 *
 * Accepts both the canonical lowercase viewer_type (post-Phase 2) and the
 * legacy uppercase form so older user-exported JSON files still import.
 */
export function isValidConfigExport(data: unknown): data is ConfigExport {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  const vt = d.viewerType;
  const viewerTypeOk =
    vt === "model_3d" || vt === "image_360" || vt === "MODEL_3D" || vt === "IMAGE_360";
  return (
    d.version === 1 &&
    viewerTypeOk &&
    typeof d.enabled === "boolean" &&
    typeof d.sourceMode === "string" &&
    typeof d.viewerSettings === "object" &&
    Array.isArray(d.hotspots) &&
    Array.isArray(d.hotspots360)
  );
}

/** Normalize a viewer_type value from any source (wire or legacy) into the DB enum. */
export function normalizeViewerTypeToDb(value: unknown): ViewerType {
  if (value === "image_360" || value === "IMAGE_360") return "IMAGE_360";
  return "MODEL_3D";
}

/** Convert a DB viewer type (uppercase Prisma enum) to the lowercase wire format. */
export function viewerTypeDbToWire(db: ViewerType): "model_3d" | "image_360" {
  return db === "IMAGE_360" ? "image_360" : "model_3d";
}

export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}