import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@shopify/polaris";
import type { ImageSequenceFrame, Hotspot360 } from "../lib/sdl3d-shared";
import { interpolateHotspotPosition, isHotspot360Visible } from "../lib/sdl3d-shared";
import { classifyIcon, presetIconSvg, type HotspotIconKey } from "@spectrum-design-lab/shared";

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

  // Slice 9 follow-up — selected hotspot feeds the timeline overlay
  // (keyframe markers + visible-range band). Null when nothing's
  // selected, in which case the timeline behaves as a plain scrubber.
  const selectedTimelineHotspot =
    hotspots.find((h) => h.id === selectedHotspotId) ?? null;
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

        {/* Render visible hotspots — PR #6 wrap-aware: pass frameCount so
            hotspots with visibleFrameStart > visibleFrameEnd interpret the
            range as "wraps around the seam" and interpolate across it. */}
        {hotspots
          .filter((h) => isHotspot360Visible(h, currentFrame, frameCount))
          .map((hotspot) => {
            const wraps = hotspot.visibleFrameStart > hotspot.visibleFrameEnd;
            const isDragTarget = isDraggingHotspot && hotspotDragRef.current?.hotspotId === hotspot.id;
            const pos = isDragTarget && dragPreviewPos
              ? dragPreviewPos
              : interpolateHotspotPosition(hotspot.keyframes, currentFrame, {
                  wrap: wraps,
                  totalFrames: frameCount,
                });
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
                {(() => {
                  const iconKind = classifyIcon(hotspot.icon);
                  const hasPreset = iconKind === "preset" && hotspot.icon;
                  const hasUrl = iconKind === "url" && hotspot.icon;
                  const hasIcon = hasPreset || hasUrl;
                  return (
                    <span
                      className={`sdl-360-hotspot__dot${hasIcon ? " sdl-360-hotspot__dot--icon" : ""}`}
                      onPointerDown={(e) => {
                        if (onDragHotspot) startHotspotDrag(hotspot.id, e);
                      }}
                      style={{ cursor: onDragHotspot ? (isDragTarget ? "grabbing" : "grab") : undefined }}
                      {...(hasPreset
                        ? {
                            dangerouslySetInnerHTML: {
                              __html: presetIconSvg(hotspot.icon as HotspotIconKey, 14),
                            },
                          }
                        : {})}
                    >
                      {hasPreset ? null : hasUrl ? <img src={hotspot.icon!} alt="" /> : hotspot.sortOrder}
                    </span>
                  );
                })()}
                {/* Slice 8 hotspots PR #5 follow-up — popup card stripped.
                    All hotspot info (title / body / image / video / CTA)
                    surfaces in the editor's right-side inspector and the
                    storefront's sidebar detail view. */}
              </button>
            );
          })}
      </div>

      {/* Controls bar — Slice 9 follow-up: native range replaced with a
          custom timeline that overlays the selected hotspot's keyframes
          (blue dots, click to jump) and visible-range band (green) so the
          merchant can see keyframe distribution without opening any
          panel. Handle (white) shows the current frame and is
          drag-and-arrow-key controllable. */}
      <div className="sdl-360-preview__controls">
        <div className="sdl-360-preview__frame-info">
          Frame {currentFrame + 1} / {frameCount}
        </div>
        <Sdl3d360Timeline
          frameCount={frameCount}
          currentFrame={currentFrame}
          selectedHotspot={selectedTimelineHotspot}
          onChangeFrame={(next) => {
            setCurrentFrame(next);
            setAutoRotate(false);
          }}
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

/**
 * Slice 9 follow-up — frame timeline with keyframe + visible-range
 * overlay for the selected 360 hotspot.
 *
 * Renders three layers stacked on the same track:
 *   1. Visible-range band (green) — visibleFrameStart → visibleFrameEnd.
 *      Wraps in two pieces when start > end ("wraps around the seam").
 *   2. Keyframe markers (blue dots) — one per kf.frame. Click jumps the
 *      playhead to that frame.
 *   3. Playhead (white handle) — current frame. Draggable. Arrow keys
 *      step ±1 frame; Home / End jump to first / last.
 *
 * When no hotspot is selected (selectedHotspot === null) the overlay
 * layers are hidden — the track behaves as a plain scrubber.
 */
