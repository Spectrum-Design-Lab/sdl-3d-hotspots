import type { Hotspot } from "@prisma/client";
import {
  defaultViewerSettings,
  safeJsonParse,
  type ViewerSettings,
} from "./sdl3d-shared";
import { ViewerSettingsSchema } from "./sdl3d-schemas";

export type { ViewerSettings };

export type PublishedHotspot = {
  id: string;
  sortOrder: number;
  visible: boolean;
  title: string;
  body: string;
  icon: string | null;
  style: string;
  color: string | null;
  position: string;
  normal: string | null;
  focusTarget: string | null;
  focusOrbit: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
};

function cleanNumberString(input: string) {
  const parsed = Number(input);
  if (Number.isNaN(parsed)) throw new Error(`Invalid number: ${input}`);
  return parsed.toString();
}

export function parseMetersTriplet(input: string) {
  const match = input
    .trim()
    .match(/^(-?\d*\.?\d+)(?:m)?\s+(-?\d*\.?\d+)(?:m)?\s+(-?\d*\.?\d+)(?:m)?$/i);

  if (!match) {
    throw new Error(`Invalid 3D coordinate triplet: "${input}"`);
  }

  return {
    x: Number(cleanNumberString(match[1])),
    y: Number(cleanNumberString(match[2])),
    z: Number(cleanNumberString(match[3])),
  };
}

export function formatMetersTriplet(x: string | number, y: string | number, z: string | number) {
  return `${x}m ${y}m ${z}m`;
}

export { defaultViewerSettings, safeJsonParse };

export function coerceViewerSettings(input: unknown): ViewerSettings {
  // Layer: defaults (provides PR #2's autoRotateSpeed/Direction which the
  // shared Zod schema doesn't know about yet) → raw input (preserves any
  // fields the schema doesn't gate on) → schema's parsed output (replaces
  // any known fields with their validated/coerced form).
  const source = (input && typeof input === "object" ? input : {}) as Partial<ViewerSettings>;
  const result = ViewerSettingsSchema.safeParse(input);
  const validated = result.success ? result.data : {};
  return { ...defaultViewerSettings, ...source, ...validated } as ViewerSettings;
}

export function dbHotspotToPublished(h: Hotspot): PublishedHotspot {
  return {
    id: h.id,
    sortOrder: h.sortOrder,
    visible: h.visible,
    title: h.title,
    body: h.body,
    icon: h.icon ?? null,
    style: h.style,
    color: h.color ?? null,
    position: formatMetersTriplet(h.positionX, h.positionY, h.positionZ),
    normal:
      h.normalX != null && h.normalY != null && h.normalZ != null
        ? formatMetersTriplet(h.normalX, h.normalY, h.normalZ)
        : null,
    focusTarget:
      h.focusTargetX != null && h.focusTargetY != null && h.focusTargetZ != null
        ? formatMetersTriplet(h.focusTargetX, h.focusTargetY, h.focusTargetZ)
        : null,
    focusOrbit: h.focusOrbit ?? null,
    ctaLabel: h.ctaLabel ?? null,
    ctaUrl: h.ctaUrl ?? null,
  };
}

export function publishedHotspotsToCreateMany(
  productConfigId: string,
  hotspots: PublishedHotspot[],
) {
  return hotspots
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((h, index) => {
      const position = parseMetersTriplet(h.position);
      const normal = h.normal ? parseMetersTriplet(h.normal) : null;
      const focusTarget = h.focusTarget ? parseMetersTriplet(h.focusTarget) : null;

      return {
        productConfigId,
        sortOrder: index + 1,
        visible: h.visible,
        title: h.title,
        body: h.body,
        icon: h.icon ?? null,
        style: h.style,
        color: h.color ?? null,
        positionX: position.x,
        positionY: position.y,
        positionZ: position.z,
        normalX: normal?.x ?? null,
        normalY: normal?.y ?? null,
        normalZ: normal?.z ?? null,
        focusTargetX: focusTarget?.x ?? null,
        focusTargetY: focusTarget?.y ?? null,
        focusTargetZ: focusTarget?.z ?? null,
        focusOrbit: h.focusOrbit ?? null,
        ctaLabel: h.ctaLabel ?? null,
        ctaUrl: h.ctaUrl ?? null,
      };
    });
}