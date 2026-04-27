/**
 * Custom hook for hotspot drag interaction on model-viewer.
 * Manages drag state, pointer events, and camera-controls toggling.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { EditableHotspot } from "./Sdl3dHotspotEditor";
import { objectToMetersString } from "../lib/model-viewer-utils";

interface DragState {
  hotspotId: string;
  originalPosition: string;
  originalNormal: string | null;
  element: HTMLElement;
  active: boolean;
}

export function useHotspotDrag({
  modelRef,
  hotspots,
  viewerSettings,
  onUpdateHotspot,
  onSelectHotspot,
  setStatus,
}: {
  modelRef: React.RefObject<any>;
  hotspots: EditableHotspot[];
  viewerSettings: Record<string, any>;
  onUpdateHotspot: (id: string, patch: Partial<EditableHotspot>) => void;
  onSelectHotspot: (id: string | null) => void;
  setStatus: (msg: string) => void;
}) {
  const dragRef = useRef<DragState | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const startDrag = useCallback((hotspotId: string, element: HTMLElement) => {
    const hotspot = hotspots.find((h) => h.id === hotspotId);
    if (!hotspot) return;

    const modelViewer = modelRef.current;
    if (!modelViewer) return;

    dragRef.current = {
      hotspotId,
      originalPosition: hotspot.position || "0m 0m 0m",
      originalNormal: hotspot.normal || null,
      element,
      active: true,
    };

    // Disable camera controls during drag
    modelViewer.removeAttribute("camera-controls");
    setIsDragging(true);
    onSelectHotspot(hotspotId);
    setStatus(`Dragging ${hotspot.title || "hotspot"}…`);
  }, [hotspots, modelRef, onSelectHotspot, setStatus]);

  const moveDrag = useCallback((clientX: number, clientY: number) => {
    const drag = dragRef.current;
    if (!drag?.active) return;

    const modelViewer = modelRef.current;
    if (!modelViewer) return;

    const rect = modelViewer.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;

    const result =
      modelViewer.positionAndNormalFromPoint?.(localX, localY) ??
      modelViewer.positionAndNormalFromPoint?.(clientX, clientY);

    if (!result) return;

    const position = objectToMetersString(result.position);
    const normal = objectToMetersString(result.normal);
    if (!position) return;

    // Update DOM directly for smooth feedback (no React re-render per frame)
    drag.element.dataset.position = position;
    if (normal) {
      drag.element.dataset.normal = normal;
    }
  }, [modelRef]);

  const endDrag = useCallback((commit: boolean) => {
    const drag = dragRef.current;
    if (!drag) return;

    const modelViewer = modelRef.current;

    // Re-enable camera controls
    if (modelViewer && viewerSettings?.cameraControls !== false) {
      modelViewer.setAttribute("camera-controls", "");
    }

    if (commit && drag.active) {
      const finalPosition = drag.element.dataset.position || drag.originalPosition;
      const finalNormal = drag.element.dataset.normal || drag.originalNormal;

      if (finalPosition !== drag.originalPosition || finalNormal !== drag.originalNormal) {
        onUpdateHotspot(drag.hotspotId, {
          position: finalPosition,
          normal: finalNormal,
        });
        setStatus("Hotspot repositioned");
      } else {
        setStatus("Drag cancelled (no movement)");
      }
    } else {
      // Restore original position on cancel
      drag.element.dataset.position = drag.originalPosition;
      if (drag.originalNormal) {
        drag.element.dataset.normal = drag.originalNormal;
      }
      setStatus("Drag cancelled");
    }

    dragRef.current = null;
    setIsDragging(false);
  }, [modelRef, onUpdateHotspot, viewerSettings, setStatus]);

  // Escape key cancels drag
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && dragRef.current) {
        endDrag(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [endDrag]);

  return { isDragging, dragRef, startDrag, moveDrag, endDrag };
}