function Sdl3d360Timeline({
  frameCount,
  currentFrame,
  selectedHotspot,
  onChangeFrame,
}: {
  frameCount: number;
  currentFrame: number;
  selectedHotspot: Hotspot360 | null;
  onChangeFrame: (next: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const lastIndex = Math.max(1, frameCount - 1);
  const frameToPct = (frame: number): number => (frame / lastIndex) * 100;
  const pctToFrame = (pct: number): number => {
    const clamped = Math.max(0, Math.min(100, pct));
    return Math.round((clamped / 100) * lastIndex);
  };

  const setFrameFromEvent = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pct = ((clientX - rect.left) / rect.width) * 100;
      onChangeFrame(pctToFrame(pct));
    },
    [onChangeFrame, lastIndex],
  );

  const handleTrackPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      dragging.current = true;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      setFrameFromEvent(e.clientX);
    },
    [setFrameFromEvent],
  );

  const handleTrackPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      setFrameFromEvent(e.clientX);
    },
    [setFrameFromEvent],
  );

  const handleTrackPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      dragging.current = false;
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    },
    [],
  );

  const handleHandleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      let next = currentFrame;
      if (e.key === "ArrowLeft") next = Math.max(0, currentFrame - 1);
      else if (e.key === "ArrowRight") next = Math.min(lastIndex, currentFrame + 1);
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = lastIndex;
      else return;
      e.preventDefault();
      onChangeFrame(next);
    },
    [currentFrame, lastIndex, onChangeFrame],
  );

  // Visible-range band: when start > end the range wraps the seam, so
  // render two bands (start → lastIndex AND 0 → end). When equal, the
  // hotspot is visible on a single frame — render a tiny 1-frame stripe.
  const bands: Array<{ leftPct: number; widthPct: number }> = [];
  if (selectedHotspot) {
    const start = Math.max(0, Math.min(lastIndex, selectedHotspot.visibleFrameStart));
    const end = Math.max(0, Math.min(lastIndex, selectedHotspot.visibleFrameEnd));
    if (start <= end) {
      bands.push({
        leftPct: frameToPct(start),
        widthPct: frameToPct(end) - frameToPct(start),
      });
    } else {
      bands.push({ leftPct: frameToPct(start), widthPct: 100 - frameToPct(start) });
      bands.push({ leftPct: 0, widthPct: frameToPct(end) });
    }
  }

  const keyframes = selectedHotspot?.keyframes ?? [];

  return (
    <div className="sdl-360-timeline" aria-label="Frame timeline">
      <div
        ref={trackRef}
        className="sdl-360-timeline__track"
        onPointerDown={handleTrackPointerDown}
        onPointerMove={handleTrackPointerMove}
        onPointerUp={handleTrackPointerUp}
        onPointerCancel={handleTrackPointerUp}
        role="presentation"
      >
        {bands.map((b, i) => (
          <div
            key={`band-${i}`}
            className="sdl-360-timeline__band"
            style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }}
            aria-hidden
          />
        ))}
        {keyframes.map((kf) => {
          const pct = frameToPct(kf.frame);
          return (
            <button
              key={`kf-${kf.frame}`}
              type="button"
              className="sdl-360-timeline__keyframe"
              style={{ left: `${pct}%` }}
              onClick={(e) => {
                e.stopPropagation();
                onChangeFrame(kf.frame);
              }}
              onPointerDown={(e) => {
                // Prevent the track's pointerdown from also firing —
                // we want the click to jump exactly to the keyframe.
                e.stopPropagation();
              }}
              aria-label={`Jump to keyframe at frame ${kf.frame + 1}`}
              title={`Frame ${kf.frame + 1} · X ${Math.round(kf.x * 10)} Y ${Math.round(kf.y * 10)}`}
            />
          );
        })}
        <div
          className="sdl-360-timeline__handle"
          style={{ left: `${frameToPct(currentFrame)}%` }}
          role="slider"
          tabIndex={0}
          aria-label="Current frame"
          aria-valuemin={1}
          aria-valuemax={frameCount}
          aria-valuenow={currentFrame + 1}
          onKeyDown={handleHandleKeyDown}
          // The handle is decorative for pointer events — the track owns
          // pointer interactions (so dragging starts wherever the merchant
          // clicks). Stopping propagation here would break that.
        />
      </div>
    </div>
  );
}
