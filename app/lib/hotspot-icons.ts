/**
 * Slice 8 hotspots PR #4 — preset icon library + classification.
 *
 * Single source of truth for the 14 named preset icons. The storefront
 * has a parallel copy at extensions/product-3d-viewer/assets/icons.js
 * — every change here must be mirrored there until the TAE bundle
 * picks up @spectrum-design-lab/shared (Slice 8 tech-debt backlog).
 *
 * All paths use viewBox 0 0 24 24 and inherit colour via
 * `stroke="currentColor"` / `fill="currentColor"`. Inner-SVG strings
 * are vetted constants — safe to drop into both
 * dangerouslySetInnerHTML (editor) and innerHTML (storefront).
 */

export type HotspotIconKey =
  | "plus"
  | "minus"
  | "info"
  | "warning"
  | "star"
  | "heart"
  | "check"
  | "x"
  | "arrow-up"
  | "arrow-down"
  | "arrow-left"
  | "arrow-right"
  | "play"
  | "circle";

export const HOTSPOT_ICON_KEYS: HotspotIconKey[] = [
  "plus",
  "minus",
  "info",
  "warning",
  "star",
  "heart",
  "check",
  "x",
  "arrow-up",
  "arrow-down",
  "arrow-left",
  "arrow-right",
  "play",
  "circle",
];

/** Inner SVG content per preset. Mix of stroke (outline) and fill (solid). */
export const HOTSPOT_PRESET_ICONS: Record<HotspotIconKey, string> = {
  "plus":
    '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
  "minus":
    '<path d="M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
  "info":
    '<circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 16v-5M12 8h.01" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
  "warning":
    '<path d="M12 3 22 21H2Z M12 10v4M12 17h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  "star":
    '<path d="M12 2.5l2.95 6.4 6.85.5-5.3 4.5 1.9 6.8L12 17.1l-6.4 3.6 1.9-6.8-5.3-4.5 6.85-.5z" fill="currentColor"/>',
  "heart":
    '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" fill="currentColor"/>',
  "check":
    '<path d="M5 12l5 5 9-9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  "x":
    '<path d="M6 6l12 12M6 18l12-12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
  "arrow-up":
    '<path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  "arrow-down":
    '<path d="M12 5v14M5 12l7 7 7-7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  "arrow-left":
    '<path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  "arrow-right":
    '<path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  "play":
    '<path d="M8 5v14l11-7z" fill="currentColor"/>',
  "circle":
    '<circle cx="12" cy="12" r="9" fill="currentColor"/>',
};

export type HotspotIconKind = "none" | "preset" | "url" | "gid";

/**
 * Detect what an icon value is. The single `icon` string field carries
 * three semantically different shapes; classification is unambiguous
 * via prefix (`gid://shopify/...`), URL scheme, or membership in the
 * preset key set.
 */
export function classifyIcon(value: string | null | undefined): HotspotIconKind {
  if (!value) return "none";
  const v = value.trim();
  if (!v) return "none";
  if (v.startsWith("gid://shopify/")) return "gid";
  if (v.startsWith("http://") || v.startsWith("https://") || v.startsWith("//")) return "url";
  if ((HOTSPOT_ICON_KEYS as string[]).includes(v)) return "preset";
  return "none";
}

/** Wrap inner SVG content in the standard 24×24 viewBox wrapper. */
export function presetIconSvg(key: HotspotIconKey, sizePx = 24): string {
  return `<svg viewBox="0 0 24 24" width="${sizePx}" height="${sizePx}" aria-hidden="true" focusable="false">${HOTSPOT_PRESET_ICONS[key]}</svg>`;
}

/** Friendly title for the picker grid swatches. */
export function presetIconLabel(key: HotspotIconKey): string {
  return key
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
