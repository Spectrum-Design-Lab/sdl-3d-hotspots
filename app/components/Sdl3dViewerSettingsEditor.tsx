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

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: 8,
  marginTop: 4,
  boxSizing: "border-box",
  minWidth: 0,
};

const sectionStyle: React.CSSProperties = {
  paddingBottom: 12,
  borderBottom: "1px solid #e5e7eb",
  minWidth: 0,
};

function inputWithError(hasError: boolean): React.CSSProperties {
  return hasError
    ? {
        ...inputStyle,
        borderColor: "#dc2626",
        outlineColor: "#dc2626",
      }
    : inputStyle;
}

function errorText(message?: string) {
  if (!message) return null;

  return (
    <div
      style={{
        marginTop: 4,
        fontSize: 12,
        color: "#dc2626",
        lineHeight: 1.35,
      }}
    >
      {message}
    </div>
  );
}

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
      <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>Advanced settings</div>
        </div>

        <div style={sectionStyle}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Camera</div>

          <div style={{ display: "grid", gap: 8 }}>
            <div>
              <label>Orbit</label>
              <input
                type="text"
                value={settings.cameraOrbit ?? ""}
                onChange={(e) => updateNullableString("cameraOrbit", e.target.value)}
                placeholder="0deg 75deg 105%"
                style={inputWithError(Boolean(fieldErrors.cameraOrbit))}
              />
              {errorText(fieldErrors.cameraOrbit)}
            </div>

            <div>
              <label>Target</label>
              <input
                type="text"
                value={settings.cameraTarget ?? ""}
                onChange={(e) => updateNullableString("cameraTarget", e.target.value)}
                placeholder="0m 0m 0m"
                style={inputWithError(Boolean(fieldErrors.cameraTarget))}
              />
              {errorText(fieldErrors.cameraTarget)}
            </div>

            <div>
              <label>Field of view</label>
              <input
                type="text"
                value={settings.fieldOfView ?? ""}
                onChange={(e) => updateNullableString("fieldOfView", e.target.value)}
                placeholder="auto"
                style={inputStyle}
              />
            </div>

            <div>
              <label>Min orbit</label>
              <input
                type="text"
                value={settings.minCameraOrbit ?? ""}
                onChange={(e) => updateNullableString("minCameraOrbit", e.target.value)}
                placeholder="auto auto auto"
                style={inputWithError(Boolean(fieldErrors.minCameraOrbit))}
              />
              {errorText(fieldErrors.minCameraOrbit)}
            </div>

            <div>
              <label>Max orbit</label>
              <input
                type="text"
                value={settings.maxCameraOrbit ?? ""}
                onChange={(e) => updateNullableString("maxCameraOrbit", e.target.value)}
                placeholder="auto auto auto"
                style={inputWithError(Boolean(fieldErrors.maxCameraOrbit))}
              />
              {errorText(fieldErrors.maxCameraOrbit)}
            </div>

            <div>
              <label>Locked polar angle</label>
              <input
                type="text"
                value={settings.lockedPolarAngle ?? ""}
                onChange={(e) => updateNullableString("lockedPolarAngle", e.target.value)}
                placeholder="75deg"
                style={inputWithError(Boolean(fieldErrors.lockedPolarAngle))}
              />
              {errorText(fieldErrors.lockedPolarAngle)}
            </div>
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Advanced paths</div>

          <div style={{ display: "grid", gap: 8 }}>
            <div>
              <label>Environment image</label>
              <input
                type="text"
                value={settings.environmentImage ?? ""}
                onChange={(e) => updateNullableString("environmentImage", e.target.value)}
                placeholder="https://..."
                style={inputStyle}
              />
            </div>

            <div>
              <label>Skybox image</label>
              <input
                type="text"
                value={settings.skyboxImage ?? ""}
                onChange={(e) => updateNullableString("skyboxImage", e.target.value)}
                placeholder="https://..."
                style={inputStyle}
              />
            </div>

            <div>
              <label>Poster override</label>
              <input
                type="text"
                value={settings.poster ?? ""}
                onChange={(e) => updateNullableString("poster", e.target.value)}
                placeholder="https://..."
                style={inputStyle}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>Viewer settings</div>
      </div>

      <div style={sectionStyle}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Behavior</div>

        <div style={{ display: "grid", gap: 8 }}>
          <label>
            <input
              type="checkbox"
              checked={settings.autoRotate}
              onChange={(e) => update({ autoRotate: e.target.checked })}
            />{" "}
            Auto rotate
          </label>

          <label>
            <input
              type="checkbox"
              checked={settings.cameraControls}
              onChange={(e) => update({ cameraControls: e.target.checked })}
            />{" "}
            Camera controls
          </label>

          <div>
            <label>Prompt</label>
            <select
              value={settings.interactionPrompt ?? "auto"}
              onChange={(e) =>
                updateNullableString(
                  "interactionPrompt",
                  e.target.value === "auto" ? "auto" : e.target.value,
                )
              }
              style={inputStyle}
            >
              <option value="auto">auto</option>
              <option value="none">none</option>
            </select>
          </div>
        </div>
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Appearance</div>

        <div style={{ display: "grid", gap: 8 }}>
          <div>
            <label>Exposure</label>
            <input
              type="number"
              step="0.1"
              value={settings.exposure}
              onChange={(e) => update({ exposure: Number(e.target.value || 0) })}
              style={inputStyle}
            />
          </div>

          <div>
            <label>Background color</label>
            <input
              type="text"
              value={settings.backgroundColor ?? ""}
              onChange={(e) => updateNullableString("backgroundColor", e.target.value)}
              placeholder="#0b1020"
              style={inputWithError(Boolean(fieldErrors.backgroundColor))}
            />
            {errorText(fieldErrors.backgroundColor)}
          </div>

          <div>
            <label>Hotspot style</label>
            <select
              value={settings.hotspotStyle}
              onChange={(e) => update({ hotspotStyle: e.target.value })}
              style={inputStyle}
            >
              <option value="card">card</option>
              <option value="tooltip">tooltip</option>
              <option value="dot">dot</option>
              <option value="badge">badge</option>
              <option value="icon-only">icon-only</option>
              <option value="panel">panel</option>
            </select>
          </div>

          <label>
            <input
              type="checkbox"
              checked={settings.showFullscreen}
              onChange={(e) => update({ showFullscreen: e.target.checked })}
            />{" "}
            Fullscreen button
          </label>

          <label>
            <input
              type="checkbox"
              checked={settings.showArButton}
              onChange={(e) => update({ showArButton: e.target.checked })}
            />{" "}
            AR button
          </label>
        </div>
      </div>
    </div>
  );
}