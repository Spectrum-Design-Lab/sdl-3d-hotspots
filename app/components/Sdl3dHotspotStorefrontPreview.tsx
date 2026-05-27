/**
 * Storefront-style mock card for the hotspots modal's Preview sub-tab.
 *
 * Mirrors the storefront sidebar detail view (`.sdl3d-sidebar__detail`
 * in extensions/product-3d-viewer/assets/viewer.css):
 *   title → body → image → video → CTA
 *
 * Inline styles so this stays decoupled from editor.css and renders
 * faithfully regardless of light/dark theme — the storefront sidebar is
 * always dark, so the preview is too. Image / video markup mirrors the
 * `mediaHtml()` builder used by the storefront viewer (same image-then-
 * video order, same YouTube / Vimeo / file video handling). No live
 * iframe loads for the YouTube / Vimeo placeholders — the embed URL is
 * still attached so the merchant can click into it if they want to
 * verify.
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
const FALLBACK_BODY = "Hotspot body text appears here on the storefront sidebar when the customer selects this hotspot.";

export function Sdl3dHotspotStorefrontPreview({
  title,
  body,
  mediaImageUrl,
  mediaVideoUrl,
  ctaLabel,
  ctaUrl,
  color,
}: Props) {
  const ctaColor = color?.trim() || "#3b82f6";

  return (
    <div
      role="region"
      aria-label="Storefront preview"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: "24px 22px",
        background: "linear-gradient(180deg, #111827 0%, #0b1220 100%)",
        borderRadius: 12,
        color: "#f1f5f9",
        minHeight: 320,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "rgba(241, 245, 249, 0.5)",
        }}
      >
        Storefront preview
      </div>

      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          lineHeight: 1.3,
          color: "#f1f5f9",
        }}
      >
        {title?.trim() || FALLBACK_TITLE}
      </div>

      <div
        style={{
          fontSize: 14,
          lineHeight: 1.65,
          color: "rgba(226, 232, 240, 0.7)",
          whiteSpace: "pre-wrap",
        }}
      >
        {body?.trim() || FALLBACK_BODY}
      </div>

      {mediaImageUrl?.trim() ? (
        <div
          style={{
            borderRadius: 10,
            overflow: "hidden",
            background: "rgba(0, 0, 0, 0.18)",
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
            padding: "10px 20px",
            borderRadius: 10,
            background: ctaColor,
            color: "#ffffff",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.01em",
          }}
        >
          {ctaLabel}
        </a>
      ) : null}
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
        borderRadius: 10,
        background: "#000000",
        color: "rgba(255, 255, 255, 0.65)",
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
          opacity: 0.7,
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
