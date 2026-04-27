import { useState } from "react";
import type { Hotspot360, Hotspot360Keyframe } from "../lib/sdl3d-shared";

interface Sdl3dHotspot360EditorProps {
  hotspots: Hotspot360[];
  selectedHotspotId: string | null;
  frameCount: number;
  currentFrame: number;
  onChange: (hotspots: Hotspot360[]) => void;
  onSelectHotspot: (id: string | null) => void;
  onSaveAsPreset?: (selectedHotspots: Hotspot360[]) => void;
  onApplyPreset?: () => void;
}

function blankHotspot360(index: number, frameCount: number): Hotspot360 {
  return {
    id: `hs360_${Date.now()}_${index}`,
    sortOrder: index,
    visible: true,
    title: `Hotspot ${index}`,
    body: "",
    style: "card",
    color: null,
    visibleFrameStart: 0,
    visibleFrameEnd: Math.max(0, frameCount - 1),
    keyframes: [],
    ctaLabel: null,
    ctaUrl: null,
  };
}

export function parseInitialHotspots360(json: string): Hotspot360[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function serializeHotspots360(hotspots: Hotspot360[]): string {
  return JSON.stringify(hotspots, null, 2);
}

export function Sdl3dHotspot360Editor({
  hotspots,
  selectedHotspotId,
  frameCount,
  currentFrame,
  onChange,
  onSelectHotspot,
  onSaveAsPreset,
  onApplyPreset,
}: Sdl3dHotspot360EditorProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  const checkedCount = checkedIds.size;

  function toggleCheck(id: string) {
    setCheckedIds((prev) => {
      const copy = new Set(prev);
      if (copy.has(id)) copy.delete(id);
      else copy.add(id);
      return copy;
    });
  }

  function batchDelete() {
    onChange(hotspots.filter((h) => !checkedIds.has(h.id)));
    setCheckedIds(new Set());
    if (selectedHotspotId && checkedIds.has(selectedHotspotId)) {
      onSelectHotspot(null);
    }
  }

  function batchToggleVisible(visible: boolean) {
    onChange(hotspots.map((h) => checkedIds.has(h.id) ? { ...h, visible } : h));
  }

  const selectedHotspot = hotspots.find((h) => h.id === selectedHotspotId) ?? null;

  function addHotspot() {
    const index = hotspots.length + 1;
    const newHotspot = blankHotspot360(index, frameCount);
    onChange([...hotspots, newHotspot]);
    onSelectHotspot(newHotspot.id);
    setExpandedId(newHotspot.id);
  }

  function removeHotspot(id: string) {
    onChange(hotspots.filter((h) => h.id !== id));
    if (selectedHotspotId === id) {
      onSelectHotspot(null);
    }
  }

  function updateHotspot(id: string, patch: Partial<Hotspot360>) {
    onChange(
      hotspots.map((h) => (h.id === id ? { ...h, ...patch } : h)),
    );
  }

  function addKeyframe(hotspotId: string, frame: number, x: number, y: number) {
    const hotspot = hotspots.find((h) => h.id === hotspotId);
    if (!hotspot) return;

    const existingIndex = hotspot.keyframes.findIndex((kf) => kf.frame === frame);
    let newKeyframes: Hotspot360Keyframe[];

    if (existingIndex >= 0) {
      newKeyframes = hotspot.keyframes.map((kf, i) =>
        i === existingIndex ? { frame, x, y } : kf,
      );
    } else {
      newKeyframes = [...hotspot.keyframes, { frame, x, y }];
    }

    newKeyframes.sort((a, b) => a.frame - b.frame);
    updateHotspot(hotspotId, { keyframes: newKeyframes });
  }

  function removeKeyframe(hotspotId: string, frame: number) {
    const hotspot = hotspots.find((h) => h.id === hotspotId);
    if (!hotspot) return;
    updateHotspot(hotspotId, {
      keyframes: hotspot.keyframes.filter((kf) => kf.frame !== frame),
    });
  }

  return (
    <div className="sdl-inspector-content">
      <div className="sdl-flex sdl-gap-3 sdl-mb-3" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="sdl-text-muted" style={{ fontSize: 12 }}>
          {hotspots.length} hotspot{hotspots.length !== 1 ? "s" : ""}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {onApplyPreset && (
            <button type="button" onClick={onApplyPreset} className="sdl-btn sdl-btn--sm">
              Apply Preset
            </button>
          )}
          <button
            type="button"
            className="sdl-btn sdl-btn--primary sdl-btn--sm"
            onClick={addHotspot}
          >
            + Add hotspot
          </button>
        </div>
      </div>

      {/* Batch actions bar */}
      {checkedCount > 0 ? (
        <div className="sdl-hotspot-batch" style={{ marginBottom: 8 }}>
          <span className="sdl-hotspot-batch__count">{checkedCount} selected</span>
          <button type="button" className="sdl-btn sdl-btn--sm" onClick={() => batchToggleVisible(true)}>
            Show
          </button>
          <button type="button" className="sdl-btn sdl-btn--sm" onClick={() => batchToggleVisible(false)}>
            Hide
          </button>
          {onSaveAsPreset && (
            <button
              type="button"
              className="sdl-btn sdl-btn--primary sdl-btn--sm"
              onClick={() => {
                const selectedHotspots = hotspots.filter((h) => checkedIds.has(h.id));
                onSaveAsPreset(selectedHotspots);
              }}
            >
              Save as Preset
            </button>
          )}
          <button type="button" className="sdl-btn sdl-btn--danger sdl-btn--sm" onClick={batchDelete}>
            Delete
          </button>
          <button type="button" className="sdl-btn sdl-btn--sm" onClick={() => setCheckedIds(new Set())}>
            Clear
          </button>
        </div>
      ) : null}

      {hotspots.length === 0 ? (
        <div className="sdl-subtle-card sdl-text-muted" style={{ textAlign: "center" }}>
          No hotspots yet. Click "Add hotspot" then click on the image to place it.
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 8 }}>
        {hotspots.map((hotspot) => {
          const isSelected = hotspot.id === selectedHotspotId;
          const isExpanded = expandedId === hotspot.id;

          return (
            <div
              key={hotspot.id}
              className={`sdl-subtle-card ${isSelected ? "sdl-subtle-card--selected" : ""}`}
              style={{ cursor: "pointer" }}
            >
              <div
                className="sdl-flex sdl-gap-3"
                style={{ justifyContent: "space-between", alignItems: "center" }}
                onClick={() => {
                  onSelectHotspot(hotspot.id);
                  setExpandedId(isExpanded ? null : hotspot.id);
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={checkedIds.has(hotspot.id)}
                    onChange={() => toggleCheck(hotspot.id)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ flexShrink: 0 }}
                  />
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 22,
                      height: 22,
                      borderRadius: 999,
                      background: hotspot.color || "#3b82f6",
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {hotspot.sortOrder}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{hotspot.title}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="sdl-text-muted" style={{ fontSize: 11 }}>
                    {hotspot.keyframes.length} kf
                  </span>
                  <button
                    type="button"
                    className="sdl-btn sdl-btn--ghost sdl-btn--sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeHotspot(hotspot.id);
                    }}
                    style={{ padding: "2px 6px", fontSize: 11, color: "#ef4444" }}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {isExpanded ? (
                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  <div>
                    <label className="sdl-label">Title</label>
                    <input
                      type="text"
                      className="sdl-input"
                      value={hotspot.title}
                      onChange={(e) => updateHotspot(hotspot.id, { title: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="sdl-label">Body</label>
                    <textarea
                      className="sdl-textarea"
                      value={hotspot.body}
                      onChange={(e) => updateHotspot(hotspot.id, { body: e.target.value })}
                      rows={2}
                    />
                  </div>
                  <div className="sdl-flex sdl-gap-3">
                    <div style={{ flex: 1 }}>
                      <label className="sdl-label">Visible from frame</label>
                      <input
                        type="number"
                        className="sdl-input"
                        min={0}
                        max={Math.max(0, frameCount - 1)}
                        value={hotspot.visibleFrameStart}
                        onChange={(e) =>
                          updateHotspot(hotspot.id, {
                            visibleFrameStart: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label className="sdl-label">Visible to frame</label>
                      <input
                        type="number"
                        className="sdl-input"
                        min={0}
                        max={Math.max(0, frameCount - 1)}
                        value={hotspot.visibleFrameEnd}
                        onChange={(e) =>
                          updateHotspot(hotspot.id, {
                            visibleFrameEnd: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
                    <div>
                      <label className="sdl-label">Style</label>
                      <select
                        className="sdl-input"
                        value={hotspot.style || "card"}
                        onChange={(e) => updateHotspot(hotspot.id, { style: e.target.value })}
                      >
                        <option value="card">Card</option>
                        <option value="tooltip">Tooltip</option>
                        <option value="dot">Dot</option>
                        <option value="badge">Badge</option>
                        <option value="icon-only">Icon Only</option>
                        <option value="panel">Panel</option>
                      </select>
                    </div>
                    <div>
                      <label className="sdl-label">Color</label>
                      <input
                        type="color"
                        value={hotspot.color || "#3b82f6"}
                        onChange={(e) => updateHotspot(hotspot.id, { color: e.target.value })}
                        style={{ width: 40, height: 28, border: 0, cursor: "pointer" }}
                      />
                    </div>
                  </div>

                  {/* Keyframes section */}
                  <div>
                    <div className="sdl-flex sdl-gap-3 sdl-mb-3" style={{ justifyContent: "space-between", alignItems: "center" }}>
                      <label className="sdl-label" style={{ margin: 0 }}>Keyframes</label>
                      <button
                        type="button"
                        className="sdl-btn sdl-btn--sm"
                        onClick={() => addKeyframe(hotspot.id, currentFrame, 50, 50)}
                      >
                        + Add at frame {currentFrame}
                      </button>
                    </div>
                    {hotspot.keyframes.length === 0 ? (
                      <div className="sdl-text-muted" style={{ fontSize: 12 }}>
                        No keyframes. Click on the image to place, or add manually.
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 6 }}>
                        {hotspot.keyframes.map((kf) => (
                          <div
                            key={kf.frame}
                            className="sdl-flex sdl-gap-3"
                            style={{ alignItems: "center", fontSize: 12 }}
                          >
                            <span style={{ fontWeight: 700, minWidth: 60 }}>
                              Frame {kf.frame}
                            </span>
                            <span className="sdl-text-muted">
                              x: {kf.x.toFixed(1)}% y: {kf.y.toFixed(1)}%
                            </span>
                            <button
                              type="button"
                              className="sdl-btn sdl-btn--ghost sdl-btn--sm"
                              onClick={() => removeKeyframe(hotspot.id, kf.frame)}
                              style={{ padding: "1px 4px", fontSize: 10, marginLeft: "auto" }}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Re-export for convenience
export { blankHotspot360 };
