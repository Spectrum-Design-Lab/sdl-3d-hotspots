/**
 * Slice 6 PR #2 — Reuse existing bucket folders for 360°.
 * Slice 7 PR #3b — refactored to be a body-only component that auto-fetches
 * on mount. The unified Sdl3dMediaSourceModal owns the Modal chrome now.
 *
 * Lists frame-bearing folders (≥24 image files) under the shop's selected
 * storage bucket. Selecting one short-circuits the capture pipeline and
 * writes the resolved frame URLs directly into the product's
 * imageSequenceJson.
 *
 * No `.server` imports — reachable from the editor route's JSX.
 */
import { useCallback, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  EmptyState,
  InlineStack,
  ResourceItem,
  ResourceList,
  Spinner,
  Text,
  Thumbnail,
} from "@shopify/polaris";

type BucketFolder = {
  prefix: string;
  name: string;
  frameCount: number;
  totalBytes: number;
  previewUrl: string;
  frameKeys: string[];
};

type ListResponse = {
  ok: boolean;
  message?: string;
  folders?: BucketFolder[];
  truncated?: boolean;
  needsStorageSetup?: boolean;
};

type UseResponse = {
  ok: boolean;
  message?: string;
  frameCount?: number;
};

type Props = {
  productGid: string;
  hasExistingFrames: boolean;
  existingFrameCount: number;
  /**
   * Optional storage row id override. When set, the picker lists folders from
   * this bucket and imports happen against it. Defaults to the shop's
   * default row. Slice 6 PR #3.
   */
  storageId?: string;
  onCompleted: (frameCount: number) => void;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function Sdl3dBucketFolderPicker({
  productGid,
  hasExistingFrames,
  existingFrameCount,
  storageId,
  onCompleted,
}: Props) {
  const listFetcher = useFetcher<ListResponse>();
  const useFetcherOne = useFetcher<UseResponse>();

  const refreshList = useCallback(() => {
    const fd: Record<string, string> = {
      intent: "listBucketFolders",
      prefix: "",
    };
    if (storageId) fd.storageId = storageId;
    listFetcher.submit(fd, { method: "post", action: "/api/sdl3d/storage" });
  }, [listFetcher, storageId]);

  // Auto-fetch on mount + whenever storageId changes (e.g. merchant flips
  // the topbar storage selector while this Modal tab is open).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refreshList(); }, [storageId]);

  const handleUseFolder = useCallback(
    (folder: BucketFolder) => {
      const fd: Record<string, string> = {
        intent: "useBucketFolder",
        productGid,
        prefix: folder.prefix,
        frameKeys: JSON.stringify(folder.frameKeys),
      };
      if (storageId) fd.storageId = storageId;
      useFetcherOne.submit(fd, { method: "post", action: "/api/sdl3d/storage" });
    },
    [productGid, storageId, useFetcherOne],
  );

  // Ref-guarded so we only react once per fetcher response — useFetcher
  // identity is stable but `.data` reference is per-response.
  const seenUseRef = useRef<unknown>(null);
  useEffect(() => {
    if (useFetcherOne.state !== "idle" || !useFetcherOne.data) return;
    if (seenUseRef.current === useFetcherOne.data) return;
    seenUseRef.current = useFetcherOne.data;
    if (useFetcherOne.data.ok && typeof useFetcherOne.data.frameCount === "number") {
      onCompleted(useFetcherOne.data.frameCount);
    }
  }, [useFetcherOne.state, useFetcherOne.data, onCompleted]);

  const isListing = listFetcher.state !== "idle";
  const isImporting = useFetcherOne.state !== "idle";
  const importingPrefix =
    (useFetcherOne.formData?.get("prefix") as string | null) ?? null;

  const folders = listFetcher.data?.folders ?? [];
  const listError =
    listFetcher.data && !listFetcher.data.ok ? listFetcher.data.message ?? null : null;
  const importError =
    useFetcherOne.data && !useFetcherOne.data.ok
      ? useFetcherOne.data.message ?? null
      : null;

  return (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="center">
        <Banner tone="info">
          Frames are used as-is — capture-pipeline validation (size,
          ordering) is skipped. Folders must contain at least 24 image
          files (.jpg / .jpeg / .png / .webp) to appear here.
        </Banner>
      </InlineStack>

      {hasExistingFrames ? (
        <Banner tone="warning">
          This product already has {existingFrameCount} frames. Selecting
          a folder replaces them.
        </Banner>
      ) : null}

      {importError ? (
        <Banner tone="critical" title="Import failed">
          <Text as="p">{importError}</Text>
        </Banner>
      ) : null}

      {listError ? (
        <Banner
          tone="critical"
          title="Can't list bucket folders"
          action={{ content: "Retry", onAction: refreshList }}
        >
          <Text as="p">{listError}</Text>
        </Banner>
      ) : null}

      {listFetcher.data?.truncated ? (
        <Banner tone="warning">
          Bucket has more than 10,000 objects under this prefix — only
          the first batch was scanned. Narrow the prefix or organize
          frames under a sub-folder.
        </Banner>
      ) : null}

      {isListing ? (
        <Box padding="600">
          <InlineStack align="center" gap="200">
            <Spinner accessibilityLabel="Listing bucket folders" size="small" />
            <Text as="span" tone="subdued">
              Scanning bucket…
            </Text>
          </InlineStack>
        </Box>
      ) : null}

      {!isListing && !listError && folders.length === 0 && listFetcher.data ? (
        <EmptyState
          heading="No frame sequences found"
          image=""
          action={{ content: "Reload", onAction: refreshList }}
        >
          <Text as="p">
            Upload a folder of at least 24 images
            (.jpg / .jpeg / .png / .webp) to your bucket, then click Reload.
          </Text>
        </EmptyState>
      ) : null}

      {!isListing && folders.length > 0 ? (
        <ResourceList
          resourceName={{ singular: "folder", plural: "folders" }}
          items={folders}
          renderItem={(folder) => (
            <BucketFolderRow
              key={folder.prefix}
              folder={folder}
              busy={isImporting && importingPrefix === folder.prefix}
              disabled={isImporting}
              onUse={handleUseFolder}
            />
          )}
        />
      ) : null}
    </BlockStack>
  );
}

function BucketFolderRow({
  folder,
  busy,
  disabled,
  onUse,
}: {
  folder: BucketFolder;
  busy: boolean;
  disabled: boolean;
  onUse: (folder: BucketFolder) => void;
}) {
  return (
    <ResourceItem
      id={folder.prefix}
      accessibilityLabel={`Use folder ${folder.prefix}`}
      onClick={() => {}}
      media={
        <Thumbnail
          size="small"
          source={folder.previewUrl}
          alt={`Preview frame from ${folder.name}`}
        />
      }
    >
      <InlineStack align="space-between" blockAlign="center" wrap={false} gap="300">
        <BlockStack gap="100">
          <InlineStack gap="200" blockAlign="center" wrap={false}>
            <Text as="h3" variant="bodyMd" fontWeight="semibold">
              {folder.name}
            </Text>
            <Badge tone="info">{`${folder.frameCount} frames`}</Badge>
          </InlineStack>
          <Text as="p" tone="subdued" variant="bodySm">
            {folder.prefix} · {formatBytes(folder.totalBytes)}
          </Text>
        </BlockStack>
        <Button
          variant="primary"
          loading={busy}
          disabled={disabled && !busy}
          onClick={() => onUse(folder)}
        >
          Use this folder
        </Button>
      </InlineStack>
    </ResourceItem>
  );
}
