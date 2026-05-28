/**
 * Slice 7 PR #3b — unified 360° image-sequence source Modal.
 *
 * One entry point for "where do my 360 frames come from?" — replaces three
 * competing standalone surfaces in the Media inspector:
 *   - Sdl3dRawCaptureUploader (CDN auto-process upload)
 *   - Sdl3dBucketFolderPicker (CDN folder reuse)
 *   - FileBrowserModal mode="sequence" (Shopify Files browse + upload)
 *
 * Three tabs:
 *   1. "Upload to CDN" — embeds Sdl3dRawCaptureUploader's body (zip / raw
 *      images → capture pipeline → CDN-hosted frames).
 *   2. "Browse Shopify Files" — explanatory + button that routes to the
 *      existing FileBrowserModal. We don't embed FileBrowserModal because
 *      it's a heavyweight modal of its own (1000+ lines, paginated grid,
 *      folder management); rendering it inside another modal would
 *      require extracting its body, which is out of scope for this PR.
 *   3. "Browse CDN folders" — embeds Sdl3dBucketFolderPicker (auto-fetches
 *      folder list from the editor's selected storage row on mount).
 *
 * No `.server` imports — reachable from the editor route's JSX.
 */
import { useState } from "react";
import {
  BlockStack,
  Button,
  EmptyState,
  Modal,
  Tabs,
  Text,
} from "@shopify/polaris";
import { Sdl3dRawCaptureUploader } from "./Sdl3dRawCaptureUploader";
import { Sdl3dBucketFolderPicker } from "./Sdl3dBucketFolderPicker";
import type { CaptureStatus } from "../lib/captures-shared";
import { BRAND } from "../lib/brand";

type Props = {
  open: boolean;
  onClose: () => void;
  productGid: string;
  productConfigId: string;
  frameCount: number;
  storageId?: string;
  latestCapture?: {
    id: string;
    status: CaptureStatus;
    errorMessage: string | null;
    frameCountActual: number | null;
    frameCountTarget: number;
    validationJson?: string | null;
  } | null;
  /** Called when any flow completes (capture done, folder selected, or
   *  Shopify Files browser selection committed). Parent revalidates. */
  onCompleted: () => void;
  /** Called when the merchant wants to use the legacy Shopify Files
   *  browser (FileBrowserModal). The parent should close this Modal and
   *  open its existing FileBrowserModal in sequence mode. */
  onOpenShopifyFilesBrowser: () => void;
};

const TAB_IDS = ["upload-cdn", "browse-shopify", "browse-cdn"] as const;
type TabId = (typeof TAB_IDS)[number];

const TABS = [
  { id: "upload-cdn", content: "Upload to CDN", panelID: "panel-upload-cdn" },
  { id: "browse-shopify", content: "Browse Shopify Files", panelID: "panel-browse-shopify" },
  { id: "browse-cdn", content: "Browse CDN folders", panelID: "panel-browse-cdn" },
] as const;

export function Sdl3dMediaSourceModal({
  open,
  onClose,
  productGid,
  productConfigId,
  frameCount,
  storageId,
  latestCapture,
  onCompleted,
  onOpenShopifyFilesBrowser,
}: Props) {
  const [tabIndex, setTabIndex] = useState(0);
  const activeTab: TabId = TAB_IDS[tabIndex];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="360° image sequence"
      size="large"
      secondaryActions={[{ content: "Close", onAction: onClose }]}
    >
      <Modal.Section>
        <Tabs
          tabs={TABS as unknown as Array<{ id: string; content: string; panelID: string }>}
          selected={tabIndex}
          onSelect={setTabIndex}
        />

        <div style={{ paddingTop: "var(--p-space-400)" }}>
          {activeTab === "upload-cdn" ? (
            <BlockStack gap="300">
              <Text as="p" tone="subdued" variant="bodySm">
                Drop a folder of raw turntable photos (or a .zip). The worker
                samples them to 72 frames, converts to WebP, and writes the
                resulting sequence to your bucket. Your bucket — never {BRAND.vendorName}&apos;s.
              </Text>
              <Sdl3dRawCaptureUploader
                productGid={productGid}
                productConfigId={productConfigId}
                initialCapture={latestCapture ?? null}
                storageId={storageId}
                embedded
                onCompleted={onCompleted}
              />
            </BlockStack>
          ) : null}

          {activeTab === "browse-shopify" ? (
            <EmptyState
              heading="Use frames already in Shopify Files"
              action={{
                content: "Open Shopify Files browser",
                onAction: () => {
                  onClose();
                  onOpenShopifyFilesBrowser();
                },
              }}
              image=""
            >
              <Text as="p">
                Opens the Shopify Files picker so you can pick existing
                frame images or upload a ZIP / individual images directly to
                Shopify Files. Use this when your frames live in Shopify
                rather than your own CDN bucket.
              </Text>
            </EmptyState>
          ) : null}

          {activeTab === "browse-cdn" ? (
            <Sdl3dBucketFolderPicker
              productGid={productGid}
              hasExistingFrames={frameCount > 0}
              existingFrameCount={frameCount}
              storageId={storageId}
              onCompleted={() => {
                onCompleted();
                onClose();
              }}
            />
          ) : null}
        </div>
      </Modal.Section>
    </Modal>
  );
}
