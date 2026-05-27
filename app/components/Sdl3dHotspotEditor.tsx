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
  List,
  Modal,
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
import { Sdl3dIconPicker } from "./Sdl3dIconPicker";
import { Sdl3dHotspotMediaSlots } from "./Sdl3dHotspotMediaSlots";

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
  mediaImageUrl: string | null;
  mediaVideoUrl: string | null;
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
    icon: null,
    style: "card",
    color: "#3b82f6",
    animation: "none",
    mediaImageUrl: null,
    mediaVideoUrl: null,
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
        icon: item.icon ?? null,
        style: String(item.style ?? "card"),
        color: item.color ?? "#3b82f6",
        animation: normalizeHotspotAnimation(item.animation),
        mediaImageUrl: item.mediaImageUrl ?? null,
        mediaVideoUrl: item.mediaVideoUrl ?? null,
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

/**
 * Slice 9 hotspot UX rework — render modes.
 *
 * - "all"          render header + list + detail (current behavior, default;
 *                  preserved for backward compat / fallback path).
 * - "list-only"    render header + list only (no detail editor). The new
 *                  Sdl3dHotspotsModal uses this in the left pane.
 * - "detail-only"  render the detail editor for the selectedHotspotId only.
 *                  The modal uses this in the right pane.
 *
 * `activeSection` gates which subsection renders inside detail-only mode:
 * "all" shows every subsection (legacy), or pick one of the four to show
 * only that group's fields. Lets the modal split the 15-field wall into
 * sub-tabs without forking this component.
 */
export type HotspotEditorRenderMode = "all" | "list-only" | "detail-only";
export type HotspotEditorActiveSection =
  | "all"
  | "content"
  | "appearance"
  | "layout"
  | "behavior";

