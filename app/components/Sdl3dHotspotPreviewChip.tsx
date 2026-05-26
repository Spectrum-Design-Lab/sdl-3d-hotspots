/**
 * Slice 9 hotspot UX rework — live dot preview swatch.
 *
 * Small tile that mirrors what the styled hotspot dot looks like on the
 * storefront. Pinned to the editor pane's top-right corner inside the
 * Sdl3dHotspotsModal so merchants get real-time feedback as they edit
 * color / icon / style / animation — no need to flip back to the canvas.
 *
 * Intentionally DOES NOT render the popup or sidebar mockup. Storefront
 * uses a right-side sidebar (Slice 8 PR #5 `97d52db`); mocking it in the
 * editor would drift any time the storefront rendering changes. Title /
 * body / media live in the form fields the merchant is already looking
 * at — duplicating them here is just clutter.
 *
 * CSS keyframes live in app/styles/editor.css (`.sdl-preview-dot--*`),
 * ported from the storefront viewer.css so the looped animation matches
 * what the merchant publishes.
 */
import {
  HOTSPOT_PRESET_ICONS,
  classifyIcon,
  presetIconSvg,
  type HotspotIconKey,
} from "@spectrum-design-lab/shared/hotspot-icons";
import type { HotspotAnimation } from "../lib/sdl3d-shared";

type Props = {
  /** Hex color string. Falls back to the default blue if null/empty. */
  color: string | null;
  /** Icon identifier — preset key, Shopify file GID, or null. */
  icon: string | null;
  /** Resolved icon URL when `icon` is a `gid://shopify/File/…`. */
  iconResolvedUrl?: string | null;
  /** Dot visual style — card / tooltip / dot / badge / icon-only / panel. */
  style: string;
  /** Animation loop — none / pulse / bounce / glow / ripple / wiggle. */
  animation: HotspotAnimation;
};

const DEFAULT_COLOR = "#3b82f6";

function PresetIconGlyph({ iconKey }: { iconKey: HotspotIconKey }) {
  if (!(iconKey in HOTSPOT_PRESET_ICONS)) return null;
  // presetIconSvg wraps the inner SVG content in a <svg viewBox> so we
  // get the same rendered glyph the storefront viewer paints.
  return (
    <span
      className="sdl-preview-dot__glyph"
      dangerouslySetInnerHTML={{ __html: presetIconSvg(iconKey, 16) }}
      aria-hidden="true"
    />
  );
}

function CustomIconGlyph({ url }: { url: string }) {
  return <img src={url} alt="" className="sdl-preview-dot__glyph" />;
}

export function Sdl3dHotspotPreviewChip({
  color,
  icon,
  iconResolvedUrl,
  style,
  animation,
}: Props) {
  const dotColor = color || DEFAULT_COLOR;
  const iconKind = classifyIcon(icon);

  // Pick a glyph to render. Preset icons resolve from the shared registry;
  // GID / URL icons need a resolved URL (the loader already plumbs these
  // via iconResolvedUrls for GIDs; URL icons already are the URL). When
  // neither resolves, the dot stays empty — matches storefront behavior
  // for unset icons.
  let glyph: React.ReactNode = null;
  if (iconKind === "preset" && icon) {
    glyph = <PresetIconGlyph iconKey={icon as HotspotIconKey} />;
  } else if (iconKind === "gid" && iconResolvedUrl) {
    glyph = <CustomIconGlyph url={iconResolvedUrl} />;
  } else if (iconKind === "url" && icon) {
    glyph = <CustomIconGlyph url={icon} />;
  }

  // Style class drives card vs dot vs icon-only sizing & shape, mirroring
  // the storefront's `.sdl3d-hotspot--<style>` modifiers.
  const styleClass = `sdl-preview-dot--style-${style || "card"}`;
  const animClass = animation && animation !== "none"
    ? `sdl-preview-dot--anim-${animation}`
    : "";

  return (
    <div
      className="sdl-preview-chip"
      role="img"
      aria-label={`Hotspot preview — ${style} style, ${animation} animation`}
    >
      <div
        className={`sdl-preview-dot ${styleClass} ${animClass}`}
        style={{ ["--sdl-preview-color" as string]: dotColor }}
      >
        {glyph}
      </div>
      <div className="sdl-preview-chip__caption">Preview</div>
    </div>
  );
}
