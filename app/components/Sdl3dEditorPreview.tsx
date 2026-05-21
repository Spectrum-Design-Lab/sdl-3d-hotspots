import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditableHotspot } from "./Sdl3dHotspotEditor";
import { createPreviewHotspotNode } from "./preview-hotspot-node";
import { useHotspotDrag } from "./useHotspotDrag";
import {
  ensureModelViewerLoaded,
  setBooleanAttribute,
  objectToMetersString,
  orbitToString,
  parseViewerSettings,
} from "../lib/model-viewer-utils";

type CaptureMode =
  | null
  | "addHotspot"
  | "setSelectedPosition"
  | "setSelectedFocusTarget"
  | "setViewerTarget";

type PreviewMode = "edit" | "view";

export function Sdl3dEditorPreview({
  modelSourceUrl,
  posterUrl,
  viewerSettingsJson,
  hotspots,
  selectedHotspotId,
  onAddHotspot,
  onUpdateHotspot,
  onSelectHotspot,
  onReplaceViewerSettingsJson,
}: {
  modelSourceUrl: string | null;
  posterUrl: string | null;
  viewerSettingsJson: string;
  hotspots: EditableHotspot[] | undefined;
  selectedHotspotId: string | null;
  onAddHotspot: (hotspot: EditableHotspot) => void;
  onUpdateHotspot: (id: string, patch: Partial<EditableHotspot>) => void;
  onSelectHotspot: (id: string | null) => void;
  onReplaceViewerSettingsJson: (nextJson: string) => void;
}) {
  const safeHotspots = Array.isArray(hotspots) ? hotspots : [];
  const modelRef = useRef<any>(null);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);

  const [ready, setReady] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("edit");
  const [status, setStatus] = useState("Preview ready");

  const viewerSettings = useMemo(
    () => parseViewerSettings(viewerSettingsJson),
    [viewerSettingsJson],
  );

  const selectedHotspot =
    safeHotspots.find((hotspot) => hotspot.id === selectedHotspotId) ?? null;

  const { isDragging, dragRef, startDrag, moveDrag, endDrag } = useHotspotDrag({
    modelRef,
    hotspots: safeHotspots,
    viewerSettings,
    onUpdateHotspot,
    onSelectHotspot,
    setStatus,
  });

  useEffect(() => {
    ensureModelViewerLoaded()
      .then(() => setReady(true))
      .catch((error) => {
        console.error(error);
        setStatus("Failed to load 3D preview component");
      });
  }, []);

  // Apply viewer settings to model-viewer element
  useEffect(() => {
    const modelViewer = modelRef.current;
    if (!ready || !modelViewer) return;

    setBooleanAttribute(modelViewer, "camera-controls", viewerSettings?.cameraControls !== false);
    setBooleanAttribute(modelViewer, "auto-rotate", viewerSettings?.autoRotate === true);

    if (viewerSettings?.cameraOrbit) {
      modelViewer.setAttribute("camera-orbit", viewerSettings.cameraOrbit);
    } else {
      modelViewer.removeAttribute("camera-orbit");
    }

    if (viewerSettings?.cameraTarget) {
      modelViewer.setAttribute("camera-target", viewerSettings.cameraTarget);
    } else {
      modelViewer.removeAttribute("camera-target");
    }

    if (viewerSettings?.fieldOfView) {
      modelViewer.setAttribute("field-of-view", viewerSettings.fieldOfView);
    } else {
      modelViewer.removeAttribute("field-of-view");
    }

    if (typeof viewerSettings?.exposure === "number") {
      modelViewer.setAttribute("exposure", String(viewerSettings.exposure));
    } else {
      modelViewer.removeAttribute("exposure");
    }

    if (viewerSettings?.interactionPrompt) {
      modelViewer.setAttribute("interaction-prompt", viewerSettings.interactionPrompt);
    }

    const horizontalOnly =
      viewerSettings?.horizontalLock === true ||
      viewerSettings?.rotationMode === "horizontal_only";

    if (horizontalOnly) {
      const lockedPolarAngle =
        viewerSettings?.lockedPolarAngle ||
        (typeof viewerSettings?.cameraOrbit === "string"
          ? viewerSettings.cameraOrbit.trim().split(/\s+/)[1]
          : null) ||
        "75deg";

      modelViewer.setAttribute("min-camera-orbit", `auto ${lockedPolarAngle} auto`);
      modelViewer.setAttribute("max-camera-orbit", `auto ${lockedPolarAngle} auto`);
    } else {
      if (viewerSettings?.minCameraOrbit) {
        modelViewer.setAttribute("min-camera-orbit", viewerSettings.minCameraOrbit);
      } else {
        modelViewer.removeAttribute("min-camera-orbit");
      }

      if (viewerSettings?.maxCameraOrbit) {
        modelViewer.setAttribute("max-camera-orbit", viewerSettings.maxCameraOrbit);
      } else {
        modelViewer.removeAttribute("max-camera-orbit");
      }
    }

    if (viewerSettings?.backgroundColor) {
      modelViewer.style.background = viewerSettings.backgroundColor;
    } else {
      modelViewer.style.background = "#0b1020";
    }
  }, [ready, viewerSettings]);

  // Render hotspot nodes on model-viewer
  useEffect(() => {
    const modelViewer = modelRef.current;
    if (!ready || !modelViewer) return;

    modelViewer.querySelectorAll(".sdl3d-hotspot").forEach((node: Element) => node.remove());

    const isEdit = previewMode === "edit";

    safeHotspots
      .filter((hotspot) => hotspot.visible !== false && hotspot.position)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .forEach((hotspot, index) => {
        const node = createPreviewHotspotNode(
          hotspot,
          index,
          (id) => {
            onSelectHotspot(id);
            if (hotspot.focusTarget) {
              modelViewer.setAttribute("camera-target", hotspot.focusTarget);
            }
            if (hotspot.focusOrbit) {
              modelViewer.setAttribute("camera-orbit", hotspot.focusOrbit);
            }
          },
          isEdit ? startDrag : undefined,
        );

        if (hotspot.id === selectedHotspotId) {
          node.classList.add("is-active");
          node.style.zIndex = "2";
          node.style.filter = "drop-shadow(0 0 14px rgba(59,130,246,0.55))";
        }

        modelViewer.appendChild(node);
      });
  }, [ready, safeHotspots, selectedHotspotId, onSelectHotspot, startDrag, previewMode]);

  function updateViewerSettings(patch: Record<string, unknown>) {
    const next = {
      ...parseViewerSettings(viewerSettingsJson),
      ...patch,
    };
    onReplaceViewerSettingsJson(JSON.stringify(next, null, 2));
  }

  function captureFromClick(clientX: number, clientY: number) {
    const modelViewer = modelRef.current;
    if (!modelViewer || !captureMode) return;

    const rect = modelViewer.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;

    const result =
      modelViewer.positionAndNormalFromPoint?.(localX, localY) ??
      modelViewer.positionAndNormalFromPoint?.(clientX, clientY);

    if (!result) {
      setStatus("No surface point found at that click");
      return;
    }

    const position = objectToMetersString(result.position);
    const normal = objectToMetersString(result.normal);

    if (!position) {
      setStatus("Could not resolve clicked 3D position");
      return;
    }

    if (captureMode === "addHotspot") {
      const nextHotspot: EditableHotspot = {
        id: `hs_${Math.random().toString(36).slice(2, 10)}`,
        sortOrder: safeHotspots.length + 1,
        visible: true,
        title: `Hotspot ${safeHotspots.length + 1}`,
        body: "",
        icon: "plus",
        style: "card",
        color: "#3b82f6",
        animation: "none",
        position,
        normal,
        focusTarget: position,
        focusOrbit: null,
        ctaLabel: null,
        ctaUrl: null,
      };

      onAddHotspot(nextHotspot);
      onSelectHotspot(nextHotspot.id);
      setStatus("Added hotspot from clicked point");
    }

    if (captureMode === "setSelectedPosition" && selectedHotspotId) {
      onUpdateHotspot(selectedHotspotId, { position, normal });
      setStatus("Updated selected hotspot position");
    }

    if (captureMode === "setSelectedFocusTarget" && selectedHotspotId) {
      onUpdateHotspot(selectedHotspotId, { focusTarget: position });
      setStatus("Updated selected hotspot focus target");
    }

    if (captureMode === "setViewerTarget") {
      updateViewerSettings({ cameraTarget: position });
      setStatus("Updated viewer camera target");
    }

    setCaptureMode(null);
  }

  const captureCurrentViewToSelectedHotspot = useCallback(() => {
    const modelViewer = modelRef.current;
    if (!modelViewer || !selectedHotspotId) return;

    const orbit =
      orbitToString(modelViewer.getCameraOrbit?.()) ||
      modelViewer.getAttribute("camera-orbit");
    if (!orbit) {
      setStatus("Could not capture current orbit");
      return;
    }

    onUpdateHotspot(selectedHotspotId, { focusOrbit: orbit });
    setStatus("Captured current orbit to selected hotspot");
  }, [selectedHotspotId, onUpdateHotspot]);

  const captureCurrentViewToViewer = useCallback(() => {
    const modelViewer = modelRef.current;
    if (!modelViewer) return;

    const orbit =
      orbitToString(modelViewer.getCameraOrbit?.()) ||
      modelViewer.getAttribute("camera-orbit");
    if (!orbit) {
      setStatus("Could not capture current orbit");
      return;
    }

    updateViewerSettings({ cameraOrbit: orbit });
    setStatus("Captured current camera orbit");
  }, [viewerSettingsJson, onReplaceViewerSettingsJson]);

  const captureCurrentTargetToViewer = useCallback(() => {
    const modelViewer = modelRef.current;
    if (!modelViewer) return;

    const target =
      objectToMetersString(modelViewer.getCameraTarget?.()) ||
      modelViewer.getAttribute("camera-target");
    if (!target) {
      setStatus("Could not capture current target");
      return;
    }

    updateViewerSettings({ cameraTarget: target });
    setStatus("Captured current camera target");
  }, [viewerSettingsJson, onReplaceViewerSettingsJson]);

  const captureCurrentTargetToSelectedHotspot = useCallback(() => {
    const modelViewer = modelRef.current;
    if (!modelViewer || !selectedHotspotId) return;

    const target =
      objectToMetersString(modelViewer.getCameraTarget?.()) ||
      modelViewer.getAttribute("camera-target");
    if (!target) {
      setStatus("Could not capture current target");
      return;
    }

    onUpdateHotspot(selectedHotspotId, { focusTarget: target });
    setStatus("Captured current target to selected hotspot");
  }, [selectedHotspotId, onUpdateHotspot]);

  function frameSelectedHotspot() {
    const modelViewer = modelRef.current;
    if (!modelViewer || !selectedHotspot) return;

    const target = selectedHotspot.focusTarget || selectedHotspot.position;
    if (target) {
      modelViewer.setAttribute("camera-target", target);
    }

    if (selectedHotspot.focusOrbit) {
      modelViewer.setAttribute("camera-orbit", selectedHotspot.focusOrbit);
    } else {
      const currentOrbit =
        orbitToString(modelViewer.getCameraOrbit?.()) ||
        modelViewer.getAttribute("camera-orbit");

      if (currentOrbit) {
        const parts = currentOrbit.trim().split(/\s+/);
        if (parts.length === 3) {
          modelViewer.setAttribute("camera-orbit", `${parts[0]} ${parts[1]} 85%`);
        }
      }
    }

    setStatus(`Framed ${selectedHotspot.title || "selected hotspot"}`);
  }

  function resetPreviewCamera() {
    const modelViewer = modelRef.current;
    if (!modelViewer) return;

    if (viewerSettings?.cameraOrbit) {
      modelViewer.setAttribute("camera-orbit", viewerSettings.cameraOrbit);
    } else {
      modelViewer.removeAttribute("camera-orbit");
    }

    if (viewerSettings?.cameraTarget) {
      modelViewer.setAttribute("camera-target", viewerSettings.cameraTarget);
    } else {
      modelViewer.removeAttribute("camera-target");
    }

    setStatus("Reset preview camera");
  }

  const isEditMode = previewMode === "edit";

  return (
    <div
      className={`sdl-preview ${isDragging ? "sdl-preview--dragging" : ""}`}
      onPointerDown={(event) => {
        pointerDownRef.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerMove={(event) => {
        if (dragRef.current?.active) {
          moveDrag(event.clientX, event.clientY);
        }
      }}
      onPointerUp={(event) => {
        // End drag if active
        if (dragRef.current?.active) {
          endDrag(true);
          return;
        }

        if (!captureMode || !isEditMode) return;

        const start = pointerDownRef.current;
        if (!start) return;

        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.sqrt(dx * dx + dy * dy) <= 6) {
          captureFromClick(event.clientX, event.clientY);
        }
      }}
    >
      {/* Floating toolbar */}
      <div className="sdl-preview__toolbar">
        {isEditMode ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div className="sdl-toolbar-group">
              <button
                type="button"
                className={`sdl-toolbar-btn ${captureMode === "addHotspot" ? "sdl-toolbar-btn--active" : ""}`}
                onClick={() => setCaptureMode(captureMode === "addHotspot" ? null : "addHotspot")}
              >
                + Add hotspot
              </button>
              <button
                type="button"
                className={`sdl-toolbar-btn ${captureMode === "setSelectedPosition" ? "sdl-toolbar-btn--active" : ""}`}
                onClick={() => setCaptureMode(captureMode === "setSelectedPosition" ? null : "setSelectedPosition")}
                disabled={!selectedHotspotId}
              >
                Set position
              </button>
              <button
                type="button"
                className={`sdl-toolbar-btn ${captureMode === "setSelectedFocusTarget" ? "sdl-toolbar-btn--active" : ""}`}
                onClick={() => setCaptureMode(captureMode === "setSelectedFocusTarget" ? null : "setSelectedFocusTarget")}
                disabled={!selectedHotspotId}
              >
                Set focus
              </button>
              <button
                type="button"
                className={`sdl-toolbar-btn ${captureMode === "setViewerTarget" ? "sdl-toolbar-btn--active" : ""}`}
                onClick={() => setCaptureMode(captureMode === "setViewerTarget" ? null : "setViewerTarget")}
              >
                Set target
              </button>
            </div>

            <div className="sdl-toolbar-group">
              <button
                type="button"
                className="sdl-toolbar-btn"
                onClick={captureCurrentViewToSelectedHotspot}
                disabled={!selectedHotspotId}
              >
                Capture orbit
              </button>
              <button
                type="button"
                className="sdl-toolbar-btn"
                onClick={captureCurrentTargetToSelectedHotspot}
                disabled={!selectedHotspotId}
              >
                Capture target
              </button>
              <button type="button" className="sdl-toolbar-btn" onClick={captureCurrentViewToViewer}>
                Save orbit
              </button>
              <button type="button" className="sdl-toolbar-btn" onClick={captureCurrentTargetToViewer}>
                Save target
              </button>
              <button
                type="button"
                className="sdl-toolbar-btn"
                onClick={frameSelectedHotspot}
                disabled={!selectedHotspotId}
              >
                Frame
              </button>
              <button type="button" className="sdl-toolbar-btn" onClick={resetPreviewCamera}>
                Reset
              </button>
            </div>
          </div>
        ) : <div />}

        <div className="sdl-mode-toggle">
          <button
            type="button"
            className={`sdl-mode-toggle__btn ${isEditMode ? "sdl-mode-toggle__btn--active" : ""}`}
            onClick={() => { setPreviewMode("edit"); }}
          >
            Edit
          </button>
          <button
            type="button"
            className={`sdl-mode-toggle__btn ${!isEditMode ? "sdl-mode-toggle__btn--active" : ""}`}
            onClick={() => { setPreviewMode("view"); setCaptureMode(null); }}
          >
            View
          </button>
        </div>
      </div>

      {/* Capture hint */}
      {captureMode ? (
        <div className="sdl-preview__capture-hint">
          Capture armed: <strong>{captureMode}</strong> — click on the model surface to capture.
        </div>
      ) : null}

      {/* Status bar */}
      <div className="sdl-preview__status">
        <span className="sdl-preview__status-text">{status}</span>
        {selectedHotspot ? (
          <span className="sdl-preview__selected-badge">
            {selectedHotspot.title || "Hotspot"}
          </span>
        ) : null}
      </div>

      {/* Viewer */}
      {modelSourceUrl ? (
        ready ? (
          <model-viewer
            ref={modelRef}
            src={modelSourceUrl}
            {...(posterUrl ? { poster: posterUrl } : {})}
            camera-controls
            style={{ width: "100%", height: 520, background: "#0b1020" }}
          />
        ) : (
          <div className="sdl-preview__empty">Loading 3D preview…</div>
        )
      ) : (
        <div className="sdl-preview__empty">
          Select a model file first to enable the live 3D preview.
        </div>
      )}
    </div>
  );
}
