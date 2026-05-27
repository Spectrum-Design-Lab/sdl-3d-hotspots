/**
 * Storefront-style mock card for the hotspots modal's Preview sub-tab.
 *
 * Mirrors the LIGHT-themed storefront sidebar that merchants actually
 * ship on their PDPs (`.sdl3d-block--themed .sdl3d-sidebar` in
 * extensions/product-3d-viewer/assets/viewer.css). Values pulled
 * verbatim from the themed CSS variables so the preview matches the
 * storefront pixel-for-pixel (within reason):
 *
 *   --sdl3d-card-bg     #ffffff
 *   --sdl3d-card-border #e5e7eb
 *   --sdl3d-accent      #f59e0b   (top stripe — themed sidebar marker)
 *   --sdl3d-heading     #1e40af   (title + "PRODUCT FEATURES" label)
 *   --sdl3d-text        #1f2937   (body)
 *   --sdl3d-text-muted  #6b7280   (Clear selection link)
 *   --sdl3d-primary     #2563eb   (CTA bg)
 *
 * Order matches `mediaHtml()` in tae-src/product-3d-viewer/media.ts:
 *   header → title → body → image → video → CTA → Clear selection
 *
 * Inline styles so this stays decoupled from editor.css and from the
 * Polaris admin theme. Video placeholders show the URL + provider
 * classification rather than loading a live iframe — keeps the preview
 * fast and avoids autoplay surprises inside the modal.
 */
import { classifyVideoUrl } from "@spectrum-design-lab/shared/video-classify";

type Props = {
  title: string | null;
  body: string | null;
  mediaImageUrl?: string | null;
  mediaVideoUrl?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  color?: string | null;
};

const FALLBACK_TITLE = "Hotspot title";
const FALLBACK_BODY = "Hotspot body text appears here on the storefront when the customer selects this hotspot.";

const COLORS = {
  cardBg: "#ffffff",
  cardBorder: "#e5e7eb",
  accent: "#f59e0b",
  heading: "#1e40af",
  text: "#1f2937",
  textMuted: "#6b7280",
  primary: "#2563eb",
} as const;

export function Sdl3dHotspotStorefrontPreview({
  title,
  body,
  mediaImageUrl,
  mediaVideoUrl,
  ctaLabel,
  ctaUrl,
  color,
}: Props) {
  const ctaColor = color?.trim() || COLORS.primary;

  return (
    <div
      role="region"
      aria-label="Storefront preview"
      style={{
        // Mirrors `.sdl3d-block--themed .sdl3d-sidebar`:
        //   width 340, white bg, 1px border, 3px accent on top, radius 6.
        width: "100%",
        maxWidth: 360,
        background: COLORS.cardBg,
        color: COLORS.text,
        border: `1px solid ${COLORS.cardBorder}`,
        borderTop: `3px solid ${COLORS.accent}`,
        borderRadius: 6,
        boxShadow:
          "0 1px 2px rgba(15, 23, 42, .04), 0 1px 3px rgba(15, 23, 42, .06)",
        overflow: "hidden",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      }}
    >
      {/* Header bar — "PRODUCT FEATURES" in uppercase heading colour,
          mirrors `.sdl3d-block--themed .sdl3d-sidebar__header`. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px",
          borderBottom: `1px solid ${COLORS.cardBorder}`,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: COLORS.heading,
          }}
        >
          Product features
        </span>
        {/* Burger icon placeholder — non-interactive, just for visual fidelity. */}
        <span
          aria-hidden
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            border: `1px solid ${COLORS.cardBorder}`,
            background: "#f9fafb",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: COLORS.textMuted,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
            <rect x="2" y="4" width="16" height="2" rx="1" fill="currentColor" />
            <rect x="2" y="9" width="16" height="2" rx="1" fill="currentColor" />
            <rect x="2" y="14" width="16" height="2" rx="1" fill="currentColor" />
          </svg>
        </span>
      </div>

      {/* Detail body — title, body, media, CTA, clear. */}
      <div
        style={{
          padding: "18px 16px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            lineHeight: 1.35,
            color: COLORS.heading,
          }}
        >
          {title?.trim() || FALLBACK_TITLE}
        </div>

        <div
          style={{
            fontSize: 14,
            lineHeight: 1.6,
            color: COLORS.text,
            whiteSpace: "pre-wrap",
          }}
        >
          {body?.trim() || FALLBACK_BODY}
        </div>

        {mediaImageUrl?.trim() ? (
          <div
            style={{
              borderRadius: 8,
              overflow: "hidden",
              background: "#f9fafb",
              border: `1px solid ${COLORS.cardBorder}`,
            }}
          >
            <img
              src={mediaImageUrl}
              alt=""
              style={{
                display: "block",
                width: "100%",
                maxHeight: 220,
                objectFit: "cover",
              }}
            />
          </div>
        ) : null}

        {mediaVideoUrl?.trim() ? (
          <VideoPlaceholder url={mediaVideoUrl.trim()} />
        ) : null}

        {ctaLabel?.trim() && ctaUrl?.trim() ? (
          <a
            href={ctaUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              alignSelf: "flex-start",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "9px 16px",
              borderRadius: 6,
              background: ctaColor,
              color: "#ffffff",
              textDecoration: "none",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {ctaLabel}
          </a>
        ) : null}

        <span
          aria-hidden
          style={{
            marginTop: 4,
            fontSize: 12,
            color: COLORS.textMuted,
            textDecoration: "underline",
            textUnderlineOffset: 2,
            cursor: "default",
            alignSelf: "flex-start",
          }}
        >
          Clear selection
        </span>
      </div>
    </div>
  );
}

function VideoPlaceholder({ url }: { url: string }) {
  const kind = classifyVideoUrl(url);
  const label =
    kind === "youtube"
      ? "YouTube video"
      : kind === "vimeo"
        ? "Vimeo video"
        : kind === "file"
          ? "Video file"
          : "Unknown video URL";
  return (
    <div
      style={{
        width: "100%",
        aspectRatio: "16 / 9",
        borderRadius: 8,
        background: "#0f172a",
        color: "rgba(255, 255, 255, 0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 6,
        padding: 12,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
      <div
        style={{
          fontSize: 11,
          opacity: 0.75,
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {url}
      </div>
    </div>
  );
}
