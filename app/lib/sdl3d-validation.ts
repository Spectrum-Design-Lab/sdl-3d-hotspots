import { defaultViewerSettings } from "./sdl3d-shared";

type ValidationHotspot = {
  title?: string | null;
  position?: string | null;
  normal?: string | null;
  focusTarget?: string | null;
  focusOrbit?: string | null;
};

export type DraftValidationResult = {
  errors: string[];
  warnings: string[];
  isPublishReady: boolean;
};

export type ViewerSettingsFieldErrors = Partial<
  Record<
    | "cameraTarget"
    | "cameraOrbit"
    | "minCameraOrbit"
    | "maxCameraOrbit"
    | "lockedPolarAngle"
    | "backgroundColor",
    string
  >
>;

export type HotspotFieldErrors = Partial<
  Record<"title" | "position" | "normal" | "focusTarget" | "focusOrbit", string>
>;

const metersTripletRegex =
  /^(-?\d*\.?\d+)(?:m)?\s+(-?\d*\.?\d+)(?:m)?\s+(-?\d*\.?\d+)(?:m)?$/i;

export function isMetersTriplet(value: string) {
  return metersTripletRegex.test(value.trim());
}

export function isOrbitLike(value: string) {
  return value.trim().split(/\s+/).length === 3;
}

export function isCssColorLike(value: string) {
  const trimmed = value.trim();
  return (
    /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed) ||
    /^(rgb|rgba|hsl|hsla)\(/i.test(trimmed)
  );
}

export function getViewerSettingsFieldErrors(viewerSettingsJson: string): ViewerSettingsFieldErrors {
  const fieldErrors: ViewerSettingsFieldErrors = {};

  let settings: any = null;

  try {
    const parsed = JSON.parse(viewerSettingsJson);
    settings = {
      ...defaultViewerSettings,
      ...(parsed && typeof parsed === "object" ? parsed : {}),
    };
  } catch {
    return fieldErrors;
  }

  if (settings.cameraTarget && !isMetersTriplet(String(settings.cameraTarget))) {
    fieldErrors.cameraTarget = "Use a 3D coordinate like 0m 0m 0m.";
  }

  if (settings.cameraOrbit && !isOrbitLike(String(settings.cameraOrbit))) {
    fieldErrors.cameraOrbit = "Use three parts like 0deg 75deg 105%.";
  }

  if (settings.minCameraOrbit && !isOrbitLike(String(settings.minCameraOrbit))) {
    fieldErrors.minCameraOrbit = "Use three parts like auto auto auto.";
  }

  if (settings.maxCameraOrbit && !isOrbitLike(String(settings.maxCameraOrbit))) {
    fieldErrors.maxCameraOrbit = "Use three parts like auto auto auto.";
  }

  if (
    settings.lockedPolarAngle &&
    !/^-?\d*\.?\d+deg$/i.test(String(settings.lockedPolarAngle).trim())
  ) {
    fieldErrors.lockedPolarAngle = "Use a value like 75deg.";
  }

  if (settings.backgroundColor && !isCssColorLike(String(settings.backgroundColor))) {
    fieldErrors.backgroundColor = "Use a CSS color like #0b1020 or rgb(...).";
  }

  return fieldErrors;
}

export function getHotspotFieldErrors(hotspot: ValidationHotspot): HotspotFieldErrors {
  const fieldErrors: HotspotFieldErrors = {};

  if (!hotspot.title || !hotspot.title.trim()) {
    fieldErrors.title = "Title is recommended.";
  }

  if (!hotspot.position || !isMetersTriplet(hotspot.position)) {
    fieldErrors.position = "Use a coordinate like 0m 0m 0m.";
  }

  if (hotspot.normal && !isMetersTriplet(hotspot.normal)) {
    fieldErrors.normal = "Use a vector like 0m 1m 0m.";
  }

  if (hotspot.focusTarget && !isMetersTriplet(hotspot.focusTarget)) {
    fieldErrors.focusTarget = "Use a coordinate like 0m 0m 0m.";
  }

  if (hotspot.focusOrbit && !isOrbitLike(hotspot.focusOrbit)) {
    fieldErrors.focusOrbit = "Use three parts like 20deg 72deg 85%.";
  }

  return fieldErrors;
}

export function validateDraftForPublish(args: {
  viewerSettingsJson: string;
  hotspots: ValidationHotspot[];
  hasModel: boolean;
  viewerType?: string;
  frameCount?: number;
}) {
  const { viewerSettingsJson, hotspots, hasModel, viewerType = "MODEL_3D", frameCount = 0 } = args;

  const errors: string[] = [];
  const warnings: string[] = [];

  if (viewerType === "IMAGE_360") {
    if (frameCount < 2) {
      errors.push("At least 2 image frames are required for a 360° image sequence.");
    }
  } else {
    if (!hasModel) {
      errors.push("A 3D model file must be selected before publishing.");
    }
  }

  let settings: any = null;

  try {
    const parsed = JSON.parse(viewerSettingsJson);
    settings = {
      ...defaultViewerSettings,
      ...(parsed && typeof parsed === "object" ? parsed : {}),
    };
  } catch {
    errors.push("Viewer settings JSON is not valid JSON.");
  }

  if (settings) {
    const viewerErrors = getViewerSettingsFieldErrors(viewerSettingsJson);

    if (viewerErrors.cameraTarget) {
      errors.push('Viewer "camera target" must be a 3D coordinate like `0m 0m 0m`.');
    }

    if (viewerErrors.cameraOrbit) {
      errors.push('Viewer "camera orbit" must have three parts like `0deg 75deg 105%`.');
    }

    if (viewerErrors.minCameraOrbit) {
      errors.push('Viewer "min camera orbit" must have three parts like `auto auto auto`.');
    }

    if (viewerErrors.maxCameraOrbit) {
      errors.push('Viewer "max camera orbit" must have three parts like `auto auto auto`.');
    }

    if (viewerErrors.lockedPolarAngle) {
      errors.push('Viewer "locked polar angle" must look like `75deg`.');
    }

    if (viewerErrors.backgroundColor) {
      warnings.push(
        'Viewer "background color" does not look like a standard CSS color. Use `#0b1020` or `rgb(...)`.',
      );
    }
  }

  hotspots.forEach((hotspot, index) => {
    const label = hotspot.title?.trim() || `Hotspot ${index + 1}`;
    const hotspotErrors = getHotspotFieldErrors(hotspot);

    if (hotspotErrors.position) {
      errors.push(`${label}: position must be like \`0m 0m 0m\`.`);
    }

    if (hotspotErrors.normal) {
      errors.push(`${label}: normal must be like \`0m 1m 0m\`.`);
    }

    if (hotspotErrors.focusTarget) {
      errors.push(`${label}: focus target must be like \`0m 0m 0m\`.`);
    }

    if (hotspotErrors.focusOrbit) {
      errors.push(`${label}: focus orbit must have three parts like \`20deg 72deg 85%\`.`);
    }

    if (hotspotErrors.title) {
      warnings.push(`Hotspot ${index + 1} has no title.`);
    }
  });

  return {
    errors,
    warnings,
    isPublishReady: errors.length === 0,
  } satisfies DraftValidationResult;
}