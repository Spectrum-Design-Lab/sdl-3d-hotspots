/**
 * Preset picker modal — Polaris migration (Slice 5C PR #5e).
 *
 * Replaces the bespoke sdl-modal overlay + sdl-preset-card list with a
 * Polaris `Modal` containing a multi-select `ResourceList`. The Modal
 * owns escape-to-close, focus trap, animation, and backdrop; the
 * ResourceList owns checkbox state via its `selectedItems` array.
 *
 * UX wins over the prior bespoke modal:
 * - Multi-select uses Polaris's standard checkbox column instead of a
 *   bespoke row click + inline `<input type="checkbox">`. Keyboard nav
 *   works for free (Space toggles, arrows move).
 * - Empty state becomes a Polaris `EmptyState` with action.
 * - Loading state becomes Modal `loading` flag (Polaris-supplied spinner).
 */
import { useCallback, useEffect, useState } from "react";
import { useFetcher } from "react-router";
import {
  BlockStack,
  EmptyState,
  InlineStack,
  Modal,
  ResourceList,
  ResourceItem,
  Text,
} from "@shopify/polaris";

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

export function PresetBrowserModal({
  open,
  onClose,
  onApply,
}: PresetBrowserModalProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  const fetcher = useFetcher<{
    ok?: boolean;
    presets?: PresetSummary[];
  }>();

  useEffect(() => {
    if (open) {
      setSelectedIds([]);
      setLoaded(false);
      fetcher.load("/api/sdl3d/presets");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok && fetcher.data.presets) {
      setPresets(fetcher.data.presets);
      setLoaded(true);
    }
  }, [fetcher.state, fetcher.data]);

  const handleApply = useCallback(() => {
    const selectedPresets = presets.filter((p) => selectedIds.includes(p.id));
    if (selectedPresets.length > 0) {
      onApply(selectedPresets);
    }
    onClose();
  }, [presets, selectedIds, onApply, onClose]);

  const loading = fetcher.state !== "idle" || !loaded;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Apply Hotspot Presets"
      size="small"
      loading={loading && presets.length === 0}
      primaryAction={{
        content: selectedIds.length > 0 ? `Apply (${selectedIds.length})` : "Apply",
        disabled: selectedIds.length === 0,
        onAction: handleApply,
      }}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
    >
      {presets.length === 0 && !loading ? (
        <Modal.Section>
          <EmptyState
            heading="No presets saved yet"
            image=""
          >
            <Text as="p">
              Select hotspots in the editor, then save them as a preset to reuse on other products.
            </Text>
          </EmptyState>
        </Modal.Section>
      ) : (
        <ResourceList
          items={presets}
          selectable
          selectedItems={selectedIds}
          onSelectionChange={(selection) => {
            // Polaris's "All" selector returns "All" — for our list it
            // collapses to "select everything currently in `items`".
            if (selection === "All") {
              setSelectedIds(presets.map((p) => p.id));
            } else {
              setSelectedIds(selection);
            }
          }}
          resourceName={{ singular: "preset", plural: "presets" }}
          renderItem={(preset) => {
            const totalHotspots = preset.hotspotCount + preset.hotspot360Count;
            return (
              <ResourceItem
                id={preset.id}
                onClick={() => {
                  setSelectedIds((prev) =>
                    prev.includes(preset.id)
                      ? prev.filter((id) => id !== preset.id)
                      : [...prev, preset.id],
                  );
                }}
                accessibilityLabel={`Select preset ${preset.name}`}
              >
                <InlineStack align="space-between" blockAlign="center" wrap={false} gap="200">
                  <BlockStack gap="050">
                    <Text as="h3" variant="bodyMd" fontWeight="semibold">
                      {preset.name}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {totalHotspots} hotspot{totalHotspots === 1 ? "" : "s"}
                      {preset.hotspot360Count > 0
                        ? ` (${preset.hotspotCount} 3D, ${preset.hotspot360Count} 360°)`
                        : ""}
                      {" · "}
                      <span suppressHydrationWarning>
                        Updated {new Date(preset.updatedAt).toLocaleDateString()}
                      </span>
                    </Text>
                  </BlockStack>
                  <PresetHotspotPreview hotspotsJson={preset.hotspotsJson} />
                </InlineStack>
              </ResourceItem>
            );
          }}
        />
      )}
    </Modal>
  );
}

/**
 * Row of up to 6 color dots, one per hotspot, so merchants can visually
 * distinguish presets that share a similar name. Pulled forward verbatim
 * from the pre-Polaris component since Polaris ships no equivalent.
 */
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
    </div>
  );
}
