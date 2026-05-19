import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@shopify/polaris";
import type { ImageSequenceFrame, Hotspot360 } from "../lib/sdl3d-shared";
import { interpolateHotspotPosition, isHotspot360Visible } from "../lib/sdl3d-shared";

interface DragHotspotState {
  hotspotId: string;
  active: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface Sdl3dImageSequencePreviewProps {
  frames: ImageSequenceFrame[];
  hotspots: Hotspot360[];
  selectedHotspotId: string | null;
  viewerSettingsJson: string;
  onSelectHotspot?: (id: string | null) => void;
  onPlaceHotspot?: (frame: number, x: number, y: number) => void;
  onDragHotspot?: (hotspotId: string, frame: number, x: number, y: number) => void;
  captureMode?: "none" | "placeHotspot";
}

export function Sdl3dImageSequencePreview({
  frames,
  hotspots,
  selectedHotspotId,
  viewerSettingsJson,
  onSelectHotspot,
  onPlaceHotspot,
  onDragHotspot,
  captureMode = "none",
}: Sdl3dImageSequencePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const dragStartX = useRef(0);
  const dragStartFrame = useRef(0);
  const [preloadedCount, setPreloadedCount] = useState(0);
  const hotspotDragRef = useRef<DragHotspotState | null>(null);
  const [isDraggingHotspot, setIsDraggingHotspot] = useState(false);
  const [dragPreviewPos, setDragPreviewPos] = useState<{ x: number; y: number } | null>(null);

  const frameCount = frames.length;

  // Parse viewer settings for background color
  let backgroundColor = "#0b1020";
  try {
    const settings = JSON.parse(viewerSettingsJson);
    if (settings.backgroundColor) backgroundColor = settings.backgroundColor;
  } catch { /* empty */ }

  // Append Shopify CDN width parameter for responsive sizing
  const getCdnUrl = useCallback(
    (url: string) => {
      if (!url || !url.includes("cdn.shopify.com")) return url;
      const w = containerRef.current?.clientWidth || 800;
      const cdnWidth = w <= 600 ? 800 : w <= 1200 ? 1200 : 1800;
      return url + (url.includes("?") ? "&" : "?") + `width=${cdnWidth}`;
    },
    [],
  );

  // Progressive image preloading: load every Nth frame first, fill gaps during idle
  useEffect(() => {
    if (!frames.length) return;

    const urls = frames.map((f) => f.imageUrl).filter(Boolean);
    if (!urls.length) return;

    let loaded = 0;
    const onLoad = () => {
      loaded++;
      setPreloadedCount(loaded);
    };

    // Phase 1: load every 4th frame immediately for quick scrub responsiveness
    const step = Math.max(1, Math.ceil(urls.length / 8));
    const restUrls: string[] = [];

    for (let i = 0; i < urls.length; i++) {
      if (i % step === 0) {
        const img = new Image();
        img.onload = onLoad;
        img.src = getCdnUrl(urls[i]);
      } else {
        restUrls.push(urls[i]);
      }
    }

    // Phase 2: load remaining frames via requestIdleCallback (or setTimeout fallback)
    let idx = 0;
    let cancelled = false;
    let handle: ReturnType<typeof setTimeout> | number;

    function loadBatch() {
      if (cancelled) return;
      const batchSize = 6;
      for (let j = 0; j < batchSize && idx < restUrls.length; j++, idx++) {
        const img = new Image();
        img.onload = onLoad;
        img.src = getCdnUrl(restUrls[idx]);
      }
      if (idx < restUrls.length) {
        if (window.requestIdleCallback) {
          handle = window.requestIdleCallback(loadBatch);
        } else {
          handle = setTimeout(loadBatch, 150);
        }
      }
    }

    if (window.requestIdleCallback) {
      handle = window.requestIdleCallback(loadBatch);
    } else {
      handle = setTimeout(loadBatch, 150);
    }

    return () => {
      cancelled = true;
      if (window.cancelIdleCallback && typeof handle === "number") {
        window.cancelIdleCallback(handle);
      } else {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      }
    };
  }, [frames, getCdnUrl]);

  // Auto-rotate
  useEffect(() => {
    if (!autoRotate || !frameCount) return;

    const interval = window.setInterval(() => {
      setCurrentFrame((prev) => (prev + 1) % frameCount);
    }, 80);

    return () => window.clearInterval(interval);
  }, [autoRotate, frameCount]);

  // Drag to rotate
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (captureMode === "placeHotspot") return; // Don't rotate when placing
      setIsDragging(true);
      setAutoRotate(false);
      dragStartX.current = e.clientX;
      dragStartFrame.current = currentFrame;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [currentFrame, captureMode],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging || !frameCount) return;

