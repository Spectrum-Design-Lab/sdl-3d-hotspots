/**
 * Slice 9 hotspot UX rework — full-screen hotspots editor.
 *
 * Wraps the existing Sdl3dHotspotEditor / Sdl3dHotspot360Editor inside a
 * Polaris Modal sized to fill the admin window. The previous in-sidebar
 * accordion stacked ~15 fields per hotspot into a narrow column; this
 * modal splits the same fields across three panes:
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ Hotspots toolbar (Add / Apply / Save / Mode / Undo / Redo) │
 *   ├──────────┬─────────────────────────────────────────────────┤
 *   │ LIST     │ Sub-tabs: Content | Appearance | Layout | Link  │
 *   │ rail     │                              ┌───── preview ──┐│
 *   │ (left,   │ <Editor renderMode=detail   │  ⬤ animating  ││
 *   │ 280px)   │   activeSection=<sub-tab>/> └───────────────┘ ││
 *   └──────────┴─────────────────────────────────────────────────┘
 *
 * Everything except the layout shell is delegated to the two existing
 * editor components (new renderMode + activeSection props). The route
 * still owns all the hotspot state and callbacks; this modal is pure UI.
 *
 * Preset surfaces (Apply Preset / Save as Preset) fold into the toolbar
 * but their actual modals (PresetBrowserModal, PresetApplyDedupModal,
 * the inline save dialog) stay where they are in the editor route —
 * Polaris Modals stack correctly so opening one over this one works.
 */
import { useMemo, useState } from "react";
import {
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  InlineStack,
  Modal,
  Tabs,
  Text,
} from "@shopify/polaris";
import {
  Sdl3dHotspotEditor,
  type EditableHotspot,
  type HotspotEditorActiveSection,
} from "./Sdl3dHotspotEditor";
import {
  Sdl3dHotspot360Editor,
  type Hotspot360EditorActiveSection,
} from "./Sdl3dHotspot360Editor";
import type { Hotspot360 } from "../lib/sdl3d-shared";
import { Sdl3dHotspotPreviewChip } from "./Sdl3dHotspotPreviewChip";

type SubTabId = "content" | "appearance" | "layout" | "behavior";

const SUB_TABS_3D: Array<{ id: SubTabId; content: string }> = [
  { id: "content", content: "Content" },
  { id: "appearance", content: "Appearance" },
  { id: "layout", content: "Position" },
  { id: "behavior", content: "Link" },
];

// 360 has no Behavior section (no CTA fields), so the tab strip drops
// the "Link" tab. Order otherwise matches 3D for muscle memory.
const SUB_TABS_360: Array<{ id: SubTabId; content: string }> = [
  { id: "content", content: "Content" },
  { id: "appearance", content: "Appearance" },
  { id: "layout", content: "Frames" },
];

type Props = {
  open: boolean;
  onClose: () => void;
  productLabel: string;
  viewerType: "MODEL_3D" | "IMAGE_360";
  // shared
  selectedHotspotId: string | null;
  onSelectHotspot: (id: string | null) => void;
  editorMode: "simple" | "advanced";
  onChangeEditorMode: (mode: "simple" | "advanced") => void;
  iconResolvedUrls: Record<string, string>;
  onOpenIconBrowser: (hotspotId: string) => void;
  onOpenMediaImageBrowser: (hotspotId: string) => void;
  // undo/redo (mirrors what the editor route already owns)
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  // preset bridges
  onApplyPreset: () => void;
  onSaveAsPreset3d?: (selected: EditableHotspot[]) => void;
  onSaveAsPreset360?: (selected: Hotspot360[]) => void;
  // 3D path
  hotspots3d: EditableHotspot[];
  onChangeHotspots3d: (next: EditableHotspot[]) => void;
  // 360 path
  hotspots360: Hotspot360[];
  onChangeHotspots360: (next: Hotspot360[]) => void;
  frameCount: number;
  currentFrame: number;
};

