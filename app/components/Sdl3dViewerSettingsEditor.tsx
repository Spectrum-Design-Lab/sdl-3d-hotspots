/**
 * Viewer settings form. Two views — basic (Viewer inspector panel) and
 * advanced (Publish panel). Both edit the same JSON blob.
 *
 * Slice 8 — gates 3D-only fields by viewerType so 360 merchants don't
 * see (and tweak) settings that don't do anything. Stored values for
 * 3D-only fields persist quietly when the merchant flips to 360 and
 * back — we don't delete data, just hide the inputs.
 */
import {
  BlockStack,
  Checkbox,
  InlineStack,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import {
  defaultViewerSettings,
  type ViewerSettings,
  type ViewerType,
} from "../lib/sdl3d-shared";
import { getViewerSettingsFieldErrors } from "../lib/sdl3d-validation";

function parseViewerSettingsJson(valueJson: string): ViewerSettings {
  try {
    const parsed = JSON.parse(valueJson);
    if (!parsed || typeof parsed !== "object") {
      return defaultViewerSettings;
    }

    return {
      ...defaultViewerSettings,
      ...parsed,
    } as ViewerSettings;
  } catch {
    return defaultViewerSettings;
  }
}

function stringifyViewerSettings(next: ViewerSettings) {
  return JSON.stringify(next, null, 2);
}

const HOTSPOT_STYLE_OPTIONS = [
  { label: "card", value: "card" },
  { label: "tooltip", value: "tooltip" },
  { label: "dot", value: "dot" },
  { label: "badge", value: "badge" },
  { label: "icon-only", value: "icon-only" },
  { label: "panel", value: "panel" },
];

const INTERACTION_PROMPT_OPTIONS = [
  { label: "auto", value: "auto" },
  { label: "none", value: "none" },
];

export function Sdl3dViewerSettingsEditor({
  valueJson,
  onChangeJson,
  advanced,
  viewerType,
}: {
  valueJson: string;
  onChangeJson: (nextJson: string) => void;
  advanced?: boolean;
  viewerType: ViewerType;
}) {
  const settings = parseViewerSettingsJson(valueJson);
  const fieldErrors = getViewerSettingsFieldErrors(valueJson);
  const is3D = viewerType === "MODEL_3D";
  // Hint copy shown under each 3D-only section so 360 merchants who
  // flip back and forth don't think their values were deleted.
  const threeDOnlyHint = "Shown for 3D models only.";

  function update(patch: Partial<ViewerSettings>) {
    onChangeJson(
      stringifyViewerSettings({
        ...settings,
        ...patch,
      }),
    );
  }

  function updateNullableString<K extends keyof ViewerSettings>(key: K, value: string) {
    update({
      [key]: value.trim() === "" ? null : value,
    } as Partial<ViewerSettings>);
  }

  if (advanced) {
    return (
      <BlockStack gap="400">
        <Text as="h3" variant="headingSm">
          Advanced settings
        </Text>

        {is3D ? (
          <BlockStack gap="300">
            <BlockStack gap="050">
              <Text as="h4" variant="headingXs">
                Camera
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                {threeDOnlyHint}
              </Text>
            </BlockStack>
            <TextField
              label="Orbit"
              value={settings.cameraOrbit ?? ""}
              onChange={(value) => updateNullableString("cameraOrbit", value)}
              placeholder="0deg 75deg 105%"
              error={fieldErrors.cameraOrbit}
              autoComplete="off"
            />
            <TextField
              label="Target"
              value={settings.cameraTarget ?? ""}
              onChange={(value) => updateNullableString("cameraTarget", value)}
              placeholder="0m 0m 0m"
              error={fieldErrors.cameraTarget}
              autoComplete="off"
            />
            <TextField
              label="Field of view"
              value={settings.fieldOfView ?? ""}
              onChange={(value) => updateNullableString("fieldOfView", value)}
              placeholder="auto"
              autoComplete="off"
            />
            <TextField
              label="Min orbit"
              value={settings.minCameraOrbit ?? ""}
              onChange={(value) => updateNullableString("minCameraOrbit", value)}
              placeholder="auto auto auto"
              error={fieldErrors.minCameraOrbit}
              autoComplete="off"
            />
            <TextField
              label="Max orbit"
              value={settings.maxCameraOrbit ?? ""}
              onChange={(value) => updateNullableString("maxCameraOrbit", value)}
              placeholder="auto auto auto"
              error={fieldErrors.maxCameraOrbit}
              autoComplete="off"
            />
            <TextField
              label="Locked polar angle"
              value={settings.lockedPolarAngle ?? ""}
              onChange={(value) => updateNullableString("lockedPolarAngle", value)}
              placeholder="75deg"
              error={fieldErrors.lockedPolarAngle}
              autoComplete="off"
            />
          </BlockStack>
        ) : null}

        <BlockStack gap="300">
          <Text as="h4" variant="headingXs">
            Advanced paths
          </Text>
          {is3D ? (
            <>
              <Text as="p" tone="subdued" variant="bodySm">
                Environment + skybox images: {threeDOnlyHint.toLowerCase()}
              </Text>
              <TextField
                label="Environment image"
                value={settings.environmentImage ?? ""}
                onChange={(value) => updateNullableString("environmentImage", value)}
                placeholder="https://..."
                autoComplete="off"
              />
              <TextField
                label="Skybox image"
                value={settings.skyboxImage ?? ""}
                onChange={(value) => updateNullableString("skyboxImage", value)}
                placeholder="https://..."
                autoComplete="off"
              />
            </>
          ) : null}
          <TextField
            label="Poster override"
            value={settings.poster ?? ""}
            onChange={(value) => updateNullableString("poster", value)}
            placeholder="https://..."
            autoComplete="off"
          />
        </BlockStack>
      </BlockStack>
    );
  }

  return (
    <BlockStack gap="400">
      <Text as="h3" variant="headingSm">
        Viewer settings
      </Text>

      <BlockStack gap="300">
        <Text as="h4" variant="headingXs">
          Behavior
        </Text>
        <Checkbox
          label="Auto rotate"
          checked={settings.autoRotate}
          onChange={(checked) => update({ autoRotate: checked })}
        />
        {is3D ? (
          <>
            <Checkbox
              label="Camera controls"
              checked={settings.cameraControls}
              onChange={(checked) => update({ cameraControls: checked })}
            />
            <Select
              label="Prompt"
              options={INTERACTION_PROMPT_OPTIONS}
              value={settings.interactionPrompt ?? "auto"}
              onChange={(value) =>
                updateNullableString("interactionPrompt", value === "auto" ? "auto" : value)
              }
              helpText={threeDOnlyHint}
            />
          </>
        ) : null}
      </BlockStack>

      <BlockStack gap="300">
        <Text as="h4" variant="headingXs">
          Appearance
        </Text>
        {is3D ? (
          <TextField
            label="Exposure"
            type="number"
            step={0.1}
            value={String(settings.exposure)}
            onChange={(value) => update({ exposure: Number(value || 0) })}
            helpText={threeDOnlyHint}
            autoComplete="off"
          />
        ) : null}
        {/* Slice 7 PR #2: background color now lives here (was a floating
            preview-mode control). Pairs the TextField with a native swatch
            input so merchants can pick visually without leaving the form. */}
        <InlineStack gap="200" blockAlign="end" wrap={false}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <TextField
              label="Background color"
              value={settings.backgroundColor ?? ""}
              onChange={(value) => updateNullableString("backgroundColor", value)}
              placeholder="#0b1020"
              error={fieldErrors.backgroundColor}
              autoComplete="off"
            />
          </div>
          <input
            type="color"
            value={settings.backgroundColor && /^#[0-9a-f]{6}$/i.test(settings.backgroundColor)
              ? settings.backgroundColor
              : "#0b1020"}
            onChange={(e) => updateNullableString("backgroundColor", e.target.value)}
            aria-label="Background color swatch"
            style={{
              width: 36,
              height: 36,
              border: "1px solid var(--p-color-border)",
              borderRadius: "var(--p-border-radius-200)",
              padding: 2,
              cursor: "pointer",
              background: "transparent",
            }}
          />
        </InlineStack>
        <Select
          label="Hotspot style"
          options={HOTSPOT_STYLE_OPTIONS}
          value={settings.hotspotStyle}
          onChange={(value) => update({ hotspotStyle: value })}
        />
        <Checkbox
          label="Fullscreen button"
          checked={settings.showFullscreen}
          onChange={(checked) => update({ showFullscreen: checked })}
        />
        {is3D ? (
          <Checkbox
            label="AR button"
            checked={settings.showArButton}
            onChange={(checked) => update({ showArButton: checked })}
            helpText={threeDOnlyHint}
          />
        ) : null}
      </BlockStack>
    </BlockStack>
  );
}
