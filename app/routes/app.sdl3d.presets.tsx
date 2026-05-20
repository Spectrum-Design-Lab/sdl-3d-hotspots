/**
 * Hotspot Presets page — Polaris migration (Slice 5C PR #3).
 *
 * Most merchants will see the empty state on this page since presets are an
 * advanced flow, so Polaris EmptyState is the dominant visual upgrade. When
 * presets exist, the bespoke card list becomes a Polaris ResourceList with
 * inline rename, a confirmation Modal for delete, and the existing color-dot
 * preview kept as a small visual gem.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useLoaderData,
  useFetcher,
  useRouteError,
  isRouteErrorResponse,
} from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Collapsible,
  EmptyState,
  Form as PolarisForm,
  Frame,
  InlineStack,
  Layout,
  Modal,
  Page,
  ResourceItem,
  ResourceList,
  Text,
  TextField,
  Toast,
} from "@shopify/polaris";

import prisma from "../db.server";
import shopify from "../shopify.server";
import { ensureShop } from "../lib/sdl3d-graphql.server";

export async function loader({ request }: { request: Request }) {
  const { session } = await shopify.authenticate.admin(request);
  const shop = await ensureShop(session.shop);

  const presets = await prisma.preset.findMany({
    where: { shopId: shop.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      viewerType: true,
      hotspotsJson: true,
      hotspotsJson360: true,
      updatedAt: true,
    },
  });

  return { presets, shop: session.shop };
}

type PresetViewerType = "MODEL_3D" | "IMAGE_360";

function normalizePresetViewerType(value: string): PresetViewerType {
  return value === "IMAGE_360" ? "IMAGE_360" : "MODEL_3D";
}

function parseHotspotCount(json: string): number {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function parseHotspotColors(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 8).map((h: { color?: string | null }) => h.color || "#3b82f6");
  } catch {
    return [];
  }
}

type PresetRow = {
  id: string;
  name: string;
  viewerType: PresetViewerType;
  hotspotsJson: string;
  hotspotsJson360: string | null;
  updatedAt: string;
  count3d: number;
  count360: number;
  totalCount: number;
  colors: string[];
};

type PresetFilter = "ALL" | PresetViewerType;

type PresetActionData = { ok?: boolean; message?: string };

export default function PresetsRoute() {
  const { presets } = useLoaderData<typeof loader>();

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PresetRow | null>(null);
  const [editTarget, setEditTarget] = useState<PresetRow | null>(null);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);

  const renameFetcher = useFetcher<PresetActionData>();
  const deleteFetcher = useFetcher<PresetActionData>();
  const updateHotspotsFetcher = useFetcher<PresetActionData>();

  // Toast on rename success, exit edit mode.
  useEffect(() => {
    if (renameFetcher.state === "idle" && renameFetcher.data) {
      if (renameFetcher.data.ok) {
        setToast({ message: renameFetcher.data.message || "Preset renamed." });
        setRenamingId(null);
      } else if (renameFetcher.data.message) {
        setToast({ message: renameFetcher.data.message, error: true });
      }
    }
  }, [renameFetcher.state, renameFetcher.data]);

  // Toast on delete success/failure, close confirm Modal.
  useEffect(() => {
    if (deleteFetcher.state === "idle" && deleteFetcher.data) {
      if (deleteFetcher.data.ok) {
        setToast({ message: deleteFetcher.data.message || "Preset deleted." });
        setDeleteTarget(null);
      } else if (deleteFetcher.data.message) {
        setToast({ message: deleteFetcher.data.message, error: true });
      }
    }
  }, [deleteFetcher.state, deleteFetcher.data]);

  // Toast on updateHotspots (Edit Modal save), close Modal.
  useEffect(() => {
    if (updateHotspotsFetcher.state === "idle" && updateHotspotsFetcher.data) {
      if (updateHotspotsFetcher.data.ok) {
        setToast({ message: updateHotspotsFetcher.data.message || "Preset updated." });
        setEditTarget(null);
      } else if (updateHotspotsFetcher.data.message) {
        setToast({ message: updateHotspotsFetcher.data.message, error: true });
      }
    }
  }, [updateHotspotsFetcher.state, updateHotspotsFetcher.data]);

  const presetData: PresetRow[] = useMemo(() => {
    return presets.map((p) => {
      const viewerType = normalizePresetViewerType(p.viewerType);
      const count3d = parseHotspotCount(p.hotspotsJson);
      const count360 = p.hotspotsJson360 ? parseHotspotCount(p.hotspotsJson360) : 0;
      // Bug fix (Slice 8 PR #3) — sample colors from the array that
      // actually has content. Old code only looked at hotspotsJson, so
      // 360-only presets rendered with no color dots.
      const colors = viewerType === "IMAGE_360" && p.hotspotsJson360
        ? parseHotspotColors(p.hotspotsJson360)
        : parseHotspotColors(p.hotspotsJson);
      return {
        id: p.id,
        name: p.name,
        viewerType,
        hotspotsJson: p.hotspotsJson,
        hotspotsJson360: p.hotspotsJson360,
        updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : new Date(p.updatedAt).toISOString(),
        count3d,
        count360,
        totalCount: count3d + count360,
        colors,
      };
    });
  }, [presets]);

  // Slice 8 PR #3 — viewer-type filter. Default "ALL" so existing
  // merchant muscle memory ("the page lists everything") is preserved.
  const [filter, setFilter] = useState<PresetFilter>("ALL");
  const filteredPresets = useMemo(
    () =>
      filter === "ALL"
        ? presetData
        : presetData.filter((p) => p.viewerType === filter),
    [presetData, filter],
  );

  const handleRenameStart = useCallback((row: PresetRow) => {
    setRenamingId(row.id);
    setRenameValue(row.name);
    setExpandedId(null);
  }, []);

  const handleRenameSubmit = useCallback(
    (presetId: string) => {
      const trimmed = renameValue.trim();
      if (!trimmed) {
        setToast({ message: "Name can't be empty.", error: true });
        return;
      }
      const fd = new FormData();
      fd.set("intent", "rename");
      fd.set("presetId", presetId);
      fd.set("newName", trimmed);
      renameFetcher.submit(fd, { method: "post", action: "/api/sdl3d/presets" });
    },
    [renameValue, renameFetcher],
  );

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  return (
    <Frame>
      <Page
        title="Hotspot Presets"
        subtitle="Saved hotspot collections. Select hotspots in the editor, save them as a preset, then apply them to any product."
        backAction={{ content: "Editor", url: "/app/sdl3d/editor" }}
      >
        <Layout>
          <Layout.Section>
            <Card padding="0">
              {presetData.length === 0 ? (
                <Box padding="800">
                  <EmptyState
                    heading="No presets yet"
                    action={{
                      content: "Open Editor",
                      url: "/app/sdl3d/editor",
                    }}
                    image=""
                  >
                    <Text as="p">
                      To create a preset, open the Editor for any product, select hotspots with the checkboxes, then click "Save as Preset". Saved presets appear here for reuse.
                    </Text>
                  </EmptyState>
                </Box>
              ) : (
                <BlockStack gap="0">
                  <Box padding="300" borderBlockEndWidth="025" borderColor="border">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" variant="bodySm" fontWeight="medium">
                        Show:
                      </Text>
                      <ButtonGroup variant="segmented">
                        <Button
                          pressed={filter === "ALL"}
                          onClick={() => setFilter("ALL")}
                          size="slim"
                        >
                          {`All (${presetData.length})`}
                        </Button>
                        <Button
                          pressed={filter === "MODEL_3D"}
                          onClick={() => setFilter("MODEL_3D")}
                          size="slim"
                        >
                          {`3D Model (${presetData.filter((p) => p.viewerType === "MODEL_3D").length})`}
                        </Button>
                        <Button
                          pressed={filter === "IMAGE_360"}
                          onClick={() => setFilter("IMAGE_360")}
                          size="slim"
                        >
                          {`360° (${presetData.filter((p) => p.viewerType === "IMAGE_360").length})`}
                        </Button>
                      </ButtonGroup>
                    </InlineStack>
                  </Box>
                  {filteredPresets.length === 0 ? (
                    <Box padding="500">
                      <Text as="p" tone="subdued" alignment="center">
                        No presets match the current filter.
                      </Text>
                    </Box>
                  ) : (
                    <ResourceList
                      resourceName={{ singular: "preset", plural: "presets" }}
                      items={filteredPresets}
                      renderItem={(row) => (
                        <PresetResourceRow
                          key={row.id}
                          row={row}
                          renaming={renamingId === row.id}
                          renameValue={renameValue}
                          onRenameValueChange={setRenameValue}
                          onRenameStart={() => handleRenameStart(row)}
                          onRenameCancel={() => setRenamingId(null)}
                          onRenameSubmit={() => handleRenameSubmit(row.id)}
                          renameLoading={renameFetcher.state !== "idle"}
                          expanded={expandedId === row.id}
                          onToggleExpand={() => handleToggleExpand(row.id)}
                          onDelete={() => setDeleteTarget(row)}
                          onEdit={() => setEditTarget(row)}
                        />
                      )}
                    />
                  )}
                </BlockStack>
              )}
            </Card>
          </Layout.Section>
        </Layout>

        {editTarget ? (
          <PresetEditModal
            preset={editTarget}
            saving={updateHotspotsFetcher.state !== "idle"}
            onClose={() => setEditTarget(null)}
            onSave={(payload) => {
              const fd = new FormData();
              fd.set("intent", "updateHotspots");
              fd.set("presetId", editTarget.id);
              if (editTarget.viewerType === "IMAGE_360") {
                fd.set("hotspotsJson360", payload);
              } else {
                fd.set("hotspotsJson", payload);
              }
              updateHotspotsFetcher.submit(fd, {
                method: "post",
                action: "/api/sdl3d/presets",
              });
            }}
          />
        ) : null}

        {deleteTarget ? (
          <Modal
            open
            onClose={() => setDeleteTarget(null)}
            title={`Delete "${deleteTarget.name}"?`}
            primaryAction={{
              content: "Delete",
              destructive: true,
              loading: deleteFetcher.state !== "idle",
              onAction: () => {
                const fd = new FormData();
                fd.set("intent", "delete");
                fd.set("presetId", deleteTarget.id);
                deleteFetcher.submit(fd, { method: "post", action: "/api/sdl3d/presets" });
              },
            }}
            secondaryActions={[
              { content: "Cancel", onAction: () => setDeleteTarget(null) },
            ]}
          >
            <Modal.Section>
              <BlockStack gap="200">
                <Text as="p">
                  This preset will be removed from the saved list. Products that already had it applied keep their current hotspots — only the preset definition is deleted.
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  {deleteTarget.totalCount} hotspot{deleteTarget.totalCount === 1 ? "" : "s"} ·
                  {deleteTarget.count360 > 0
                    ? ` ${deleteTarget.count3d} 3D, ${deleteTarget.count360} 360°`
                    : " 3D model"}
                </Text>
              </BlockStack>
            </Modal.Section>
          </Modal>
        ) : null}
      </Page>

      {toast ? (
        <Toast
          content={toast.message}
          error={toast.error}
          onDismiss={() => setToast(null)}
          duration={3500}
        />
      ) : null}
    </Frame>
  );
}

function PresetResourceRow({
  row,
  renaming,
  renameValue,
  onRenameValueChange,
  onRenameStart,
  onRenameCancel,
  onRenameSubmit,
  renameLoading,
  expanded,
  onToggleExpand,
  onDelete,
  onEdit,
}: {
  row: PresetRow;
  renaming: boolean;
  renameValue: string;
  onRenameValueChange: (next: string) => void;
  onRenameStart: () => void;
  onRenameCancel: () => void;
  onRenameSubmit: () => void;
  renameLoading: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  return (
    <ResourceItem
      id={row.id}
      onClick={() => undefined}
      accessibilityLabel={`Preset ${row.name}`}
    >
      <BlockStack gap="200">
        <InlineStack gap="300" blockAlign="center" wrap={false}>
          {renaming ? (
            <PolarisForm onSubmit={onRenameSubmit}>
              <InlineStack gap="200" blockAlign="center" wrap={false}>
                <Box minWidth="240px">
                  <TextField
                    label="Preset name"
                    labelHidden
                    value={renameValue}
                    onChange={onRenameValueChange}
                    autoComplete="off"
                    autoFocus
                  />
                </Box>
                <Button
                  submit
                  variant="primary"
                  size="slim"
                  loading={renameLoading}
                  disabled={renameLoading}
                >
                  Save
                </Button>
                <Button size="slim" onClick={onRenameCancel} disabled={renameLoading}>
                  Cancel
                </Button>
              </InlineStack>
            </PolarisForm>
          ) : (
            <>
              <Text as="h3" variant="headingSm">
                {row.name}
              </Text>
              {row.colors.length > 0 ? (
                <InlineStack gap="100">
                  {row.colors.map((c, i) => (
                    <span
                      key={i}
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: c,
                        border: "1px solid rgba(0, 0, 0, 0.15)",
                        display: "inline-block",
                      }}
                    />
                  ))}
                </InlineStack>
              ) : null}
              {row.count360 > 0 ? <Badge>360°</Badge> : null}
            </>
          )}
        </InlineStack>

        {!renaming ? (
          <Text as="p" tone="subdued" variant="bodySm">
            {row.totalCount} hotspot{row.totalCount === 1 ? "" : "s"}
            {row.count360 > 0
              ? ` (${row.count3d} 3D, ${row.count360} 360°)`
              : ""}
            {" · "}
            <span suppressHydrationWarning>
              Updated {new Date(row.updatedAt).toLocaleDateString()}
            </span>
          </Text>
        ) : null}

        {!renaming ? (
          <InlineStack gap="200">
            <Button size="slim" onClick={onToggleExpand}>
              {expanded ? "Hide hotspots" : "View hotspots"}
            </Button>
            <Button size="slim" onClick={onEdit}>
              Edit
            </Button>
            <Button size="slim" onClick={onRenameStart}>
              Rename
            </Button>
            <Button size="slim" tone="critical" onClick={onDelete}>
              Delete
            </Button>
          </InlineStack>
        ) : null}

        <Collapsible
          id={`preset-${row.id}-expand`}
          open={expanded && !renaming}
          transition={{ duration: "150ms", timingFunction: "ease-in-out" }}
        >
          <Box paddingBlockStart="200">
            <PresetHotspotList
              hotspotsJson={
                row.viewerType === "IMAGE_360" && row.hotspotsJson360
                  ? row.hotspotsJson360
                  : row.hotspotsJson
              }
            />
          </Box>
        </Collapsible>
      </BlockStack>
    </ResourceItem>
  );
}

/**
 * Slice 8 PR #3 — per-preset Edit Modal. Inline-editable title / body /
 * color per hotspot + per-row Delete + "Add hotspot" footer button.
 *
 * No position editing on purpose (would basically rebuild the canvas
 * editor inside a Modal). Positions stay as-saved when the preset was
 * originally captured; new rows added here get sane defaults so they
 * can be repositioned later when the preset is applied to a product.
 *
 * Save submits the whole hotspot array back via intent=updateHotspots.
 */
