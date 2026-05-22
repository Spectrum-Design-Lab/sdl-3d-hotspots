/**
 * Creates a DOM node for a hotspot in the model-viewer preview.
 * Pure DOM function — no React dependencies.
 */
import type { EditableHotspot } from "./Sdl3dHotspotEditor";
import { classifyIcon, presetIconSvg, type HotspotIconKey } from "../lib/hotspot-icons";

export function createPreviewHotspotNode(
  hotspot: EditableHotspot,
  index: number,
  onActivate: (id: string) => void,
  onDragStart?: (hotspotId: string, element: HTMLElement) => void,
) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `sdl3d-hotspot sdl3d-hotspot--${hotspot.style || "card"}`;
  button.slot = `hotspot-${hotspot.id || index + 1}`;
  button.dataset.position = hotspot.position || "0m 0m 0m";

  if (hotspot.normal) {
    button.dataset.normal = hotspot.normal;
  }

  if (hotspot.color) {
    button.style.setProperty("--sdl3d-hotspot-color", hotspot.color);
  }

  const dot = document.createElement("span");
  dot.className = "sdl3d-hotspot__dot";
  const iconKind = classifyIcon(hotspot.icon);
  if (iconKind === "preset" && hotspot.icon) {
    dot.classList.add("sdl3d-hotspot__dot--icon");
    dot.innerHTML = presetIconSvg(hotspot.icon as HotspotIconKey, 14);
  } else if (iconKind === "url" && hotspot.icon) {
    dot.classList.add("sdl3d-hotspot__dot--icon");
    const img = document.createElement("img");
    img.src = hotspot.icon;
    img.alt = "";
    dot.appendChild(img);
  } else {
    dot.textContent = String(index + 1);
  }

  // Slice 8 hotspots PR #5 follow-up — popup card stripped to match
  // the storefront. Hotspot info (title / body / image / video / CTA)
  // lives in the editor's right-side inspector and the storefront's
  // sidebar detail view; the canvas dot stays minimal.
  button.appendChild(dot);

  // Drag initiation on the dot element
  if (onDragStart) {
    let dotDownPos: { x: number; y: number } | null = null;

    dot.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      dotDownPos = { x: e.clientX, y: e.clientY };
    });

    dot.addEventListener("pointermove", (e) => {
      if (!dotDownPos) return;
      const dx = e.clientX - dotDownPos.x;
      const dy = e.clientY - dotDownPos.y;
      // Start drag after 4px movement threshold
      if (Math.sqrt(dx * dx + dy * dy) > 4) {
        dotDownPos = null;
        onDragStart(hotspot.id, button);
      }
    });

    dot.addEventListener("pointerup", () => {
      if (dotDownPos) {
        // Was a click, not a drag
        onActivate(hotspot.id);
      }
      dotDownPos = null;
    });

    dot.style.cursor = "grab";
    dot.style.touchAction = "none";
  }

  button.addEventListener("click", (e) => {
    // Prevent click when drag handlers are on the dot (clicks go through dot handler)
    if (onDragStart && (e.target as HTMLElement).classList.contains("sdl3d-hotspot__dot")) {
      return;
    }
    onActivate(hotspot.id);
  });

  return button;
}
