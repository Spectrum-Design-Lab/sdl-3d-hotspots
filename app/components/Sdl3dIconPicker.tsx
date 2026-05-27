/**
 * Slice 8 hotspots PR #4 — hotspot icon picker.
 *
 * Two Polaris Tabs: "Preset" (14-icon SVG grid) and "Custom"
 * (URL paste + a "Pick from Shopify Files" Button that opens the
 * editor's existing FileBrowserModal via the onPickFromShopifyFiles
 * callback). Caller owns the modal — this picker just emits intent.
 *
 * The `value` prop is the raw hotspot.icon string. Three shapes:
 *   - preset key ("plus", "minus", ...)
 *   - absolute URL ("https://...")
 *   - Shopify file GID ("gid://shopify/MediaImage/...")
 *
 * For GIDs, the caller passes `resolvedUrl` (looked up server-side on
 * the loader) so the live preview can render the image.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  InlineStack,
  Spinner,
  Tabs,
  Text,
  TextField,
} from "@shopify/polaris";
import {
  HOTSPOT_ICON_KEYS,
  classifyIcon,
  presetIconLabel,
  presetIconSvg,
  type HotspotIconKey,
} from "@spectrum-design-lab/shared";

type LibraryIcon = {
  id: string;
  originalFilename: string;
  url: string;
  mimeType: string | null;
  sizeBytes: number | null;
  bucketKey: string | null;
  createdAt: string;
};

interface Sdl3dIconPickerProps {
  value: string | null;
  resolvedUrl?: string | null;
  onChange: (next: string | null) => void;
  onPickFromShopifyFiles: () => void;
}

export function Sdl3dIconPicker({
  value,
  resolvedUrl,
  onChange,
  onPickFromShopifyFiles,
}: Sdl3dIconPickerProps) {
  const kind = classifyIcon(value);
  // Default tab follows the current value:
  //   - preset / none → Preset (0)
  //   - URL that matches a library icon → Library (1)
  //   - any other URL / GID → Custom (2)
  // The library check happens after the icons load; until then anything
  // non-preset starts on Custom and the merchant can switch.
  const initialTab = kind === "url" || kind === "gid" ? 2 : 0;
  const [tab, setTab] = useState(initialTab);

  // Local draft for the URL TextField so the merchant can type without
  // committing on every keystroke. Commit on blur via onChange — same
  // pattern as the CTA URL field.
  const [urlDraft, setUrlDraft] = useState<string>(kind === "url" ? (value ?? "") : "");

  const tabs = [
    { id: "preset", content: "Preset", panelID: "icon-picker-preset" },
    { id: "library", content: "Library", panelID: "icon-picker-library" },
    { id: "custom", content: "Custom", panelID: "icon-picker-custom" },
  ];

  return (
    <BlockStack gap="200">
      <InlineStack gap="200" blockAlign="center" wrap={false}>
        <IconPreview value={value} resolvedUrl={resolvedUrl} />
        <BlockStack gap="050">
          <Text as="span" variant="bodySm" fontWeight="medium">
            Icon
          </Text>
          <Text as="span" tone="subdued" variant="bodySm">
            {iconSummary(value, kind)}
          </Text>
        </BlockStack>
        {value ? (
          <Button size="slim" variant="plain" onClick={() => onChange(null)}>
            Clear
          </Button>
        ) : null}
      </InlineStack>

      <Tabs tabs={tabs} selected={tab} onSelect={setTab} fitted>
        <Box paddingBlockStart="200">
          {tab === 0 ? (
            <PresetGrid value={value} onChange={onChange} />
          ) : tab === 1 ? (
            <LibraryTab value={value} onChange={onChange} />
          ) : (
            <CustomTab
              urlDraft={urlDraft}
              setUrlDraft={setUrlDraft}
              onChange={onChange}
              onPickFromShopifyFiles={onPickFromShopifyFiles}
              currentValue={value}
              currentKind={kind}
            />
          )}
        </Box>
      </Tabs>
    </BlockStack>
  );
}

/**
 * Library tab — fetches the shop's uploaded custom icons from
 * /api/sdl3d/icons, renders a clickable grid, and provides an Upload
 * button that posts a multipart form. Selected icon's URL flows back
 * through `onChange` (same shape as the URL custom path), so the rest
 * of the editor doesn't need to know icons can now live in the
 * merchant's CDN library.
 */