export function Sdl3dHotspotsModal({
  open,
  onClose,
  productLabel,
  viewerType,
  selectedHotspotId,
  onSelectHotspot,
  editorMode,
  onChangeEditorMode,
  iconResolvedUrls,
  onOpenIconBrowser,
  onOpenMediaImageBrowser,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onApplyPreset,
  onSaveAsPreset3d,
  onSaveAsPreset360,
  hotspots3d,
  onChangeHotspots3d,
  hotspots360,
  onChangeHotspots360,
  frameCount,
  currentFrame,
}: Props) {
  const is360 = viewerType === "IMAGE_360";
  const tabs = is360 ? SUB_TABS_360 : SUB_TABS_3D;
  const [subTabIndex, setSubTabIndex] = useState(0);
  const activeSubTab = tabs[Math.min(subTabIndex, tabs.length - 1)].id;

  // The preview chip needs a hotspot's color/icon/style/animation. Pick
  // from the selected hotspot's data on whichever path is active.
  const selectedHotspotForPreview = useMemo(() => {
    if (is360) {
      const h = hotspots360.find((x) => x.id === selectedHotspotId);
      if (!h) return null;
      return {
        color: h.color,
        icon: h.icon ?? null,
        style: h.style || "card",
        animation: h.animation ?? ("none" as const),
      };
    }
    const h = hotspots3d.find((x) => x.id === selectedHotspotId);
    if (!h) return null;
    return {
      color: h.color,
      icon: h.icon,
      style: h.style,
      animation: h.animation,
    };
  }, [is360, hotspots3d, hotspots360, selectedHotspotId]);

  const hotspotCount = is360 ? hotspots360.length : hotspots3d.length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Hotspots — ${productLabel}`}
      size="large"
      // Polaris Modal `size="large"` caps at ~620px; we override via
      // editor.css `.sdl-hotspots-modal` to push it to ~95vw so the two
      // panes have room to breathe.
      secondaryActions={[{ content: "Close", onAction: onClose }]}
    >
      <Modal.Section flush>
        <div className="sdl-hotspots-modal">
          {/* Toolbar — global hotspot ops + mode toggle. */}
          <div className="sdl-hotspots-modal__toolbar">
            <InlineStack gap="200" blockAlign="center" wrap>
              <Text as="span" variant="bodySm" tone="subdued">
                {`${hotspotCount} hotspot${hotspotCount === 1 ? "" : "s"}`}
              </Text>
              <ButtonGroup>
                <Button size="slim" onClick={onApplyPreset}>
                  Apply Preset
                </Button>
                <Button size="slim" onClick={onUndo} disabled={!canUndo}>
                  Undo
                </Button>
                <Button size="slim" onClick={onRedo} disabled={!canRedo}>
                  Redo
                </Button>
              </ButtonGroup>
            </InlineStack>
            <ButtonGroup variant="segmented">
              <Button
                pressed={editorMode === "simple"}
                onClick={() => onChangeEditorMode("simple")}
                size="slim"
              >
                Simple
              </Button>
              <Button
                pressed={editorMode === "advanced"}
                onClick={() => onChangeEditorMode("advanced")}
                size="slim"
              >
                Advanced
              </Button>
            </ButtonGroup>
          </div>

          {/* Two-pane body. */}
          <div className="sdl-hotspots-modal__body">
            {/* LEFT — hotspot list rail */}
            <aside className="sdl-hotspots-modal__list">
              {is360 ? (
                <Sdl3dHotspot360Editor
                  hotspots={hotspots360}
                  selectedHotspotId={selectedHotspotId}
                  frameCount={frameCount}
                  currentFrame={currentFrame}
                  editorMode={editorMode}
                  iconResolvedUrls={iconResolvedUrls}
                  onChange={onChangeHotspots360}
                  onSelectHotspot={onSelectHotspot}
                  onSaveAsPreset={onSaveAsPreset360}
                  onApplyPreset={onApplyPreset}
                  onOpenIconBrowser={onOpenIconBrowser}
                  onOpenMediaImageBrowser={onOpenMediaImageBrowser}
                  renderMode="list-only"
                  hideHeader
                />
              ) : (
                <Sdl3dHotspotEditor
                  hotspots={hotspots3d}
                  selectedHotspotId={selectedHotspotId}
                  editorMode={editorMode}
                  iconResolvedUrls={iconResolvedUrls}
                  onChange={onChangeHotspots3d}
                  onSelectHotspot={onSelectHotspot}
                  onSaveAsPreset={onSaveAsPreset3d}
                  onApplyPreset={onApplyPreset}
                  onOpenIconBrowser={onOpenIconBrowser}
                  onOpenMediaImageBrowser={onOpenMediaImageBrowser}
                  renderMode="list-only"
                  hideHeader
                />
              )}
            </aside>

            {/* RIGHT — sub-tabs + detail editor + preview chip pinned top-right */}
            <section className="sdl-hotspots-modal__detail">
              {selectedHotspotId == null ? (
                <Box padding="400">
                  <Text as="p" tone="subdued" variant="bodyMd">
                    Select a hotspot from the list to edit it, or use Apply Preset.
                  </Text>
                </Box>
              ) : (
                <>
                  <div className="sdl-hotspots-modal__detail-head">
                    <Tabs
                      tabs={tabs.map((t) => ({
                        id: t.id,
                        content: t.content,
                        panelID: `panel-${t.id}`,
                      }))}
                      selected={subTabIndex}
                      onSelect={setSubTabIndex}
                    />
                    {selectedHotspotForPreview ? (
                      <Sdl3dHotspotPreviewChip
                        color={selectedHotspotForPreview.color}
                        icon={selectedHotspotForPreview.icon}
                        iconResolvedUrl={
                          selectedHotspotForPreview.icon &&
                          selectedHotspotForPreview.icon.startsWith("gid://")
                            ? iconResolvedUrls[selectedHotspotForPreview.icon] ?? null
                            : null
                        }
                        style={selectedHotspotForPreview.style}
                        animation={selectedHotspotForPreview.animation}
                      />
                    ) : null}
                  </div>

                  <div className="sdl-hotspots-modal__detail-body">
                    <BlockStack gap="300">
                      {is360 ? (
                        <Sdl3dHotspot360Editor
                          hotspots={hotspots360}
                          selectedHotspotId={selectedHotspotId}
                          frameCount={frameCount}
                          currentFrame={currentFrame}
                          editorMode={editorMode}
                          iconResolvedUrls={iconResolvedUrls}
                          onChange={onChangeHotspots360}
                          onSelectHotspot={onSelectHotspot}
                          onSaveAsPreset={onSaveAsPreset360}
                          onApplyPreset={onApplyPreset}
                          onOpenIconBrowser={onOpenIconBrowser}
                          onOpenMediaImageBrowser={onOpenMediaImageBrowser}
                          renderMode="detail-only"
                          activeSection={
                            activeSubTab as Hotspot360EditorActiveSection
                          }
                          hideHeader
                        />
                      ) : (
                        <Sdl3dHotspotEditor
                          hotspots={hotspots3d}
                          selectedHotspotId={selectedHotspotId}
                          editorMode={editorMode}
                          iconResolvedUrls={iconResolvedUrls}
                          onChange={onChangeHotspots3d}
                          onSelectHotspot={onSelectHotspot}
                          onSaveAsPreset={onSaveAsPreset3d}
                          onApplyPreset={onApplyPreset}
                          onOpenIconBrowser={onOpenIconBrowser}
                          onOpenMediaImageBrowser={onOpenMediaImageBrowser}
                          renderMode="detail-only"
                          activeSection={
                            activeSubTab as HotspotEditorActiveSection
                          }
                          hideHeader
                        />
                      )}
                    </BlockStack>
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      </Modal.Section>
    </Modal>
  );
}