export function Sdl3dHotspotEditor({
  hotspots,
  selectedHotspotId,
  // Simple mode was removed 2026-05-27 — all fields are always visible.
  // The prop is left in place for back-compat with any future caller
  // that still wants to toggle, but the default is now "advanced".
  editorMode = "advanced",
  iconResolvedUrls,
  onChange,
  onSelectHotspot,
  onSaveAsPreset,
  onApplyPreset,
  onOpenIconBrowser,
  onOpenMediaImageBrowser,
  renderMode = "all",
  activeSection = "all",
  hideHeader = false,
}: {
  hotspots: EditableHotspot[] | undefined;
  selectedHotspotId: string | null;
  editorMode?: "simple" | "advanced";
  iconResolvedUrls?: Record<string, string>;
  onChange: (next: EditableHotspot[]) => void;
  onSelectHotspot: (id: string | null) => void;
  onSaveAsPreset?: (selectedHotspots: EditableHotspot[]) => void;
  onApplyPreset?: () => void;
  onOpenIconBrowser?: (hotspotId: string) => void;
  onOpenMediaImageBrowser?: (hotspotId: string) => void;
  renderMode?: HotspotEditorRenderMode;
  activeSection?: HotspotEditorActiveSection;
  /** Hide the "Hotspots" title + count + Add/Apply Preset buttons. Modal
   *  callers set this to render their own header at the modal toolbar
   *  level instead of stacking two action rows. */
  hideHeader?: boolean;
}) {
  const showList = renderMode === "all" || renderMode === "list-only";
  const showDetail = renderMode === "all" || renderMode === "detail-only";
  const showSection = (s: Exclude<HotspotEditorActiveSection, "all">) =>
    activeSection === "all" || activeSection === s;
  const isAdvanced = editorMode === "advanced";
  const safeHotspots = Array.isArray(hotspots) ? hotspots : [];
  const selectedIndex = safeHotspots.findIndex((h) => h.id === selectedHotspotId);
  const selected = selectedIndex >= 0 ? safeHotspots[selectedIndex] : null;
  const selectedErrors = selected ? getHotspotFieldErrors(selected) : {};

  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  // Slice 8 — delete confirmation. Single + bulk delete both go through
  // this state; modal renders against `pendingDelete.kind`. Titles are
  // captured at confirmation-open time so the modal copy matches what
  // the merchant saw on the row even if state shifts in between.
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: "single"; id: string; title: string }
    | { kind: "bulk"; ids: string[]; titles: string[] }
    | null
  >(null);

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
    setPendingDelete({
      kind: "single",
      id: selected.id,
      title: selected.title || "Untitled hotspot",
    });
  }

  function doRemoveSingle(id: string) {
    const next = safeHotspots.filter((item) => item.id !== id);
    setCheckedIds((prev) => {
      const copy = new Set(prev);
      copy.delete(id);
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
    const selected = safeHotspots.filter((h) => checkedIds.has(h.id));
    if (selected.length === 0) return;
    setPendingDelete({
      kind: "bulk",
      ids: selected.map((h) => h.id),
      titles: selected.map((h) => h.title || "Untitled hotspot"),
    });
  }

  function doBatchDelete(ids: string[]) {
    const idSet = new Set(ids);
    const next = safeHotspots.filter((h) => !idSet.has(h.id));
    setCheckedIds(new Set());
    replaceHotspots(next);
  }

  function confirmPendingDelete() {
    if (!pendingDelete) return;
    if (pendingDelete.kind === "single") {
      doRemoveSingle(pendingDelete.id);
    } else {
      doBatchDelete(pendingDelete.ids);
    }
    setPendingDelete(null);
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
    <>
    <BlockStack gap="300">
      {/* Header: count + Add / Apply Preset. Modal callers hide this and
          render their own header in the modal's toolbar. */}
      {showList && !hideHeader ? (
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
      ) : null}

      {/* Batch action bar */}
      {showList && checkedCount > 0 ? (
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
      {showList && safeHotspots.length === 0 ? (
        <Text as="p" tone="subdued" variant="bodySm">
          No hotspots yet. Click <b>+ Add</b> or click on the model in Edit mode.
        </Text>
      ) : showList ? (
        <div className="sdl-hs-list">
          {safeHotspots.map((hotspot, index) => {
            const rowErrors = getHotspotFieldErrors(hotspot);
            const hasBlocking = rowErrors.position || rowErrors.normal || rowErrors.focusTarget || rowErrors.focusOrbit;
            const isSelected = hotspot.id === selectedHotspotId;
            const isChecked = checkedIds.has(hotspot.id);

            return (
              // Row click selects the hotspot. Row stays a div because
              // it contains nested interactive controls (checkbox, drag
              // handle, chevron) — converting to <button> would forbid
              // those by HTML spec. Nested controls handle keyboard
              // a11y.
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
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
      ) : null}

      {/* Detail editor */}
      {showDetail && selected ? (
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

          {showSection("content") ? (
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
            {isAdvanced ? (
              <Sdl3dHotspotMediaSlots
                mediaImageUrl={selected.mediaImageUrl}
                mediaImageResolvedUrl={
                  selected.mediaImageUrl && selected.mediaImageUrl.startsWith("gid://")
                    ? iconResolvedUrls?.[selected.mediaImageUrl] ?? null
                    : null
                }
                mediaVideoUrl={selected.mediaVideoUrl}
                onChangeImage={(next) => updateSelected({ mediaImageUrl: next })}
                onChangeVideo={(next) => updateSelected({ mediaVideoUrl: next })}
                onPickImageFromShopifyFiles={() => onOpenMediaImageBrowser?.(selected.id)}
              />
            ) : null}
          </Subsection>
          ) : null}

          {isAdvanced && showSection("appearance") ? (
            <Subsection label="Appearance">
              <Select
                label="Style"
                options={STYLE_OPTIONS}
                value={selected.style}
                onChange={(value) => updateSelected({ style: value })}
              />
              <Sdl3dIconPicker
                value={selected.icon}
                resolvedUrl={
                  selected.icon && selected.icon.startsWith("gid://")
                    ? iconResolvedUrls?.[selected.icon] ?? null
                    : null
                }
                onChange={(next) => updateSelected({ icon: next })}
                onPickFromShopifyFiles={() => onOpenIconBrowser?.(selected.id)}
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

          {showSection("layout") ? (
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
          ) : null}

          {isAdvanced && showSection("behavior") ? (
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

    {/* Slice 8 — destructive-action confirmation. Renders both the
        single-delete and bulk-delete cases from one Modal; the body
        varies on `pendingDelete.kind`. Undo (Ctrl+Z) is still
        available after confirm — this is just the friction layer. */}
    <Modal
      open={pendingDelete !== null}
      onClose={() => setPendingDelete(null)}
      title={
        pendingDelete?.kind === "bulk"
          ? `Delete ${pendingDelete.ids.length} hotspot${pendingDelete.ids.length === 1 ? "" : "s"}?`
          : pendingDelete?.kind === "single"
            ? `Delete hotspot '${pendingDelete.title}'?`
            : ""
      }
      primaryAction={{
        content: "Delete",
        destructive: true,
        onAction: confirmPendingDelete,
      }}
      secondaryActions={[{ content: "Cancel", onAction: () => setPendingDelete(null) }]}
    >
      <Modal.Section>
        {pendingDelete?.kind === "bulk" ? (
          <BlockStack gap="200">
            <Text as="p">The following hotspots will be removed:</Text>
            <List type="bullet">
              {pendingDelete.titles.map((t, i) => (
                <List.Item key={i}>{t}</List.Item>
              ))}
            </List>
            <Text as="p" tone="subdued" variant="bodySm">
              You can undo this with Ctrl+Z if you change your mind.
            </Text>
          </BlockStack>
        ) : pendingDelete?.kind === "single" ? (
          <Text as="p">
            This will remove the hotspot from the product. You can undo with Ctrl+Z.
          </Text>
        ) : null}
      </Modal.Section>
    </Modal>
    </>
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
