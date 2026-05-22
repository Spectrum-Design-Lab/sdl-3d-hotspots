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
import { useState } from "react";
import {
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  InlineStack,
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
  // Custom tab is active when the merchant has picked a non-preset
  // value (URL or GID), or when they explicitly switch tabs.
  const initialTab = kind === "url" || kind === "gid" ? 1 : 0;
  const [tab, setTab] = useState(initialTab);

  // Local draft for the URL TextField so the merchant can type without
  // committing on every keystroke. Commit on blur via onChange — same
  // pattern as the CTA URL field.
  const [urlDraft, setUrlDraft] = useState<string>(kind === "url" ? (value ?? "") : "");

  const tabs = [
    { id: "preset", content: "Preset", panelID: "icon-picker-preset" },
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
  if (kind === "url") return "Custom · URL";
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