function PresetEditModal({
  preset,
  saving,
  onClose,
  onSave,
}: {
  preset: PresetRow;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: string) => void;
}) {
  const sourceJson =
    preset.viewerType === "IMAGE_360" && preset.hotspotsJson360
      ? preset.hotspotsJson360
      : preset.hotspotsJson;

  type EditableHotspot = {
    title: string;
    body: string;
    color: string;
    // Carry the rest of the original fields through so position / keyframes /
    // CTA / focus orbit etc. survive the round-trip — we only mutate the
    // three editable fields. The shape is intentionally loose because 3D
    // and 360 hotspots differ but only on fields we don't touch here.
    rest: Record<string, unknown>;
  };

  const initial = useMemo<EditableHotspot[]>(() => {
    try {
      const parsed = JSON.parse(sourceJson);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((h: Record<string, unknown>) => {
        const { title, body, color, ...rest } = h;
        return {
          title: typeof title === "string" ? title : "",
          body: typeof body === "string" ? body : "",
          color: typeof color === "string" ? color : "#3b82f6",
          rest,
        };
      });
    } catch {
      return [];
    }
  }, [sourceJson]);

  const [rows, setRows] = useState<EditableHotspot[]>(initial);

  function updateRow(index: number, patch: Partial<EditableHotspot>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function addRow() {
    const nextIndex = rows.length + 1;
    const defaults =
      preset.viewerType === "IMAGE_360"
        ? defaults360(nextIndex)
        : defaultsMODEL3D(nextIndex);
    setRows((prev) => [
      ...prev,
      {
        title: `Hotspot ${nextIndex}`,
        body: "",
        color: "#3b82f6",
        rest: defaults,
      },
    ]);
  }

  function save() {
    const payload = rows.map((r) => ({
      ...r.rest,
      title: r.title,
      body: r.body,
      color: r.color,
    }));
    onSave(JSON.stringify(payload));
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit "${preset.name}"`}
      size="large"
      primaryAction={{
        content: "Save changes",
        loading: saving,
        disabled: saving,
        onAction: save,
      }}
      secondaryActions={[
        { content: "Cancel", onAction: onClose, disabled: saving },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          <Text as="p" tone="subdued" variant="bodySm">
            Edit titles, body text, and colour for each hotspot in this preset. Positions and keyframes stay as-saved — re-place them when you apply the preset to a product.
          </Text>
          {rows.length === 0 ? (
            <Text as="p" alignment="center" tone="subdued">
              This preset has no hotspots. Add one to start.
            </Text>
          ) : (
            <BlockStack gap="200">
              {rows.map((row, i) => (
                <Box
                  key={i}
                  padding="300"
                  background="bg-surface-secondary"
                  borderRadius="200"
                >
                  <BlockStack gap="200">
                    <InlineStack gap="200" blockAlign="center" wrap={false}>
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {`#${i + 1}`}
                      </Text>
                      <Box width="100%">
                        <TextField
                          label={`Hotspot ${i + 1} title`}
                          labelHidden
                          value={row.title}
                          onChange={(v) => updateRow(i, { title: v })}
                          autoComplete="off"
                          placeholder="Title"
                        />
                      </Box>
                      <input
                        type="color"
                        value={row.color}
                        onChange={(e) => updateRow(i, { color: e.target.value })}
                        aria-label={`Hotspot ${i + 1} colour`}
                        style={{
                          width: 36,
                          height: 32,
                          border: "1px solid var(--p-color-border, #c9cccf)",
                          borderRadius: "var(--p-border-radius-200, 8px)",
                          cursor: "pointer",
                          padding: 0,
                          background: "transparent",
                          flexShrink: 0,
                        }}
                      />
                      <Button
                        size="slim"
                        tone="critical"
                        variant="plain"
                        onClick={() => removeRow(i)}
                        disabled={saving}
                      >
                        Remove
                      </Button>
                    </InlineStack>
                    <TextField
                      label={`Hotspot ${i + 1} body`}
                      labelHidden
                      value={row.body}
                      onChange={(v) => updateRow(i, { body: v })}
                      autoComplete="off"
                      placeholder="Body"
                      multiline={2}
                    />
                  </BlockStack>
                </Box>
              ))}
            </BlockStack>
          )}
          <InlineStack>
            <Button onClick={addRow} disabled={saving}>
              + Add hotspot
            </Button>
          </InlineStack>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

