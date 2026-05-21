/**
 * 360° hotspot editor — Polaris migration (Slice 5C PR #5k) + row
 * layout redesign (Slice 8 hotspots PR #1).
 *
 * Renders inside the editor's "Hotspots" inspector panel when the
 * viewer is in IMAGE_360 mode. Same row shape as Sdl3dHotspotEditor
 * but inline-expand (no separate detail editor section), and the
 * expanded body groups fields into Content / Appearance / Layout
 * subsections (Behavior stays empty until PR #5 surfaces CTA + media
 * slot fields). Subsection naming mirrors the 3D editor so future
 * field PRs gate the same way across both surfaces.
 *
 * The row card uses the shared `.sdl-hs-row*` Polaris-token classes
 * from PR #5j, plus a Polaris `Collapsible` for the inline expand.
 */
import { useEffect, useRef, useState } from "react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  Collapsible,
  Icon,
  InlineStack,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { ChevronDownIcon, ChevronUpIcon } from "@shopify/polaris-icons";
import {
  frameToDisplay,
  frameFromDisplay,
  coordToDisplay,
  coordFromDisplay,
  type Hotspot360,
  type Hotspot360Keyframe,
} from "../lib/sdl3d-shared";

interface Sdl3dHotspot360EditorProps {
  hotspots: Hotspot360[];
  selectedHotspotId: string | null;
  frameCount: number;
  currentFrame: number;
  editorMode?: "simple" | "advanced";
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

/**
 * Numeric frame-index field with a local draft so the merchant can
 * backspace past the last digit (e.g. `72` → `7` → empty → type `1`)
 * without the input snapping back to the stored value mid-edit. Commits
 * on blur via `frameFromDisplay`'s clamp; an empty value on blur reverts
 * to the last committed value.
 */
function FrameField({
  label,
  storedValue,
  frameCount,
  onCommit,
}: {
  label: string;
  storedValue: number;
  frameCount: number;
  onCommit: (storedValue: number) => void;
}) {
  const displayValue = frameToDisplay(storedValue);
  const [draft, setDraft] = useState<string>(String(displayValue));
  const isFocusedRef = useRef(false);

  // Re-sync from props only when the user isn't editing (e.g. undo/redo or
  // another row mutated state). Without the guard the typed draft would be
  // overwritten on every parent rerender.
  useEffect(() => {
    if (!isFocusedRef.current) setDraft(String(displayValue));
  }, [displayValue]);

  function commit() {
    isFocusedRef.current = false;
    if (draft === "") {
      setDraft(String(displayValue));
      return;
    }
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(displayValue));
      return;
    }
    const next = frameFromDisplay(parsed, frameCount);
    if (!Number.isFinite(next)) {
      setDraft(String(displayValue));
      return;
    }
    onCommit(next);
    setDraft(String(frameToDisplay(next)));
  }

  return (
    <TextField
      label={label}
      type="number"
      min={1}
      max={Math.max(1, frameCount)}
      value={draft}
      onChange={setDraft}
      onFocus={() => {
        isFocusedRef.current = true;
      }}
      onBlur={commit}
      autoComplete="off"
    />
  );
}

/**
 * Per-keyframe X/Y coordinate input (Slice 7 PR #7). Storage is a 0–100
 * float; the merchant sees an integer in [0, 1000] with no `%` suffix.
 * Same draft-state pattern as FrameField so the merchant can backspace
 * the input to empty without it snapping back. Commits on blur via
 * coordFromDisplay's clamp; empty on blur reverts to the last committed
 * value. Sync-from-prop is guarded by isFocusedRef so drag-driven
 * updates from the canvas don't overwrite mid-edit text.
 */
function CoordField({
  axis,
  storedValue,
  onCommit,
}: {
  axis: "X" | "Y";
  storedValue: number;
  onCommit: (storedValue: number) => void;
}) {
  const displayValue = coordToDisplay(storedValue);
  const [draft, setDraft] = useState<string>(String(displayValue));
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (!isFocusedRef.current) setDraft(String(displayValue));
  }, [displayValue]);

  function commit() {
    isFocusedRef.current = false;
    if (draft === "") {
      setDraft(String(displayValue));
      return;
    }
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(displayValue));
      return;
    }
    const next = coordFromDisplay(parsed);
    if (!Number.isFinite(next)) {
      setDraft(String(displayValue));
      return;
    }
    onCommit(next);
    setDraft(String(coordToDisplay(next)));
  }

  return (
    <div style={{ width: 96 }}>
      <TextField
        label={`${axis} coordinate`}
        labelHidden
        type="number"
        min={0}
        max={1000}
        step={1}
        prefix={axis}
        value={draft}
        onChange={setDraft}
        onFocus={() => {
          isFocusedRef.current = true;
        }}
        onBlur={commit}
        autoComplete="off"
      />
    </div>
  );
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

const STYLE_OPTIONS = [
  { label: "Card", value: "card" },
  { label: "Tooltip", value: "tooltip" },
  { label: "Dot", value: "dot" },
  { label: "Badge", value: "badge" },
  { label: "Icon Only", value: "icon-only" },
  { label: "Panel", value: "panel" },
];

