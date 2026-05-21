/**
 * 3D-hotspot editor — Polaris migration (Slice 5C PR #5j) + row layout
 * redesign (Slice 8 hotspots PR #1).
 *
 * Renders inside the editor's "Hotspots" inspector panel when the
 * viewer is in MODEL_3D mode. Owns hotspot list (drag reorder + multi-
 * select + batch ops) and detail editor.
 *
 * Detail editor is grouped into four non-collapsible subsections:
 * Content / Appearance / Layout / Behavior. Subsection headers are
 * the layout primitive the Simple/Advanced gate (PR #2) and the new-
 * field PRs (#3 animations, #4 icons, #5 media slots) hang off.
 *
 * **Intentionally preserved**: the list rows stay native
 * `<div draggable>` (Polaris ships no drag-reorder primitive); the
 * color swatch row stays bespoke since Polaris `ColorPicker` is a
 * full HSV overlay that's overkill for quick-pick presets.
 */
import { useCallback, useState } from "react";
import {
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  Checkbox,
  InlineStack,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { getHotspotFieldErrors } from "../lib/sdl3d-validation";
import {
  HOTSPOT_ANIMATIONS,
  normalizeHotspotAnimation,
  type HotspotAnimation,
} from "../lib/sdl3d-shared";

export type EditableHotspot = {
  id: string;
  sortOrder: number;
  visible: boolean;
  title: string;
  body: string;
  icon: string | null;
  style: string;
  color: string | null;
  animation: HotspotAnimation;
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
    animation: "none",
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
        animation: normalizeHotspotAnimation(item.animation),
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

const STYLE_OPTIONS = [
  { label: "Card", value: "card" },
  { label: "Tooltip", value: "tooltip" },
  { label: "Dot", value: "dot" },
  { label: "Badge", value: "badge" },
  { label: "Icon Only", value: "icon-only" },
  { label: "Panel", value: "panel" },
];

const ANIMATION_OPTIONS = HOTSPOT_ANIMATIONS.map((value) => ({
  label: value === "none" ? "None" : value.charAt(0).toUpperCase() + value.slice(1),
  value,
}));

export function Sdl3dHotspotEditor({
  hotspots,
  selectedHotspotId,
  editorMode = "simple",
  onChange,
  onSelectHotspot,
  onSaveAsPreset,
  onApplyPreset,
}: {
  hotspots: EditableHotspot[] | undefined;
  selectedHotspotId: string | null;
  editorMode?: "simple" | "advanced";
  onChange: (next: EditableHotspot[]) => void;
  onSelectHotspot: (id: string | null) => void;
  onSaveAsPreset?: (selectedHotspots: EditableHotspot[]) => void;
  onApplyPreset?: () => void;
}) {
  const isAdvanced = editorMode === "advanced";
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

  return (
    <BlockStack gap="300">
      {/* Header: count + Add / Apply Preset */}
      <InlineStack align="space-between" blockAlign="center" wrap={false}>
        <BlockStack gap="050">
          <Text as="h3" variant="headingSm">
            Hotspots
          </Text>
          <Text as="p" tone="subdued" variant="bodySm">
            {`${safeHotspots.length} hotspot${safeHotspots.length === 1 ? "" : "s"}`}
          </Text>
        </BlockStack>
        <ButtonGroup>
          {onApplyPreset ? (
            <Button size="slim" onClick={onApplyPreset}>
              Apply Preset
            </Button>
          ) : null}
          <Button size="slim" variant="primary" onClick={addHotspot}>
            + Add
          </Button>
        </ButtonGroup>
      </InlineStack>

      {/* Batch action bar */}
      {checkedCount > 0 ? (
        <Box
          padding="200"
          background="bg-surface-secondary"
          borderRadius="200"
          borderColor="border-secondary"
          borderWidth="025"
        >
          <InlineStack gap="200" blockAlign="center" wrap>
            <Text as="span" variant="bodySm" fontWeight="semibold">
              {`${checkedCount} selected`}
            </Text>
            <ButtonGroup>
              <Button size="micro" onClick={() => batchToggleVisible(true)}>
                Show
              </Button>
              <Button size="micro" onClick={() => batchToggleVisible(false)}>
                Hide
              </Button>
              {onSaveAsPreset ? (
                <Button
                  size="micro"
                  variant="primary"
                  onClick={() => {
                    const selectedHotspots = safeHotspots.filter((h) => checkedIds.has(h.id));
                    onSaveAsPreset(selectedHotspots);
                  }}
                >
                  Save as Preset
                </Button>
              ) : null}
              <Button size="micro" tone="critical" onClick={batchDelete}>
                Delete
              </Button>
              <Button size="micro" onClick={() => setCheckedIds(new Set())}>
                Clear
              </Button>
            </ButtonGroup>
          </InlineStack>
        </Box>
      ) : null}

      {/* Hotspot list (drag reorder — native HTML5 DnD, Polaris ships no equivalent) */}
      {safeHotspots.length === 0 ? (
        <Text as="p" tone="subdued" variant="bodySm">
          No hotspots yet. Click <b>+ Add</b> or click on the model in Edit mode.
        </Text>
      ) : (
        <div className="sdl-hs-list">
          {safeHotspots.map((hotspot, index) => {
            const rowErrors = getHotspotFieldErrors(hotspot);
            const hasBlocking = rowErrors.position || rowErrors.normal || rowErrors.focusTarget || rowErrors.focusOrbit;
            const isSelected = hotspot.id === selectedHotspotId;
            const isChecked = checkedIds.has(hotspot.id);

            return (
              <div
                key={hotspot.id}
                className="sdl-hs-row"
                data-selected={isSelected || undefined}
                data-error={Boolean(hasBlocking) || undefined}
                data-checked={isChecked || undefined}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                onClick={() => onSelectHotspot(hotspot.id)}
              >
                <span className="sdl-hs-row__drag" title="Drag to reorder" aria-hidden>
                  ⠿
                </span>
                <input
                  type="checkbox"
                  className="sdl-hs-row__check"
                  checked={isChecked}
                  onChange={(e) => {
                    e.stopPropagation();
                    toggleCheck(hotspot.id);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Select ${hotspot.title || `Hotspot ${index + 1}`}`}
                />
                <span
                  className="sdl-hs-row__index"
                  style={hotspot.color ? { background: hotspot.color, color: "#fff" } : undefined}
                >
                  {index + 1}
                </span>
                <span className="sdl-hs-row__info">
                  <span className="sdl-hs-row__title">{hotspot.title || `Hotspot ${index + 1}`}</span>
                  <span className="sdl-hs-row__meta">
                    {hotspot.visible ? "Visible" : "Hidden"} · {hotspot.style}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail editor */}
      {selected ? (
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center" wrap>
            <ButtonGroup>
              <Button
                size="slim"
                onClick={() => moveSelected(-1)}
                disabled={selectedIndex === 0}
                accessibilityLabel="Move up"
              >
                ↑
              </Button>
              <Button
                size="slim"
                onClick={() => moveSelected(1)}
                disabled={selectedIndex === safeHotspots.length - 1}
                accessibilityLabel="Move down"
              >
                ↓
              </Button>
              <Button size="slim" onClick={duplicateSelected}>
                Duplicate
              </Button>
              <Button size="slim" tone="critical" onClick={removeSelected}>
                Delete
              </Button>
            </ButtonGroup>
            <Checkbox
              label="Visible"
              checked={selected.visible}
              onChange={(checked) => updateSelected({ visible: checked })}
            />
          </InlineStack>

          <Subsection label="Content">
            <TextField
              label="Title"
              value={selected.title}
              onChange={(value) => updateSelected({ title: value })}
              error={selectedErrors.title}
              autoComplete="off"
            />
            <TextField
              label="Body"
              value={selected.body}
              onChange={(value) => updateSelected({ body: value })}
              multiline={3}
              autoComplete="off"
            />
            <BlockStack gap="150">
              <TextField
                label="Color"
                value={selected.color ?? ""}
                onChange={(value) => updateSelected({ color: value || null })}
                placeholder="#3b82f6"
                autoComplete="off"
              />
              <div className="sdl-hs-swatches" role="group" aria-label="Quick color presets">
                {COLOR_SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="sdl-hs-swatch"
                    data-active={selected.color === c || undefined}
                    style={{ background: c }}
                    onClick={() => updateSelected({ color: c })}
                    title={c}
                    aria-label={`Use color ${c}`}
                  />
                ))}
              </div>
            </BlockStack>
          </Subsection>

          {isAdvanced ? (
            <Subsection label="Appearance">
              <Select
                label="Style"
                options={STYLE_OPTIONS}
                value={selected.style}
                onChange={(value) => updateSelected({ style: value })}
              />
              <TextField
                label="Icon"
                value={selected.icon ?? ""}
                onChange={(value) => updateSelected({ icon: value || null })}
                placeholder="plus"
                autoComplete="off"
              />
              <Select
                label="Animation"
                options={ANIMATION_OPTIONS}
                value={selected.animation}
                onChange={(value) =>
                  updateSelected({ animation: normalizeHotspotAnimation(value) })
                }
                helpText="Subtle loop on the storefront. Respects prefers-reduced-motion."
              />
            </Subsection>
          ) : null}

          <Subsection label="Layout">
            <TextField
              label="Position"
              value={selected.position}
              onChange={(value) => updateSelected({ position: value })}
              placeholder="0m 0m 0m"
              error={selectedErrors.position}
              autoComplete="off"
            />
            <TextField
              label="Normal"
              value={selected.normal ?? ""}
              onChange={(value) => updateSelected({ normal: value || null })}
              placeholder="0m 1m 0m"
              error={selectedErrors.normal}
              autoComplete="off"
            />
            <TextField
              label="Focus target"
              value={selected.focusTarget ?? ""}
              onChange={(value) => updateSelected({ focusTarget: value || null })}
              placeholder="0m 0m 0m"
              error={selectedErrors.focusTarget}
              autoComplete="off"
            />
            {isAdvanced ? (
              <TextField
                label="Focus orbit"
                value={selected.focusOrbit ?? ""}
                onChange={(value) => updateSelected({ focusOrbit: value || null })}
                placeholder="20deg 72deg 85%"
                error={selectedErrors.focusOrbit}
                autoComplete="off"
              />
            ) : null}
          </Subsection>

          {isAdvanced ? (
            <Subsection label="Behavior">
              <TextField
                label="CTA label"
                value={selected.ctaLabel ?? ""}
                onChange={(value) => updateSelected({ ctaLabel: value || null })}
                autoComplete="off"
              />
              <TextField
                label="CTA URL"
                value={selected.ctaUrl ?? ""}
                onChange={(value) => updateSelected({ ctaUrl: value || null })}
                autoComplete="off"
              />
            </Subsection>
          ) : null}
        </BlockStack>
      ) : (
        <Text as="p" tone="subdued" variant="bodySm">
          Select or add a hotspot to edit it.
        </Text>
      )}
    </BlockStack>
  );
}

/**
 * Non-collapsible subsection header + body. Replaces the prior
 * Position & Camera / Advanced Collapsibles. Subsection naming
 * (Content / Appearance / Layout / Behavior) is the load-bearing
 * primitive the Simple/Advanced gate (PR #2) and the new-field PRs
 * hang off.
 */
function Subsection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <BlockStack gap="100">
      <Box paddingBlockStart="200" paddingBlockEnd="050">
        <Text as="h4" variant="headingXs">
          {label}
        </Text>
      </Box>
      <BlockStack gap="200">{children}</BlockStack>
    </BlockStack>
  );
}
