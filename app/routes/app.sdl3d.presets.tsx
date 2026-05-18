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
  });

  return { presets, shop: session.shop };
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
  hotspotsJson: string;
  hotspotsJson360: string | null;
  updatedAt: string;
  count3d: number;
  count360: number;
  totalCount: number;
  colors: string[];
};

type PresetActionData = { ok?: boolean; message?: string };

export default function PresetsRoute() {
  const { presets } = useLoaderData<typeof loader>();

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PresetRow | null>(null);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);

  const renameFetcher = useFetcher<PresetActionData>();
  const deleteFetcher = useFetcher<PresetActionData>();

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

  const presetData: PresetRow[] = useMemo(() => {
    return presets.map((p) => {
      const count3d = parseHotspotCount(p.hotspotsJson);
      const count360 = p.hotspotsJson360 ? parseHotspotCount(p.hotspotsJson360) : 0;
      const colors = parseHotspotColors(p.hotspotsJson);
      return {
        id: p.id,
        name: p.name,
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
                <ResourceList
                  resourceName={{ singular: "preset", plural: "presets" }}
                  items={presetData}
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
                    />
                  )}
                />
              )}
            </Card>
          </Layout.Section>
        </Layout>

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
            <PresetHotspotList hotspotsJson={row.hotspotsJson} />
          </Box>
        </Collapsible>
      </BlockStack>
    </ResourceItem>
  );
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
