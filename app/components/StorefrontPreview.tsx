import { useEffect, useRef, useState } from "react";
import type { EditableHotspot } from "./Sdl3dHotspotEditor";
import { classifyIcon, presetIconSvg, type HotspotIconKey } from "../lib/hotspot-icons";

/**
 * StorefrontPreview renders a simulated storefront product block inside the admin editor.
 * It replicates the exact HTML structure, CSS, and JS behavior of the Theme App Extension
 * so merchants can see exactly what customers will see — updated live as settings change.
 */

type DeviceFrame = "desktop" | "tablet" | "mobile";

const DEVICE_WIDTHS: Record<DeviceFrame, number | null> = {
  desktop: null,
  tablet: 768,
  mobile: 375,
};

interface StorefrontPreviewProps {
  modelSourceUrl: string | null;
  posterUrl: string | null;
  viewerSettingsJson: string;
  hotspots: EditableHotspot[];
  enabled: boolean;
  viewerHeight?: number;
  backgroundOverride?: string | null;
}

export function StorefrontPreview({
  modelSourceUrl,
  posterUrl,
  viewerSettingsJson,
  hotspots,
  enabled,
  viewerHeight = 520,
  backgroundOverride = null,
}: StorefrontPreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [device, setDevice] = useState<DeviceFrame>("desktop");

  // model-viewer is already loaded by EditorPreview — just check
  useEffect(() => {
    if (typeof customElements !== "undefined" && customElements.get("model-viewer")) {
      setReady(true);
      return;
    }

    const check = setInterval(() => {
      if (typeof customElements !== "undefined" && customElements.get("model-viewer")) {
        setReady(true);
        clearInterval(check);
      }
    }, 200);

    return () => clearInterval(check);
  }, []);

  // Apply viewer settings (mirrors viewer.js applyViewerSettings)
  useEffect(() => {
    const modelViewer = modelRef.current;
    if (!ready || !modelViewer) return;

    let settings: Record<string, any> = {};
    try {
      settings = JSON.parse(viewerSettingsJson);
    } catch { /* empty */ }

    // Boolean attributes
    if (settings.cameraControls !== false) {
      modelViewer.setAttribute("camera-controls", "");
    } else {
      modelViewer.removeAttribute("camera-controls");
    }
    if (settings.autoRotate === true) {
      modelViewer.setAttribute("auto-rotate", "");
    } else {
      modelViewer.removeAttribute("auto-rotate");
    }

    // String attributes
    if (settings.cameraOrbit) modelViewer.setAttribute("camera-orbit", settings.cameraOrbit);
    else modelViewer.removeAttribute("camera-orbit");

    if (settings.cameraTarget) modelViewer.setAttribute("camera-target", settings.cameraTarget);
    else modelViewer.removeAttribute("camera-target");

    if (settings.fieldOfView) modelViewer.setAttribute("field-of-view", settings.fieldOfView);
    else modelViewer.removeAttribute("field-of-view");

    if (typeof settings.exposure === "number") modelViewer.setAttribute("exposure", String(settings.exposure));
    else modelViewer.removeAttribute("exposure");

    if (settings.interactionPrompt) modelViewer.setAttribute("interaction-prompt", settings.interactionPrompt);

    // Horizontal lock
    const horizontalOnly = settings.horizontalLock === true || settings.rotationMode === "horizontal_only";
    if (horizontalOnly) {
      const polar = settings.lockedPolarAngle
        || (typeof settings.cameraOrbit === "string" ? settings.cameraOrbit.trim().split(/\s+/)[1] : null)
        || "75deg";
      modelViewer.setAttribute("min-camera-orbit", `auto ${polar} auto`);
      modelViewer.setAttribute("max-camera-orbit", `auto ${polar} auto`);
    } else {
      if (settings.minCameraOrbit) modelViewer.setAttribute("min-camera-orbit", settings.minCameraOrbit);
      else modelViewer.removeAttribute("min-camera-orbit");
      if (settings.maxCameraOrbit) modelViewer.setAttribute("max-camera-orbit", settings.maxCameraOrbit);
      else modelViewer.removeAttribute("max-camera-orbit");
    }

    // Background
    const bg = backgroundOverride || settings.backgroundColor || "#0b1020";
    const root = rootRef.current;
    if (root) root.style.setProperty("--sdl3d-background", bg);

  }, [ready, viewerSettingsJson, backgroundOverride]);

  // Apply hotspots (mirrors viewer.js applyHotspots)
  useEffect(() => {
    const modelViewer = modelRef.current;
    if (!ready || !modelViewer) return;

    // Clear existing
    modelViewer.querySelectorAll(".sdl3d-hotspot").forEach((n: Element) => n.remove());

    const visible = hotspots
      .filter((h) => h.visible !== false && h.position)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    visible.forEach((hotspot, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `sdl3d-hotspot sdl3d-hotspot--${hotspot.style || "card"}`;
      button.slot = `hotspot-${hotspot.id || index + 1}`;
      button.dataset.position = hotspot.position || "0m 0m 0m";
      if (hotspot.normal) button.dataset.normal = hotspot.normal;
      if (hotspot.color) button.style.setProperty("--sdl3d-hotspot-color", hotspot.color);
      if (hotspot.focusTarget) button.dataset.focusTarget = hotspot.focusTarget;
      else if (hotspot.position) button.dataset.focusTarget = hotspot.position;
      if (hotspot.focusOrbit) button.dataset.focusOrbit = hotspot.focusOrbit;
      button.setAttribute("aria-label", hotspot.title || `Hotspot ${index + 1}`);

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

      const card = document.createElement("span");
      card.className = "sdl3d-hotspot__card";

      const title = document.createElement("strong");
      title.className = "sdl3d-hotspot__title";
      title.textContent = hotspot.title || `Hotspot ${index + 1}`;
      card.appendChild(title);

      if (hotspot.body) {
        const body = document.createElement("span");
        body.className = "sdl3d-hotspot__body";
        body.textContent = hotspot.body;
        card.appendChild(body);
      }

      button.appendChild(dot);
      button.appendChild(card);

      // Click -> camera animation (same as storefront)
      button.addEventListener("click", () => {
        if (button.dataset.focusTarget) {
          modelViewer.setAttribute("camera-target", button.dataset.focusTarget);
        }
        if (button.dataset.focusOrbit) {
          modelViewer.setAttribute("camera-orbit", button.dataset.focusOrbit);
        }
        modelViewer.querySelectorAll(".sdl3d-hotspot.is-active").forEach((n: Element) => n.classList.remove("is-active"));
        button.classList.add("is-active");
      });

      modelViewer.appendChild(button);
    });
  }, [ready, hotspots]);

  const deviceWidth = DEVICE_WIDTHS[device];
  const height = viewerHeight;

  if (!enabled) {
    return (
      <div
        className="sdl-storefront-preview sdl-storefront-preview--collapsed"
        style={{ background: "#ffffff", minHeight: 48, padding: 12, borderRadius: 6 }}
      />
    );
  }

  if (!modelSourceUrl) {
    return (
      <div className="sdl-storefront-preview">
        <div className="sdl-storefront-preview__frame">
          <div className="sdl3d-block">
            <div className="sdl3d-block__message">No model file is assigned to this product.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sdl-storefront-preview">
      <div className="sdl-storefront-preview__toolbar">
        <div className="sdl-storefront-preview__devices">
          {(["desktop", "tablet", "mobile"] as DeviceFrame[]).map((d) => (
            <button
              key={d}
              type="button"
              className={`sdl-storefront-preview__device-btn ${device === d ? "sdl-storefront-preview__device-btn--active" : ""}`}
              onClick={() => setDevice(d)}
            >
              {d === "desktop" ? "Desktop" : d === "tablet" ? "Tablet" : "Mobile"}
            </button>
          ))}
        </div>
      </div>

      <div
        className="sdl-storefront-preview__frame"
        style={deviceWidth ? { maxWidth: deviceWidth } : undefined}
      >
        <div className="sdl3d-block" style={{ ["--sdl3d-height" as string]: `${height}px` }}>
          <div
            ref={rootRef}
            className="sdl3d-viewer"
            style={{ ["--sdl3d-background" as string]: "#0b1020" }}
          >
            {ready ? (
              <model-viewer
                ref={modelRef}
                class="sdl3d-viewer__model"
                src={modelSourceUrl}
                {...(posterUrl ? { poster: posterUrl } : {})}
                camera-controls
                auto-rotate
                loading="eager"
                reveal="auto"
                interaction-prompt="auto"
                style={{ width: "100%", height }}
              />
            ) : (
              <div style={{ color: "rgba(255,255,255,0.5)", padding: 24, textAlign: "center" }}>
                Loading preview…
              </div>
            )}

            <button
              type="button"
              className="sdl3d-fullscreen-button"
              onClick={() => rootRef.current?.requestFullscreen?.()}
            >
              Fullscreen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