      const dx = e.clientX - dragStartX.current;
      const container = containerRef.current;
      const containerWidth = container?.clientWidth || 600;

      // Map full container width to full rotation
      const frameDelta = Math.round((dx / containerWidth) * frameCount);
      const newFrame = ((dragStartFrame.current + frameDelta) % frameCount + frameCount) % frameCount;
      setCurrentFrame(newFrame);
    },
    [isDragging, frameCount],
  );

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Hotspot drag handlers
  const clientToPercent = useCallback(
    (clientX: number, clientY: number) => {
      const container = containerRef.current;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)),
        y: Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100)),
      };
    },
    [],
  );

  const startHotspotDrag = useCallback(
    (hotspotId: string, e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const pos = clientToPercent(e.clientX, e.clientY);
      if (!pos) return;
      hotspotDragRef.current = {
        hotspotId,
        active: false,
        startX: e.clientX,
        startY: e.clientY,
        currentX: pos.x,
        currentY: pos.y,
      };
      setAutoRotate(false);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [clientToPercent],
  );

  const moveHotspotDrag = useCallback(
    (e: React.PointerEvent) => {
      const drag = hotspotDragRef.current;
      if (!drag) return;

      // Activation threshold: 4px
      if (!drag.active) {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        drag.active = true;
        setIsDraggingHotspot(true);
        onSelectHotspot?.(drag.hotspotId);
      }

      const pos = clientToPercent(e.clientX, e.clientY);
      if (!pos) return;

      // Shift key constrains to horizontal or vertical axis
      if (e.shiftKey) {
        const dx = Math.abs(e.clientX - drag.startX);
        const dy = Math.abs(e.clientY - drag.startY);
        if (dx > dy) {
          pos.y = drag.currentY; // lock vertical
        } else {
          pos.x = drag.currentX; // lock horizontal
        }
      }

      drag.currentX = pos.x;
      drag.currentY = pos.y;
      setDragPreviewPos({ x: pos.x, y: pos.y });
    },
    [clientToPercent, onSelectHotspot],
  );

  const endHotspotDrag = useCallback(
    (commit: boolean) => {
      const drag = hotspotDragRef.current;
      if (!drag) return;

      if (commit && drag.active) {
        onDragHotspot?.(drag.hotspotId, currentFrame, drag.currentX, drag.currentY);
      }

      hotspotDragRef.current = null;
      setIsDraggingHotspot(false);
      setDragPreviewPos(null);
    },
    [currentFrame, onDragHotspot],
  );

  // Escape cancels hotspot drag
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && hotspotDragRef.current) {
        endHotspotDrag(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [endHotspotDrag]);

  // Click to place hotspot
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (captureMode !== "placeHotspot" || !onPlaceHotspot) return;

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;

      onPlaceHotspot(currentFrame, x, y);
    },
    [captureMode, currentFrame, onPlaceHotspot],
  );

  const currentFrameData = frames[currentFrame];
  const loading = preloadedCount < Math.min(frames.length, 4);

  if (!frames.length) {
    return (
      <div className="sdl-360-preview" style={{ background: backgroundColor }}>
        <div className="sdl-360-preview__empty">
          No image frames uploaded. Upload a sequence of product images to enable the 360° viewer.
        </div>
      </div>
    );
  }

  return (
    <div className="sdl-360-preview" style={{ background: backgroundColor }}>
      <div
        ref={containerRef}
        className={`sdl-360-preview__viewport ${isDragging ? "sdl-360-preview__viewport--dragging" : ""} ${captureMode === "placeHotspot" ? "sdl-360-preview__viewport--placing" : ""} ${isDraggingHotspot ? "sdl-360-preview__viewport--hotspot-drag" : ""}`}
        onPointerDown={handlePointerDown}
        onPointerMove={(e) => {
          if (hotspotDragRef.current) {
            moveHotspotDrag(e);
          } else {
            handlePointerMove(e);
          }
        }}
        onPointerUp={(e) => {
          if (hotspotDragRef.current) {
            endHotspotDrag(true);
          } else {
            handlePointerUp();
          }
        }}
        onClick={handleClick}
        style={{ touchAction: "none", userSelect: "none" }}
      >
        {currentFrameData?.imageUrl ? (
          <img
            src={getCdnUrl(currentFrameData.imageUrl)}
            alt={`Frame ${currentFrame + 1} of ${frameCount}`}
            className="sdl-360-preview__image"
            draggable={false}
          />
        ) : (
          <div className="sdl-360-preview__loading">
            {loading ? `Loading frames (${preloadedCount}/${frames.length})...` : "Frame not available"}
          </div>
        )}

        {/* Render visible hotspots */}
        {hotspots
          .filter((h) => isHotspot360Visible(h, currentFrame))
          .map((hotspot) => {
            const isDragTarget = isDraggingHotspot && hotspotDragRef.current?.hotspotId === hotspot.id;
            const pos = isDragTarget && dragPreviewPos
              ? dragPreviewPos
              : interpolateHotspotPosition(hotspot.keyframes, currentFrame);
            if (!pos) return null;

            const isSelected = hotspot.id === selectedHotspotId;

            return (
              <button
                key={hotspot.id}
                type="button"
                className={`sdl-360-hotspot sdl-360-hotspot--${hotspot.style || "card"} ${isSelected ? "sdl-360-hotspot--active" : ""} ${isDragTarget ? "sdl-360-hotspot--dragging" : ""}`}
                style={{
                  left: `${pos.x}%`,
                  top: `${pos.y}%`,
                  ["--sdl3d-hotspot-color" as string]: hotspot.color || "#3b82f6",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isDraggingHotspot) onSelectHotspot?.(hotspot.id);
                }}
              >
                <span
                  className="sdl-360-hotspot__dot"
                  onPointerDown={(e) => {
                    if (onDragHotspot) startHotspotDrag(hotspot.id, e);
                  }}
                  style={{ cursor: onDragHotspot ? (isDragTarget ? "grabbing" : "grab") : undefined }}
                >
                  {hotspot.sortOrder}
                </span>
                <span className="sdl-360-hotspot__card">
                  <strong className="sdl-360-hotspot__title">{hotspot.title}</strong>
                  {hotspot.body ? (
                    <span className="sdl-360-hotspot__body">{hotspot.body}</span>
                  ) : null}
                </span>
              </button>
            );
          })}
      </div>

      {/* Controls bar */}
      <div className="sdl-360-preview__controls">
        <div className="sdl-360-preview__frame-info">
          Frame {currentFrame + 1} / {frameCount}
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(0, frameCount - 1)}
          value={currentFrame}
          onChange={(e) => {
            setCurrentFrame(Number(e.target.value));
            setAutoRotate(false);
          }}
          className="sdl-360-preview__scrubber"
        />
        <Button
          size="slim"
          variant={autoRotate ? "primary" : "secondary"}
          onClick={() => setAutoRotate((prev) => !prev)}
        >
          {autoRotate ? "Stop" : "Auto-rotate"}
        </Button>
      </div>
    </div>
  );
}
