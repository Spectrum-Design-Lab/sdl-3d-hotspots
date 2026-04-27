/**
 * Shared model-viewer utilities for admin preview components.
 * NOT a .server.ts file — these are needed client-side.
 */

export const MODEL_VIEWER_VERSION = "4.2.0";

let modelViewerLoadPromise: Promise<void> | null = null;

export function ensureModelViewerLoaded() {
  if (typeof customElements !== "undefined" && customElements.get("model-viewer")) {
    return Promise.resolve();
  }

  if (modelViewerLoadPromise) {
    return modelViewerLoadPromise;
  }

  modelViewerLoadPromise = import("@google/model-viewer").then(() => {});

  return modelViewerLoadPromise;
}

export function setBooleanAttribute(el: Element, name: string, enabled: boolean) {
  if (enabled) el.setAttribute(name, "");
  else el.removeAttribute(name);
}

export function objectToMetersString(value: any): string | null {
  if (!value) return null;

  if (typeof value === "string") return value;

  if (typeof value.toString === "function" && value.toString() !== "[object Object]") {
    return value.toString();
  }

  if ("x" in value && "y" in value && "z" in value) {
    return `${value.x}m ${value.y}m ${value.z}m`;
  }

  return null;
}

export function orbitToString(value: any): string | null {
  if (!value) return null;

  if (typeof value === "string") return value;

  if (typeof value.toString === "function" && value.toString() !== "[object Object]") {
    return value.toString();
  }

  return null;
}

export function parseViewerSettings(viewerSettingsJson: string) {
  try {
    return JSON.parse(viewerSettingsJson);
  } catch {
    return {};
  }
}