function LibraryTab({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const [icons, setIcons] = useState<LibraryIcon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sdl3d/icons");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `failed to load icons (${res.status})`);
      }
      const body = await res.json();
      setIcons(Array.isArray(body.icons) ? body.icons : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("intent", "upload");
      form.append("file", file);
      const res = await fetch("/api/sdl3d/icons", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `upload failed (${res.status})`);
      const newIcon: LibraryIcon = body.icon;
      setIcons((prev) => [newIcon, ...prev]);
      // Auto-select the newly uploaded icon — fast path for the common
      // "upload + use immediately" flow.
      onChange(newIcon.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDelete(icon: LibraryIcon) {
    if (!window.confirm(`Delete "${icon.originalFilename}" from your icon library? Hotspots already using it will keep their URL.`)) return;
    try {
      const res = await fetch("/api/sdl3d/icons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "delete", id: icon.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `delete failed (${res.status})`);
      setIcons((prev) => prev.filter((i) => i.id !== icon.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <BlockStack gap="200">
      <InlineStack gap="200" blockAlign="center" wrap={false}>
        <Button
          onClick={() => fileInputRef.current?.click()}
          loading={uploading}
          disabled={uploading}
        >
          Upload icon
        </Button>
        <Text as="span" tone="subdued" variant="bodySm">
          SVG / PNG / JPEG / WebP / GIF · up to 1 MB
        </Text>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/svg+xml,image/png,image/jpeg,image/webp,image/gif"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
          }}
        />
      </InlineStack>

      {error ? (
        <Box>
          <Badge tone="critical">{error}</Badge>
        </Box>
      ) : null}

      {loading ? (
        <InlineStack gap="200" blockAlign="center">
          <Spinner size="small" accessibilityLabel="Loading icons" />
          <Text as="span" tone="subdued" variant="bodySm">
            Loading library…
          </Text>
        </InlineStack>
      ) : icons.length === 0 ? (
        <Text as="p" tone="subdued" variant="bodySm">
          No custom icons yet. Upload one to start your library — icons live in your connected storage bucket under <code>icons/</code>.
        </Text>
      ) : (
        <div
          role="group"
          aria-label="Library icons"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: "var(--p-space-200, 8px)",
          }}
        >
          {icons.map((icon) => {
            const isActive = value === icon.url;
            return (
              <div key={icon.id} style={{ position: "relative" }}>
                <button
                  type="button"
                  aria-label={`Use ${icon.originalFilename}`}
                  aria-pressed={isActive}
                  onClick={() => onChange(icon.url)}
                  title={icon.originalFilename}
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: isActive
                      ? "2px solid var(--p-color-border-emphasis, #008060)"
                      : "1px solid var(--p-color-border, #c9cccf)",
                    borderRadius: "var(--p-border-radius-200, 8px)",
                    background: isActive
                      ? "var(--p-color-bg-surface-selected, #e3f2eb)"
                      : "var(--p-color-bg-surface, #fff)",
                    cursor: "pointer",
                    padding: 6,
                    overflow: "hidden",
                  }}
                >
                  <img
                    src={icon.url}
                    alt=""
                    style={{ maxWidth: "100%", maxHeight: "100%", display: "block" }}
                  />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${icon.originalFilename}`}
                  title="Delete"
                  onClick={() => handleDelete(icon)}
                  style={{
                    position: "absolute",
                    top: -6,
                    right: -6,
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    border: "1px solid var(--p-color-border, #c9cccf)",
                    background: "var(--p-color-bg-surface, #fff)",
                    color: "var(--p-color-text-critical, #d72c0d)",
                    cursor: "pointer",
                    fontSize: 11,
                    lineHeight: 1,
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </BlockStack>
  );
}

function IconPreview({
  value,
  resolvedUrl,
}: {
  value: string | null;
  resolvedUrl?: string | null;
}) {
  const kind = classifyIcon(value);
  const previewBg = "var(--p-color-bg-surface-secondary, #f6f6f7)";
  const previewBorder = "1px solid var(--p-color-border, #c9cccf)";

  let inner: React.ReactNode = (
    <Text as="span" tone="subdued" variant="bodySm">
      —
    </Text>
  );

  if (kind === "preset") {
    inner = (
      <span
        aria-hidden
        style={{ color: "var(--p-color-text, #1c1c1e)", display: "inline-flex" }}
        dangerouslySetInnerHTML={{
          __html: presetIconSvg(value as HotspotIconKey, 28),
        }}
      />
    );
  } else if (kind === "url") {
    inner = (
      <img
        src={value ?? ""}
        alt=""
        style={{ maxWidth: 28, maxHeight: 28, display: "block" }}
      />
    );
  } else if (kind === "gid") {
    inner = resolvedUrl ? (
      <img
        src={resolvedUrl}
        alt=""
        style={{ maxWidth: 28, maxHeight: 28, display: "block" }}
      />
    ) : (
      <Text as="span" tone="subdued" variant="bodySm">
        ?
      </Text>
    );
  }

  return (
    <div
      style={{
        width: 44,
        height: 44,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: previewBg,
        border: previewBorder,
        borderRadius: "var(--p-border-radius-200, 8px)",
        flexShrink: 0,
      }}
    >
      {inner}
    </div>
  );
}

function iconSummary(value: string | null, kind: ReturnType<typeof classifyIcon>): string {
  if (kind === "none") return "No icon — dot shows the hotspot number.";
  if (kind === "preset") return `Preset · ${presetIconLabel(value as HotspotIconKey)}`;
  if (kind === "url") return "Custom · URL or library";
  return "Custom · Shopify Files";
}

function PresetGrid({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Preset icons"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        gap: "var(--p-space-200, 8px)",
      }}
    >
      {HOTSPOT_ICON_KEYS.map((key) => {
        const isActive = value === key;
        return (
          <button
            key={key}
            type="button"
            aria-label={presetIconLabel(key)}
            aria-pressed={isActive}
            onClick={() => onChange(key)}
            title={presetIconLabel(key)}
            style={{
              aspectRatio: "1 / 1",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: isActive
                ? "2px solid var(--p-color-border-emphasis, #008060)"
                : "1px solid var(--p-color-border, #c9cccf)",
              borderRadius: "var(--p-border-radius-200, 8px)",
              background: isActive
                ? "var(--p-color-bg-surface-selected, #e3f2eb)"
                : "var(--p-color-bg-surface, #fff)",
              color: "var(--p-color-text, #1c1c1e)",
              cursor: "pointer",
              padding: 6,
            }}
          >
            <span
              aria-hidden
              style={{ display: "inline-flex" }}
              dangerouslySetInnerHTML={{ __html: presetIconSvg(key, 22) }}
            />
          </button>
        );
      })}
    </div>
  );
}

function CustomTab({
  urlDraft,
  setUrlDraft,
  onChange,
  onPickFromShopifyFiles,
  currentValue,
  currentKind,
}: {
  urlDraft: string;
  setUrlDraft: (next: string) => void;
  onChange: (next: string | null) => void;
  onPickFromShopifyFiles: () => void;
  currentValue: string | null;
  currentKind: ReturnType<typeof classifyIcon>;
}) {
  return (
    <BlockStack gap="200">
      <TextField
        label="Image URL"
        type="url"
        value={urlDraft}
        onChange={setUrlDraft}
        onBlur={() => {
          const trimmed = urlDraft.trim();
          if (!trimmed) {
            // Empty draft + currently a URL value → clear; otherwise leave
            // GID / preset selections alone.
            if (currentKind === "url") onChange(null);
            return;
          }
          if (trimmed !== currentValue) onChange(trimmed);
        }}
        placeholder="https://cdn.example.com/icon.svg"
        helpText="32×32 SVG works best. PNG / JPG also render."
        autoComplete="off"
      />
      <Box>
        <ButtonGroup>
          <Button onClick={onPickFromShopifyFiles}>Pick from Shopify Files</Button>
          {currentKind === "gid" ? (
            <Text as="span" tone="subdued" variant="bodySm">
              Currently using a Shopify Files asset.
            </Text>
          ) : null}
        </ButtonGroup>
      </Box>
    </BlockStack>
  );
}