function defaultsMODEL3D(index: number): Record<string, unknown> {
  return {
    id: `hs_${Date.now()}_${index}`,
    sortOrder: index,
    visible: true,
    icon: null,
    style: "card",
    position: "0m 0m 0m",
    normal: "0m 1m 0m",
    focusTarget: "0m 0m 0m",
    focusOrbit: "0deg 75deg 105%",
    ctaLabel: null,
    ctaUrl: null,
  };
}

function defaults360(index: number): Record<string, unknown> {
  return {
    id: `hs360_${Date.now()}_${index}`,
    sortOrder: index,
    visible: true,
    style: "card",
    visibleFrameStart: 0,
    visibleFrameEnd: 0,
    keyframes: [{ frame: 0, x: 50, y: 50 }],
    ctaLabel: null,
    ctaUrl: null,
  };
}

function PresetHotspotList({ hotspotsJson }: { hotspotsJson: string }) {
  let hotspots: Array<{
    title?: string;
    body?: string;
    style?: string;
    color?: string | null;
    visible?: boolean;
  }> = [];
  try {
    const parsed = JSON.parse(hotspotsJson);
    if (Array.isArray(parsed)) hotspots = parsed;
  } catch {
    /* ignore */
  }

  if (hotspots.length === 0) {
    return (
      <Text as="p" tone="subdued" variant="bodySm">
        No hotspots in this preset.
      </Text>
    );
  }

  return (
    <BlockStack gap="100">
      {hotspots.map((h, i) => (
        <Box
          key={i}
          padding="200"
          background="bg-surface-secondary"
          borderRadius="200"
        >
          <InlineStack gap="200" blockAlign="center" wrap={false}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: h.color || "#3b82f6",
                border: "1px solid rgba(0, 0, 0, 0.15)",
                flexShrink: 0,
                display: "inline-block",
              }}
            />
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {h.title || `Hotspot ${i + 1}`}
            </Text>
            <Text as="span" tone="subdued" variant="bodySm">
              {h.style || "card"}
            </Text>
            {h.visible === false ? (
              <Badge tone="warning" size="small">hidden</Badge>
            ) : null}
          </InlineStack>
        </Box>
      ))}
    </BlockStack>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} — ${error.statusText || "Something went wrong"}`
    : error instanceof Error
      ? error.message
      : "An unexpected error occurred.";

  return (
    <Frame>
      <Page title="Presets error">
        <Layout>
          <Layout.Section>
            <Banner tone="critical" title="Presets page failed to load">
              <Text as="p">{message}</Text>
            </Banner>
          </Layout.Section>
          <Layout.Section>
            <InlineStack gap="200">
              <Button url="/app/sdl3d/presets" variant="primary">
                Reload
              </Button>
              <Button url="/app">Dashboard</Button>
            </InlineStack>
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}
