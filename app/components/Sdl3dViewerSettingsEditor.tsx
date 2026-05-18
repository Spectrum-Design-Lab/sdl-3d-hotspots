/**
 * Viewer settings form — Polaris migration (Slice 5C PR #5i).
 *
 * Two views — basic (rendered inside the editor's "Viewer" inspector
 * panel) and advanced (rendered inside the "Publish" panel). Both edit
 * the same JSON blob; the parent route owns the JSON state and passes
 * it down stringified.
 *
 * Field shapes are unchanged from the pre-Polaris version:
 * - TextField for free-form strings (orbit/target/color/url paths) with
 *   `error` prop wired to `getViewerSettingsFieldErrors`.
 * - Select for enums (interactionPrompt, hotspotStyle).
 * - Checkbox for booleans.
 * - TextField type="number" for `exposure`.
 *
 * Camera orbit kept as a single TextField (not a RangeSlider per the
 * 5C plan) because the value is a 3-part string "0deg 75deg 105%",
 * which doesn't map to a single slider.
 */
import {
  BlockStack,
  Checkbox,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { defaultViewerSettings, type ViewerSettings } from "../lib/sdl3d-shared";
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
}: {
  valueJson: string;
  onChangeJson: (nextJson: string) => void;
  advanced?: boolean;
}) {
  const settings = parseViewerSettingsJson(valueJson);
  const fieldErrors = getViewerSettingsFieldErrors(valueJson);

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

        <BlockStack gap="300">
          <Text as="h4" variant="headingXs">
            Camera
          </Text>
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

        <BlockStack gap="300">
          <Text as="h4" variant="headingXs">
            Advanced paths
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
        />
      </BlockStack>

      <BlockStack gap="300">
        <Text as="h4" variant="headingXs">
          Appearance
        </Text>
        <TextField
          label="Exposure"
          type="number"
          step={0.1}
          value={String(settings.exposure)}
          onChange={(value) => update({ exposure: Number(value || 0) })}
          autoComplete="off"
        />
        <TextField
          label="Background color"
          value={settings.backgroundColor ?? ""}
          onChange={(value) => updateNullableString("backgroundColor", value)}
          placeholder="#0b1020"
          error={fieldErrors.backgroundColor}
          autoComplete="off"
        />
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
        <Checkbox
          label="AR button"
          checked={settings.showArButton}
          onChange={(checked) => update({ showArButton: checked })}
        />
      </BlockStack>
    </BlockStack>
  );
}
