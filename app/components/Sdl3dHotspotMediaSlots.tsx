/**
 * Slice 8 hotspots PR #5 — typed media slots for the hotspot popup.
 *
 * Two slots:
 *   - mediaImageUrl: hosted image (URL paste or Shopify Files pick).
 *     Lives above the title on the storefront popup.
 *   - mediaVideoUrl: video URL (YouTube / Vimeo / direct .mp4|.webm).
 *     Storefront detects provider and renders an iframe embed for
 *     YouTube + Vimeo, <video controls> for direct files.
 *
 * Caller passes `resolvedImageUrl` when mediaImageUrl is a Shopify
 * file GID — same pattern as the icon picker. Empty inputs clear
 * the slot (no popup section renders on the storefront).
 */
import { useEffect, useState } from "react";
import {
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  InlineStack,
  Text,
  TextField,
} from "@shopify/polaris";
import { classifyVideoUrl, isValidVideoUrl } from "../lib/sdl3d-shared";

interface Sdl3dHotspotMediaSlotsProps {
  mediaImageUrl: string | null;
  mediaImageResolvedUrl?: string | null;
  mediaVideoUrl: string | null;
  onChangeImage: (next: string | null) => void;
  onChangeVideo: (next: string | null) => void;
  onPickImageFromShopifyFiles: () => void;
}

export function Sdl3dHotspotMediaSlots({
  mediaImageUrl,
  mediaImageResolvedUrl,
  mediaVideoUrl,
  onChangeImage,
  onChangeVideo,
  onPickImageFromShopifyFiles,
}: Sdl3dHotspotMediaSlotsProps) {
  const isImageGid = !!mediaImageUrl && mediaImageUrl.startsWith("gid://shopify/");
  const isImageUrl =
    !!mediaImageUrl &&
    (mediaImageUrl.startsWith("http://") ||
      mediaImageUrl.startsWith("https://") ||
      mediaImageUrl.startsWith("//"));
  const displayedImageUrl = isImageGid ? mediaImageResolvedUrl ?? null : isImageUrl ? mediaImageUrl : null;

  const [imageUrlDraft, setImageUrlDraft] = useState<string>(isImageUrl ? mediaImageUrl ?? "" : "");
  useEffect(() => {
    // Re-sync the draft when the parent flips to a GID or clears the
    // value — don't trample a mid-edit URL paste though.
    if (!isImageUrl) setImageUrlDraft("");
  }, [isImageUrl, mediaImageUrl]);

  const [videoDraft, setVideoDraft] = useState<string>(mediaVideoUrl ?? "");
  useEffect(() => {
    setVideoDraft(mediaVideoUrl ?? "");
  }, [mediaVideoUrl]);

  const videoTrimmed = videoDraft.trim();
  const videoKind = videoTrimmed ? classifyVideoUrl(videoTrimmed) : "unknown";
  const videoError = videoTrimmed && !isValidVideoUrl(videoTrimmed)
    ? "Use a YouTube, Vimeo, or direct .mp4 / .webm URL."
    : undefined;

  return (
    <BlockStack gap="200">
      <Text as="span" variant="bodySm" fontWeight="medium">
        Popup media
      </Text>

      {/* Image slot */}
      <BlockStack gap="100">
        <InlineStack gap="200" blockAlign="center" wrap={false}>
          <ImagePreview url={displayedImageUrl} placeholder={!mediaImageUrl} />
          <BlockStack gap="050">
            <Text as="span" variant="bodySm">
              Image
            </Text>
            <Text as="span" tone="subdued" variant="bodySm">
              {mediaImageUrl
                ? isImageGid
                  ? "Shopify Files"
                  : "URL"
                : "Optional. Renders above the title in the popup."}
            </Text>
          </BlockStack>
          {mediaImageUrl ? (
            <Button size="slim" variant="plain" onClick={() => onChangeImage(null)}>
              Clear
            </Button>
          ) : null}
        </InlineStack>
        <TextField
          label="Image URL"
          labelHidden
          type="url"
          value={imageUrlDraft}
          onChange={setImageUrlDraft}
          onBlur={() => {
            const trimmed = imageUrlDraft.trim();
            if (!trimmed) {
              if (isImageUrl) onChangeImage(null);
              return;
            }
            if (trimmed !== mediaImageUrl) onChangeImage(trimmed);
          }}
          placeholder="Paste an image URL, or pick from Shopify Files →"
          autoComplete="off"
        />
        <Box>
          <ButtonGroup>
            <Button size="slim" onClick={onPickImageFromShopifyFiles}>
              Pick from Shopify Files
            </Button>
          </ButtonGroup>
        </Box>
      </BlockStack>

      {/* Video slot */}
      <BlockStack gap="100">
        <TextField
          label="Video URL"
          type="url"
          value={videoDraft}
          onChange={setVideoDraft}
          onBlur={() => {
            const trimmed = videoDraft.trim();
            const next = trimmed || null;
            if (next !== mediaVideoUrl) onChangeVideo(next);
          }}
          placeholder="YouTube, Vimeo, or .mp4 / .webm URL"
          error={videoError}
          helpText={
            videoKind === "youtube"
              ? "YouTube — renders as an embedded player."
              : videoKind === "vimeo"
                ? "Vimeo — renders as an embedded player."
                : videoKind === "file"
                  ? "Direct video file — renders with native controls."
                  : "Renders above the title in the popup. Storefront detects the provider."
          }
          autoComplete="off"
        />
      </BlockStack>
    </BlockStack>
  );
}

function ImagePreview({ url, placeholder }: { url: string | null; placeholder: boolean }) {
  return (
    <div
      style={{
        width: 56,
        height: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--p-color-bg-surface-secondary, #f6f6f7)",
        border: "1px solid var(--p-color-border, #c9cccf)",
        borderRadius: "var(--p-border-radius-200, 8px)",
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      {url ? (
        <img
          src={url}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <Text as="span" tone="subdued" variant="bodySm">
          {placeholder ? "—" : "?"}
        </Text>
      )}
    </div>
  );
}