export function Sdl3dHotspot360Editor({
  hotspots,
  selectedHotspotId,
  frameCount,
  currentFrame,
  editorMode = "simple",
  onChange,
  onSelectHotspot,
  onSaveAsPreset,
  onApplyPreset,
}: Sdl3dHotspot360EditorProps) {
  const isAdvanced = editorMode === "advanced";
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
    onChange(hotspots.map((h) => (checkedIds.has(h.id) ? { ...h, visible } : h)));
  }

  function addHotspot() {
    const index = hotspots.length + 1;
    const newHotspot = blankHotspot360(index, frameCount);
    onChange([...hotspots, newHotspot]);
    onSelectHotspot(newHotspot.id);
    setExpandedId(newHotspot.id);
  }

  function updateHotspot(id: string, patch: Partial<Hotspot360>) {
    onChange(hotspots.map((h) => (h.id === id ? { ...h, ...patch } : h)));
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
    <BlockStack gap="300">
      {/* Header: count + Apply Preset / Add */}
      <InlineStack align="space-between" blockAlign="center" wrap={false}>
        <Text as="p" tone="subdued" variant="bodySm">
          {`${hotspots.length} hotspot${hotspots.length !== 1 ? "s" : ""}`}
        </Text>
        <ButtonGroup>
          {onApplyPreset ? (
            <Button size="slim" onClick={onApplyPreset}>
              Apply Preset
            </Button>
          ) : null}
          <Button size="slim" variant="primary" onClick={addHotspot}>
            + Add hotspot
          </Button>
        </ButtonGroup>
      </InlineStack>

      {/* Batch actions bar */}
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
                    const selectedHotspots = hotspots.filter((h) => checkedIds.has(h.id));
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

      {hotspots.length === 0 ? (
        <Text as="p" tone="subdued" variant="bodySm" alignment="center">
          No hotspots yet. Click "Add hotspot" then click on the image to place it.
        </Text>
      ) : null}

      <div className="sdl-hs-list">
        {hotspots.map((hotspot) => {
          const isSelected = hotspot.id === selectedHotspotId;
          const isExpanded = expandedId === hotspot.id;
          const collapseId = `hs360-row-${hotspot.id}`;

          return (
            <div
              key={hotspot.id}
              className="sdl-hs-row"
              data-selected={isSelected || undefined}
              data-checked={checkedIds.has(hotspot.id) || undefined}
              onClick={() => {
                onSelectHotspot(hotspot.id);
                setExpandedId(isExpanded ? null : hotspot.id);
              }}
              style={{ flexDirection: "column", alignItems: "stretch" }}
            >
              {/* Row header (always visible). Native flex divs instead of
                  Polaris InlineStack so we can set min-width: 0 on the left
                  (lets the title truncate instead of pushing the chevron to
                  a new line — Slice 7 follow-up to the row Delete→chevron
                  swap) and flex-shrink: 0 on the right (keyframes count +
                  optional "wraps around" Badge + chevron always inline). */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "var(--p-space-200, 8px)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--p-space-200, 8px)",
                    minWidth: 0,
                    flex: "1 1 auto",
                  }}
                >
                  <input
                    type="checkbox"
                    className="sdl-hs-row__check"
                    checked={checkedIds.has(hotspot.id)}
                    onChange={() => toggleCheck(hotspot.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select ${hotspot.title}`}
                  />
                  <span
                    className="sdl-hs-row__index"
                    style={hotspot.color ? { background: hotspot.color, color: "#fff" } : undefined}
                  >
                    {hotspot.sortOrder}
                  </span>
                  <span style={{ minWidth: 0, flex: "1 1 auto" }}>
                    <Text as="span" variant="bodyMd" fontWeight="semibold" truncate>
                      {hotspot.title}
                    </Text>
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--p-space-200, 8px)",
                    flexShrink: 0,
                  }}
                >
                  {hotspot.visibleFrameStart > hotspot.visibleFrameEnd ? (
                    <Badge tone="info">Wraps around</Badge>
                  ) : null}
                  <Text as="span" tone="subdued" variant="bodySm">
                    {`${hotspot.keyframes.length} keyframe${hotspot.keyframes.length === 1 ? "" : "s"}`}
                  </Text>
                  {/* Expand affordance — whole row is already clickable. */}
                  <Icon
                    source={isExpanded ? ChevronUpIcon : ChevronDownIcon}
                    tone="subdued"
                  />
                </div>
              </div>

              {/* Expanded form */}
              <Collapsible
                id={collapseId}
                open={isExpanded}
                transition={{ duration: "150ms", timingFunction: "ease-in-out" }}
              >
                {/* Native div so we can stopPropagation — Polaris Box has no
                    onClick. Padding via inline style to match Box's "300" token. */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{ paddingTop: "var(--p-space-300, 12px)" }}
                >
                  <BlockStack gap="200">
                    <Subsection label="Content">
                      <TextField
                        label="Title"
                        value={hotspot.title}
                        onChange={(value) => updateHotspot(hotspot.id, { title: value })}
                        autoComplete="off"
                      />
                      <TextField
                        label="Body"
                        value={hotspot.body}
                        onChange={(value) => updateHotspot(hotspot.id, { body: value })}
                        multiline={2}
                        autoComplete="off"
                      />
                      <BlockStack gap="100">
                        <Text as="span" variant="bodySm" fontWeight="medium">
                          Color
                        </Text>
                        <input
                          type="color"
                          value={hotspot.color || "#3b82f6"}
                          onChange={(e) => updateHotspot(hotspot.id, { color: e.target.value })}
                          aria-label="Hotspot color"
                          style={{
                            width: 40,
                            height: 36,
                            border: "1px solid var(--p-color-border, #c9cccf)",
                            borderRadius: "var(--p-border-radius-200, 8px)",
                            cursor: "pointer",
                            padding: 0,
                            background: "transparent",
                          }}
                        />
                      </BlockStack>
                    </Subsection>

                    {isAdvanced ? (
                      <Subsection label="Appearance">
                        <Select
                          label="Style"
                          options={STYLE_OPTIONS}
                          value={hotspot.style || "card"}
                          onChange={(value) => updateHotspot(hotspot.id, { style: value })}
                        />
                      </Subsection>
                    ) : null}

                    <Subsection label="Layout">
                      {/* Display 1-indexed; storage stays 0-indexed. FrameField
                          keeps a local draft so backspacing the last digit
                          doesn't snap back to the stored value — commit happens
                          on blur via frameFromDisplay's clamp. Frame-range
                          inputs gate to Advanced; default is full range so
                          Simple-mode merchants get correct visibility without
                          the controls. */}
                      {isAdvanced ? (
                        <InlineStack gap="200" wrap={false}>
                          <Box width="100%">
                            <FrameField
                              label="Visible from frame"
                              storedValue={hotspot.visibleFrameStart}
                              frameCount={frameCount}
                              onCommit={(stored) =>
                                updateHotspot(hotspot.id, { visibleFrameStart: stored })
                              }
                            />
                          </Box>
                          <Box width="100%">
                            <FrameField
                              label="Visible to frame"
                              storedValue={hotspot.visibleFrameEnd}
                              frameCount={frameCount}
                              onCommit={(stored) =>
                                updateHotspot(hotspot.id, { visibleFrameEnd: stored })
                              }
                            />
                          </Box>
                        </InlineStack>
                      ) : null}

                      {/* Keyframes — drag updates the storage 0–100 float
                          directly; CoordField re-syncs via isFocusedRef so
                          drag-driven changes don't fight the typed draft.
                          In Simple mode the per-row X/Y typed inputs hide;
                          merchants place keyframes by clicking the canvas. */}
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="span" variant="bodyMd" fontWeight="semibold">
                            Keyframes
                          </Text>
                          <Button
                            size="slim"
                            onClick={() => addKeyframe(hotspot.id, currentFrame, 50, 50)}
                          >
                            {`+ Add at frame ${frameToDisplay(currentFrame)}`}
                          </Button>
                        </InlineStack>
                        {hotspot.keyframes.length === 0 ? (
                          <Text as="p" tone="subdued" variant="bodySm">
                            No keyframes. Click on the image to place, or add manually.
                          </Text>
                        ) : (
                          <BlockStack gap="100">
                            {isAdvanced ? (
                              <Text as="p" tone="subdued" variant="bodySm">
                                X / Y: 0 = top-left edge, 1000 = bottom-right edge.
                              </Text>
                            ) : null}
                            {hotspot.keyframes.map((kf) => (
                              <InlineStack
                                key={kf.frame}
                                gap="200"
                                blockAlign="center"
                                align="space-between"
                                wrap={false}
                              >
                                <Text as="span" variant="bodySm" fontWeight="semibold">
                                  {`Frame ${frameToDisplay(kf.frame)}`}
                                </Text>
                                <InlineStack gap="100" blockAlign="center" wrap={false}>
                                  {isAdvanced ? (
                                    <>
                                      <CoordField
                                        axis="X"
                                        storedValue={kf.x}
                                        onCommit={(x) => addKeyframe(hotspot.id, kf.frame, x, kf.y)}
                                      />
                                      <CoordField
                                        axis="Y"
                                        storedValue={kf.y}
                                        onCommit={(y) => addKeyframe(hotspot.id, kf.frame, kf.x, y)}
                                      />
                                    </>
                                  ) : null}
                                  <Button
                                    size="micro"
                                    variant="plain"
                                    onClick={() => removeKeyframe(hotspot.id, kf.frame)}
                                  >
                                    Remove
                                  </Button>
                                </InlineStack>
                              </InlineStack>
                            ))}
                          </BlockStack>
                        )}
                      </BlockStack>
                    </Subsection>
                  </BlockStack>
                </div>
              </Collapsible>
            </div>
          );
        })}
      </div>
    </BlockStack>
  );
}

/**
 * Non-collapsible subsection header + body. Mirrors the helper in
 * Sdl3dHotspotEditor.tsx so future field PRs gate identically on
 * both surfaces.
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

// Re-export for convenience
export { blankHotspot360 };
