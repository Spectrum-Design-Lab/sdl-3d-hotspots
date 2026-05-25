/**
 * Hotspot popup media + icon HTML builders.
 *
 * Shared between viewer-3d.ts and viewer-360.ts. Pulls icon presets +
 * video URL classification from @spectrum-design-lab/shared so the
 * single source of truth is the same as the admin editor.
 *
 * Returns raw HTML strings written into innerHTML — input is either a
 * preset name (vetted SVG constant), a Shopify GID (resolved to URL at
 * publish time), or an absolute URL. No untrusted input reaches DOM
 * here.
 */
import { HOTSPOT_PRESET_ICONS, classifyIcon } from "@spectrum-design-lab/shared/hotspot-icons";
import { classifyVideoUrl } from "@spectrum-design-lab/shared/video-classify";

function escAttr(s: string): string {
  return String(s).replace(/"/g, "&quot;");
}

/**
 * Render a hotspot icon. Three accepted shapes:
 * - preset name → inline SVG from the shared library (14×14 render size)
 * - URL → <img>
 * - anything else (incl. unresolved GID) → empty
 */
export function iconHtml(value: string | null | undefined): string {
  const kind = classifyIcon(value);
  if (kind === "none") return "";
  const v = (value as string).trim();
  if (kind === "preset") {
    return `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">${HOTSPOT_PRESET_ICONS[v as keyof typeof HOTSPOT_PRESET_ICONS]}</svg>`;
  }
  if (kind === "url") {
    return `<img src="${escAttr(v)}" alt="" />`;
  }
  return "";
}

/**
 * Build a video embed for a hotspot popup. YouTube / Vimeo via
 * iframe; direct .mp4 / .webm via <video controls>. Unknown URL
 * shapes render nothing.
 */
export function videoEmbedHtml(url: string): string {
  const kind = classifyVideoUrl(url);
  if (kind === "youtube") {
    const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]+)/i);
    return m
      ? `<iframe src="https://www.youtube.com/embed/${escAttr(m[1])}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>`
      : "";
  }
  if (kind === "vimeo") {
    const vm = url.match(/vimeo\.com\/(\d+)/i);
    return vm
      ? `<iframe src="https://player.vimeo.com/video/${escAttr(vm[1])}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe>`
      : "";
  }
  if (kind === "file") {
    return `<video src="${escAttr(url)}" controls preload="metadata"></video>`;
  }
  return "";
}

/**
 * Compose the media block written into the sidebar detail view. The
 * variant arg selects the BEM modifier (3D dots use `sdl3d-hotspot__`,
 * 360 dots use `sdl3d-360-hotspot__`); same markup otherwise.
 */
export function mediaHtml(
  image: string | null | undefined,
  video: string | null | undefined,
  variant: "3d" | "360",
): string {
  const cls = variant === "360" ? "sdl3d-360-hotspot" : "sdl3d-hotspot";
  let parts = "";
  if (typeof image === "string" && image.trim()) {
    parts += `<div class="${cls}__media-image"><img src="${escAttr(image.trim())}" alt="" loading="lazy" /></div>`;
  }
  if (typeof video === "string" && video.trim()) {
    const v = videoEmbedHtml(video.trim());
    if (v) parts += `<div class="${cls}__media-video">${v}</div>`;
  }
  return parts ? `<div class="${cls}__media">${parts}</div>` : "";
}
