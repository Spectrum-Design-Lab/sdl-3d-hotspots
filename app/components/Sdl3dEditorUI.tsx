import type { ReactNode } from "react";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";
export type RightTab = "upload" | "viewer" | "hotspots" | "advanced";

export type ThemePalette = {
  page: string;
  pageAlt: string;
  panel: string;
  panelAlt: string;
  border: string;
  borderSoft: string;
  text: string;
  muted: string;
  primary: string;
  primaryText: string;
  primarySoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  input: string;
  inputAlt: string;
  shadow: string;
};

export const lightTheme: ThemePalette = {
  page: "#f4f7fb",
  pageAlt: "#eef2f7",
  panel: "#ffffff",
  panelAlt: "#f8fafc",
  border: "#dbe4ee",
  borderSoft: "#e5e7eb",
  text: "#0f172a",
  muted: "#64748b",
  primary: "#2952d1",
  primaryText: "#ffffff",
  primarySoft: "#eff6ff",
  success: "#166534",
  successSoft: "#ecfdf5",
  warning: "#92400e",
  warningSoft: "#fffbeb",
  danger: "#991b1b",
  dangerSoft: "#fef2f2",
  input: "#ffffff",
  inputAlt: "#f8fafc",
  shadow: "0 16px 40px rgba(15, 23, 42, 0.06)",
};

export const darkTheme: ThemePalette = {
  page: "#0b1220",
  pageAlt: "#111827",
  panel: "#111827",
  panelAlt: "#0f172a",
  border: "#334155",
  borderSoft: "#253041",
  text: "#e5e7eb",
  muted: "#94a3b8",
  primary: "#3b82f6",
  primaryText: "#ffffff",
  primarySoft: "#172554",
  success: "#22c55e",
  successSoft: "#052e1b",
  warning: "#f59e0b",
  warningSoft: "#3b1f06",
  danger: "#ef4444",
  dangerSoft: "#450a0a",
  input: "#0f172a",
  inputAlt: "#111827",
  shadow: "0 18px 48px rgba(0, 0, 0, 0.45)",
};

export function toneStyles(tone: Tone, theme: ThemePalette) {
  switch (tone) {
    case "success":
      return {
        background: theme.successSoft,
        color: theme.success,
        border: `1px solid ${theme.success}`,
      };
    case "warning":
      return {
        background: theme.warningSoft,
        color: theme.warning,
        border: `1px solid ${theme.warning}`,
      };
    case "danger":
      return {
        background: theme.dangerSoft,
        color: theme.danger,
        border: `1px solid ${theme.danger}`,
      };
    case "info":
      return {
        background: theme.primarySoft,
        color: theme.primary,
        border: `1px solid ${theme.primary}`,
      };
    default:
      return {
        background: theme.panelAlt,
        color: theme.muted,
        border: `1px solid ${theme.border}`,
      };
  }
}

export function Badge({
  children,
  tone = "neutral",
  theme,
}: {
  children: ReactNode;
  tone?: Tone;
  theme: ThemePalette;
}) {
  const styles = toneStyles(tone, theme);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        ...styles,
      }}
    >
      {children}
    </span>
  );
}

export function SectionCard({
  title,
  subtitle,
  right,
  children,
  theme,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  theme: ThemePalette;
}) {
  return (
    <section
      style={{
        background: theme.panel,
        border: `1px solid ${theme.borderSoft}`,
        borderRadius: 16,
        padding: 14,
        boxShadow: theme.shadow,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: theme.text }}>
            {title}
          </div>
          {subtitle ? (
            <div style={{ fontSize: 13, color: theme.muted, marginTop: 4 }}>
              {subtitle}
            </div>
          ) : null}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function ActionButton({
  children,
  tone = "neutral",
  disabled,
  form,
  theme,
}: {
  children: ReactNode;
  tone?: Tone;
  disabled?: boolean;
  form?: string;
  theme: ThemePalette;
}) {
  const palette =
    tone === "success"
      ? {
        background: theme.success,
        color: theme.primaryText,
        border: `1px solid ${theme.success}`,
      }
      : tone === "info"
        ? {
          background: theme.primary,
          color: theme.primaryText,
          border: `1px solid ${theme.primary}`,
        }
        : tone === "warning"
          ? {
            background: theme.warning,
            color: theme.primaryText,
            border: `1px solid ${theme.warning}`,
          }
          : {
            background: theme.panel,
            color: theme.text,
            border: `1px solid ${theme.border}`,
          };

  return (
    <button
      type="submit"
      form={form}
      disabled={disabled}
      style={{
        padding: "9px 14px",
        borderRadius: 12,
        fontWeight: 700,
        fontSize: 14,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        boxShadow: disabled ? "none" : theme.shadow,
        ...palette,
      }}
    >
      {children}
    </button>
  );
}

export function TabButton({
  active,
  onClick,
  children,
  theme,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  theme: ThemePalette;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "8px 12px",
        borderRadius: 12,
        border: active
          ? `1px solid ${theme.primary}`
          : `1px solid ${theme.border}`,
        background: active ? theme.primarySoft : theme.panel,
        color: active ? theme.primary : theme.text,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
