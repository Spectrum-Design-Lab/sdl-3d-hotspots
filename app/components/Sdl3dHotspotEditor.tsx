import { useState, useCallback } from "react";
import { getHotspotFieldErrors } from "../lib/sdl3d-validation";

export type EditableHotspot = {
  id: string;
  sortOrder: number;
  visible: boolean;
  title: string;
  body: string;
  icon: string | null;
  style: string;
  color: string | null;
  position: string;
  normal: string | null;
  focusTarget: string | null;
  focusOrbit: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
};

export function makeId() {
  return `hs_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeSortOrder(items: EditableHotspot[]) {
  return items.map((item, index) => ({
    ...item,
    sortOrder: index + 1,
  }));
}

export function blankHotspot(index: number): EditableHotspot {
  return {
    id: makeId(),
    sortOrder: index + 1,
    visible: true,
    title: `Hotspot ${index + 1}`,
    body: "",
    icon: "plus",
    style: "card",
    color: "#3b82f6",
    position: "0m 0m 0m",
    normal: null,
    focusTarget: null,
    focusOrbit: null,
    ctaLabel: null,
    ctaUrl: null,
  };
}

export function parseInitialHotspots(initialJson: string): EditableHotspot[] {
  try {
    const parsed = JSON.parse(initialJson);
    if (!Array.isArray(parsed)) return [];

    return normalizeSortOrder(
      parsed.map((item: Partial<EditableHotspot>, index: number) => ({
        id: String(item.id || makeId()),
        sortOrder: Number(item.sortOrder ?? index + 1),
        visible: Boolean(item.visible ?? true),
        title: String(item.title ?? `Hotspot ${index + 1}`),
        body: String(item.body ?? ""),
        icon: item.icon ?? "plus",
        style: String(item.style ?? "card"),
        color: item.color ?? "#3b82f6",
        position: String(item.position ?? "0m 0m 0m"),
        normal: item.normal ?? null,
        focusTarget: item.focusTarget ?? null,
        focusOrbit: item.focusOrbit ?? null,
        ctaLabel: item.ctaLabel ?? null,
        ctaUrl: item.ctaUrl ?? null,
      })),
    );
  } catch {
    return [];
  }
}

export function serializeHotspots(hotspots: EditableHotspot[]) {
  return JSON.stringify(normalizeSortOrder(hotspots), null, 2);
}

const COLOR_SWATCHES = [
  "#3b82f6",
  "#ef4444",
  "#22c55e",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#64748b",
  "#ffffff",
];

export function Sdl3dHotspotEditor({
  hotspots,
  selectedHotspotId,
  onChange,
  onSelectHotspot,
  onSaveAsPreset,
  onApplyPreset,
}: {
  hotspots: EditableHotspot[] | undefined;
  selectedHotspotId: string | null;
  onChange: (next: EditableHotspot[]) => void;
  onSelectHotspot: (id: string | null) => void;
  onSaveAsPreset?: (selectedHotspots: EditableHotspot[]) => void;
  onApplyPreset?: () => void;
}) {
  const safeHotspots = Array.isArray(hotspots) ? hotspots : [];
  const selectedIndex = safeHotspots.findIndex((h) => h.id === selectedHotspotId);
  const selected = selectedIndex >= 0 ? safeHotspots[selectedIndex] : null;
  const selectedErrors = selected ? getHotspotFieldErrors(selected) : {};

  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function replaceHotspots(next: EditableHotspot[]) {
    const normalized = normalizeSortOrder(next);
    onChange(normalized);

    if (normalized.length === 0) {
      onSelectHotspot(null);
      return;
    }

    if (!normalized.find((h) => h.id === selectedHotspotId)) {
      onSelectHotspot(normalized[0].id);
    }
  }

  function updateSelected(patch: Partial<EditableHotspot>) {
    if (!selected) return;
    const next = safeHotspots.map((item) =>
      item.id === selected.id ? { ...item, ...patch } : item,
    );
    replaceHotspots(next);
  }

  function addHotspot() {
    const next = [...safeHotspots, blankHotspot(safeHotspots.length)];
    replaceHotspots(next);
    onSelectHotspot(next[next.length - 1].id);
  }

  function duplicateSelected() {
    if (!selected) return;
    const copy: EditableHotspot = {
      ...selected,
      id: makeId(),
      title: `${selected.title} Copy`,
    };
    const next = [...safeHotspots];
    next.splice(selectedIndex + 1, 0, copy);
    replaceHotspots(next);
    onSelectHotspot(copy.id);
  }

  function removeSelected() {
    if (!selected) return;
    const next = safeHotspots.filter((item) => item.id !== selected.id);
    setCheckedIds((prev) => {
      const copy = new Set(prev);
      copy.delete(selected.id);
      return copy;
    });
    replaceHotspots(next);
  }

  function moveSelected(direction: -1 | 1) {
    if (!selected) return;
    const targetIndex = selectedIndex + direction;
    if (targetIndex < 0 || targetIndex >= safeHotspots.length) return;
    const next = [...safeHotspots];
    const current = next[selectedIndex];
    next[selectedIndex] = next[targetIndex];
    next[targetIndex] = current;
    replaceHotspots(next);
    onSelectHotspot(next[targetIndex].id);
  }

  // ── Batch actions ──
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
    const next = safeHotspots.filter((h) => !checkedIds.has(h.id));
    setCheckedIds(new Set());
    replaceHotspots(next);
  }

  function batchToggleVisible(visible: boolean) {
    const next = safeHotspots.map((h) =>
      checkedIds.has(h.id) ? { ...h, visible } : h,
    );
    replaceHotspots(next);
  }

  // ── Drag reorder ──
  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, targetIndex: number) => {
      e.preventDefault();
      if (dragIndex === null || dragIndex === targetIndex) return;
      const next = [...safeHotspots];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(targetIndex, 0, moved);
      replaceHotspots(next);
      setDragIndex(targetIndex);
    },
    [dragIndex, safeHotspots],
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
  }, []);

  function errorHint(message?: string) {
    if (!message) return null;
    return <div className="sdl-hotspot-field__error">{message}</div>;
  }

  return (
    <div className="sdl-hotspot-editor">
      {/* Header */}
      <div className="sdl-hotspot-editor__header">
        <div>
          <strong>Hotspots</strong>
          <div className="sdl-hotspot-editor__count">
            {safeHotspots.length} hotspot{safeHotspots.length === 1 ? "" : "s"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {onApplyPreset && (
            <button type="button" onClick={onApplyPreset} className="sdl-btn sdl-btn--sm">
              Apply Preset
            </button>
          )}
          <button type="button" onClick={addHotspot} className="sdl-btn sdl-btn--primary sdl-btn--sm">
            + Add
          </button>
        </div>
      </div>

      {/* Batch actions bar */}
      {checkedCount > 0 ? (
        <div className="sdl-hotspot-batch">
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
                const selectedHotspots = safeHotspots.filter((h) => checkedIds.has(h.id));
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

      {/* Hotspot list with drag reorder */}
      <div className="sdl-hotspot-list">
        {safeHotspots.length === 0 ? (
          <div className="sdl-text-muted" style={{ fontSize: 13 }}>
            No hotspots yet. Click <strong>+ Add</strong> or click on the model in Edit mode.
          </div>
        ) : (
          safeHotspots.map((hotspot, index) => {
            const rowErrors = getHotspotFieldErrors(hotspot);
            const hasBlocking = rowErrors.position || rowErrors.normal || rowErrors.focusTarget || rowErrors.focusOrbit;
            const isSelected = hotspot.id === selectedHotspotId;
            const isChecked = checkedIds.has(hotspot.id);

            let itemClass = "sdl-hotspot-item";
            if (isSelected) itemClass += " sdl-hotspot-item--selected";
            if (hasBlocking) itemClass += " sdl-hotspot-item--error";
            if (isChecked) itemClass += " sdl-hotspot-item--checked";

            return (
              <div
                key={hotspot.id}
                className={itemClass}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                onClick={() => onSelectHotspot(hotspot.id)}
              >
                <span className="sdl-hotspot-item__drag" title="Drag to reorder">
                  ⠿
                </span>
                <input
                  type="checkbox"
                  className="sdl-hotspot-item__check"
                  checked={isChecked}
                  onChange={(e) => {
                    e.stopPropagation();
                    toggleCheck(hotspot.id);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
                <span
                  className="sdl-hotspot-item__index"
                  style={hotspot.color ? { background: hotspot.color, color: "#fff" } : undefined}
                >
                  {index + 1}
                </span>
                <div className="sdl-hotspot-item__info">
                  <div className="sdl-hotspot-item__title">
                    {hotspot.title || `Hotspot ${index + 1}`}
                  </div>
                  <div className="sdl-hotspot-item__meta">
                    {hotspot.visible ? "Visible" : "Hidden"} · {hotspot.style}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Detail editor */}
      <div className="sdl-hotspot-detail">
        {selected ? (
          <>
            {/* Quick actions */}
            <div className="sdl-hotspot-detail__actions">
              <button type="button" onClick={() => moveSelected(-1)} className="sdl-btn sdl-btn--sm" disabled={selectedIndex === 0}>
                ↑
              </button>
              <button type="button" onClick={() => moveSelected(1)} className="sdl-btn sdl-btn--sm" disabled={selectedIndex === safeHotspots.length - 1}>
                ↓
              </button>
              <button type="button" onClick={duplicateSelected} className="sdl-btn sdl-btn--sm">
                Duplicate
              </button>
              <button type="button" onClick={removeSelected} className="sdl-btn sdl-btn--danger sdl-btn--sm">
                Delete
              </button>
            </div>

            {/* Title - inline edit */}
            <div className="sdl-hotspot-field">
              <label>Title</label>
              <input
                type="text"
                className={`sdl-input ${selectedErrors.title ? "sdl-input--error" : ""}`}
                value={selected.title}
                onChange={(e) => updateSelected({ title: e.target.value })}
              />
              {errorHint(selectedErrors.title)}
            </div>

            {/* Body */}
            <div className="sdl-hotspot-field">
              <label>Body</label>
              <textarea
                className="sdl-input"
                value={selected.body}
                onChange={(e) => updateSelected({ body: e.target.value })}
                rows={3}
              />
            </div>

            {/* Visible toggle */}
            <div className="sdl-hotspot-field">
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={selected.visible}
                  onChange={(e) => updateSelected({ visible: e.target.checked })}
                />
                Visible
              </label>
            </div>

            {/* Style + Color row */}
            <div className="sdl-hotspot-field__row">
              <div className="sdl-hotspot-field">
                <label>Style</label>
                <select
                  className="sdl-input"
                  value={selected.style}
                  onChange={(e) => updateSelected({ style: e.target.value })}
                >
                  <option value="card">Card</option>
                  <option value="tooltip">Tooltip</option>
                  <option value="dot">Dot</option>
                  <option value="badge">Badge</option>
                  <option value="icon-only">Icon Only</option>
                  <option value="panel">Panel</option>
                </select>
              </div>

              <div className="sdl-hotspot-field">
                <label>Color</label>
                <input
                  type="text"
                  className="sdl-input"
                  value={selected.color ?? ""}
                  onChange={(e) => updateSelected({ color: e.target.value || null })}
                  placeholder="#3b82f6"
                />
                <div className="sdl-color-swatches">
                  {COLOR_SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`sdl-color-swatch ${selected.color === c ? "sdl-color-swatch--active" : ""}`}
                      style={{ background: c }}
                      onClick={() => updateSelected({ color: c })}
                      title={c}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Position section - collapsible */}
            <details className="sdl-collapsible" open>
              <summary>Position &amp; Camera</summary>

              <div className="sdl-hotspot-field">
                <label>Position</label>
                <input
                  type="text"
                  className={`sdl-input ${selectedErrors.position ? "sdl-input--error" : ""}`}
                  value={selected.position}
                  onChange={(e) => updateSelected({ position: e.target.value })}
                  placeholder="0m 0m 0m"
                />
                {errorHint(selectedErrors.position)}
              </div>

              <div className="sdl-hotspot-field">
                <label>Normal</label>
                <input
                  type="text"
                  className={`sdl-input ${selectedErrors.normal ? "sdl-input--error" : ""}`}
                  value={selected.normal ?? ""}
                  onChange={(e) => updateSelected({ normal: e.target.value || null })}
                  placeholder="0m 1m 0m"
                />
                {errorHint(selectedErrors.normal)}
              </div>

              <div className="sdl-hotspot-field">
                <label>Focus target</label>
                <input
                  type="text"
                  className={`sdl-input ${selectedErrors.focusTarget ? "sdl-input--error" : ""}`}
                  value={selected.focusTarget ?? ""}
                  onChange={(e) => updateSelected({ focusTarget: e.target.value || null })}
                  placeholder="0m 0m 0m"
                />
                {errorHint(selectedErrors.focusTarget)}
              </div>

              <div className="sdl-hotspot-field">
                <label>Focus orbit</label>
                <input
                  type="text"
                  className={`sdl-input ${selectedErrors.focusOrbit ? "sdl-input--error" : ""}`}
                  value={selected.focusOrbit ?? ""}
                  onChange={(e) => updateSelected({ focusOrbit: e.target.value || null })}
                  placeholder="20deg 72deg 85%"
                />
                {errorHint(selectedErrors.focusOrbit)}
              </div>
            </details>

            {/* Advanced section - collapsible, closed by default */}
            <details className="sdl-collapsible">
              <summary>Advanced</summary>

              <div className="sdl-hotspot-field">
                <label>Icon</label>
                <input
                  type="text"
                  className="sdl-input"
                  value={selected.icon ?? ""}
                  onChange={(e) => updateSelected({ icon: e.target.value || null })}
                  placeholder="plus"
                />
              </div>

              <div className="sdl-hotspot-field">
                <label>CTA label</label>
                <input
                  type="text"
                  className="sdl-input"
                  value={selected.ctaLabel ?? ""}
                  onChange={(e) => updateSelected({ ctaLabel: e.target.value || null })}
                />
              </div>

              <div className="sdl-hotspot-field">
                <label>CTA URL</label>
                <input
                  type="text"
                  className="sdl-input"
                  value={selected.ctaUrl ?? ""}
                  onChange={(e) => updateSelected({ ctaUrl: e.target.value || null })}
                />
              </div>
            </details>
          </>
        ) : (
          <div className="sdl-text-muted">Select or add a hotspot to edit it.</div>
        )}
      </div>
    </div>
  );
}
