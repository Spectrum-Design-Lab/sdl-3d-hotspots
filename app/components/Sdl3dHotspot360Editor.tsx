/**
 * 360° hotspot editor — Polaris migration (Slice 5C PR #5k).
 *
 * Renders inside the editor's "Hotspots" inspector panel when the
 * viewer is in IMAGE_360 mode. Same shape as Sdl3dHotspotEditor but
 * with frame-keyframe interpolation instead of fixed 3D coordinates,
 * plus an inline expand-row UX (no separate detail editor section).
 *
 * Form fields swap to Polaris primitives. The row card uses the
 * shared `.sdl-hs-row*` Polaris-token classes added in PR #5j, plus a
 * Polaris `Collapsible` for the per-row expanded detail.
 */
import { useState } from "react";
import {
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  Collapsible,
  InlineStack,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
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
    onChange(hotspots.map((h) => (checkedIds.has(h.id) ? { ...h, visible } : h)));
  }

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
              {/* Row header (always visible) */}
              <InlineStack align="space-between" blockAlign="center" wrap={false} gap="200">
                <InlineStack gap="200" blockAlign="center" wrap={false}>
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
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {hotspot.title}
                  </Text>
                </InlineStack>
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" tone="subdued" variant="bodySm">
                    {`${hotspot.keyframes.length} kf`}
                  </Text>
                  {/* Wrap in a span so row-click selection doesn't fire when
                      the Delete button is clicked. Polaris Button.onClick has
                      no event arg, so the stopPropagation must live on a
                      wrapping element. */}
                  <span onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="micro"
                      tone="critical"
                      variant="plain"
                      onClick={() => removeHotspot(hotspot.id)}
                    >
                      Delete
                    </Button>
                  </span>
                </InlineStack>
              </InlineStack>

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
                    <InlineStack gap="200" wrap={false}>
                      <Box width="100%">
                        <TextField
                          label="Visible from frame"
                          type="number"
                          min={0}
                          max={Math.max(0, frameCount - 1)}
                          value={String(hotspot.visibleFrameStart)}
                          onChange={(value) =>
                            updateHotspot(hotspot.id, { visibleFrameStart: Number(value) })
                          }
                          autoComplete="off"
                        />
                      </Box>
                      <Box width="100%">
                        <TextField
                          label="Visible to frame"
                          type="number"
                          min={0}
                          max={Math.max(0, frameCount - 1)}
                          value={String(hotspot.visibleFrameEnd)}
                          onChange={(value) =>
                            updateHotspot(hotspot.id, { visibleFrameEnd: Number(value) })
                          }
                          autoComplete="off"
                        />
                      </Box>
                    </InlineStack>
                    <InlineStack gap="300" blockAlign="end" wrap={false}>
                      <Box width="100%">
                        <Select
                          label="Style"
                          options={STYLE_OPTIONS}
                          value={hotspot.style || "card"}
                          onChange={(value) => updateHotspot(hotspot.id, { style: value })}
                        />
                      </Box>
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
                    </InlineStack>

                    {/* Keyframes section */}
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          Keyframes
                        </Text>
                        <Button
                          size="slim"
                          onClick={() => addKeyframe(hotspot.id, currentFrame, 50, 50)}
                        >
                          {`+ Add at frame ${currentFrame}`}
                        </Button>
                      </InlineStack>
                      {hotspot.keyframes.length === 0 ? (
                        <Text as="p" tone="subdued" variant="bodySm">
                          No keyframes. Click on the image to place, or add manually.
                        </Text>
                      ) : (
                        <BlockStack gap="100">
                          {hotspot.keyframes.map((kf) => (
                            <InlineStack
                              key={kf.frame}
                              gap="200"
                              blockAlign="center"
                              align="space-between"
                            >
                              <InlineStack gap="200" blockAlign="center">
                                <Text as="span" variant="bodySm" fontWeight="semibold">
                                  {`Frame ${kf.frame}`}
                                </Text>
                                <Text as="span" tone="subdued" variant="bodySm">
                                  {`x: ${kf.x.toFixed(1)}% y: ${kf.y.toFixed(1)}%`}
                                </Text>
                              </InlineStack>
                              <Button
                                size="micro"
                                variant="plain"
                                onClick={() => removeKeyframe(hotspot.id, kf.frame)}
                              >
                                Remove
                              </Button>
                            </InlineStack>
                          ))}
                        </BlockStack>
                      )}
                    </BlockStack>
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

// Re-export for convenience
export { blankHotspot360 };
