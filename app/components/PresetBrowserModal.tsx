import { useCallback, useEffect, useState } from "react";
import { useFetcher } from "react-router";

/* ────────────────────────────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────────────────────────────── */

export interface PresetSummary {
  id: string;
  name: string;
  hotspotsJson: string;
  hotspotsJson360: string | null;
  hotspotCount: number;
  hotspot360Count: number;
  updatedAt: string;
}

interface PresetBrowserModalProps {
  open: boolean;
  onClose: () => void;
  onApply: (presets: PresetSummary[]) => void;
}

/* ────────────────────────────────────────────────────────────────────
 * Component
 * ──────────────────────────────────────────────────────────────────── */

export function PresetBrowserModal({
  open,
  onClose,
  onApply,
}: PresetBrowserModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  const fetcher = useFetcher<{
    ok?: boolean;
    presets?: PresetSummary[];
  }>();

  // Load presets when modal opens
  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setLoaded(false);
      fetcher.load("/api/sdl3d/presets");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle fetcher response
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok && fetcher.data.presets) {
      setPresets(fetcher.data.presets);
      setLoaded(true);
    }
  }, [fetcher.state, fetcher.data]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleApply = useCallback(() => {
    const selectedPresets = presets.filter((p) => selected.has(p.id));
    if (selectedPresets.length > 0) {
      onApply(selectedPresets);
    }
    onClose();
  }, [presets, selected, onApply, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const loading = fetcher.state !== "idle" || !loaded;

  return (
    <div className="sdl-modal-overlay" onClick={onClose}>
      <div
        className="sdl-modal sdl-modal--browser"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 560 }}
      >
        {/* Header */}
        <div className="sdl-modal__header">
          <div>
            <div className="sdl-modal__title">Apply Hotspot Presets</div>
            <div className="sdl-modal__subtitle">
              Select presets to add their hotspots to the current product.
            </div>
          </div>
          <button type="button" className="sdl-modal__close" onClick={onClose}>
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="sdl-modal__body" style={{ minHeight: 200, maxHeight: 400, overflow: "auto" }}>
          {loading ? (
            <div className="sdl-text-muted" style={{ textAlign: "center", padding: 40 }}>
              Loading presets...
            </div>
          ) : presets.length === 0 ? (
            <div className="sdl-text-muted" style={{ textAlign: "center", padding: 40 }}>
              No presets saved yet. Select hotspots and save them as a preset first.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {presets.map((preset) => {
                const isSelected = selected.has(preset.id);
                const totalHotspots = preset.hotspotCount + preset.hotspot360Count;

                return (
                  <div
                    key={preset.id}
                    className={`sdl-preset-card ${isSelected ? "sdl-preset-card--selected" : ""}`}
                    onClick={() => toggleSelect(preset.id)}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(preset.id)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ marginRight: 10, flexShrink: 0 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{preset.name}</div>
                      <div className="sdl-text-muted" style={{ fontSize: 12 }}>
                        {totalHotspots} hotspot{totalHotspots === 1 ? "" : "s"}
                        {preset.hotspot360Count > 0
                          ? ` (${preset.hotspotCount} 3D, ${preset.hotspot360Count} 360\u00b0)`
                          : ""}
                        {" \u00b7 "}
                        Updated {new Date(preset.updatedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <PresetHotspotPreview hotspotsJson={preset.hotspotsJson} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sdl-modal__footer">
          <div className="sdl-text-muted" style={{ fontSize: 12 }}>
            {selected.size > 0
              ? `${selected.size} preset${selected.size === 1 ? "" : "s"} selected`
              : "Select presets to apply"}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="sdl-btn sdl-btn--sm" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="sdl-btn sdl-btn--primary sdl-btn--sm"
              disabled={selected.size === 0}
              onClick={handleApply}
            >
              Apply {selected.size > 0 ? `(${selected.size})` : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
 * Hotspot color dots preview
 * ──────────────────────────────────────────────────────────────────── */

function PresetHotspotPreview({ hotspotsJson }: { hotspotsJson: string }) {
  let hotspots: Array<{ color?: string | null }> = [];
  try {
    const parsed = JSON.parse(hotspotsJson);
    if (Array.isArray(parsed)) hotspots = parsed.slice(0, 6);
  } catch { /* ignore */ }

  if (hotspots.length === 0) return null;

  return (
    <div style={{ display: "flex", gap: 3, alignItems: "center", flexShrink: 0 }}>
      {hotspots.map((h, i) => (
        <span
          key={i}
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: h.color || "#3b82f6",
            border: "1px solid rgba(0,0,0,0.15)",
          }}
        />
      ))}
      {hotspots.length < parseInt(hotspotsJson.match(/"id"/g)?.length?.toString() || "0") && (
        <span className="sdl-text-muted" style={{ fontSize: 10 }}>+</span>
      )}
    </div>
  );
}
