/**
 * Slice 8 hotspots PR #5 — render the hotspot popup's media slot
 * for editor-side surfaces (StorefrontPreview, model-viewer canvas).
 * Mirrors the TAE implementations in viewer-3d.js / viewer-360.js —
 * parallel-patch convention. Returns inner HTML the caller drops
 * into a popup card before the title via innerHTML.
 *
 * Pass `cls360 = true` when rendering inside the 360 viewer's class
 * namespace (.sdl3d-360-hotspot__media*); leave false for the
 * default .sdl3d-hotspot__media* namespace used by the 3D viewer +
 * StorefrontPreview.
 */
import { classifyVideoUrl } from "./sdl3d-shared";

function escAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}

function videoEmbedHtml(url: string): string {
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

export function buildHotspotMediaHtml(
  image: string | null | undefined,
  video: string | null | undefined,
  cls360 = false,
): string {
  const prefix = cls360 ? "sdl3d-360-hotspot" : "sdl3d-hotspot";
  let parts = "";
  if (typeof image === "string" && image.trim()) {
    parts += `<div class="${prefix}__media-image"><img src="${escAttr(image.trim())}" alt="" loading="lazy" /></div>`;
  }
  if (typeof video === "string" && video.trim()) {
    const v = videoEmbedHtml(video.trim());
    if (v) parts += `<div class="${prefix}__media-video">${v}</div>`;
  }
  return parts ? `<div class="${prefix}__media">${parts}</div>` : "";
}
