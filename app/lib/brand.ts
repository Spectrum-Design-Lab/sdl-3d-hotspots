/**
 * Brand identity for the running deploy.
 *
 * The same codebase ships under multiple brands (SDL's own deploy, the
 * BFA pilot, future white-label installs). Every user-visible string
 * that mentions a brand reads from {@link BRAND}.
 *
 * Selected at build time via `VITE_APP_BRAND` (Vite inlines into both
 * server and client bundles). Docker builds set it via a build-arg:
 *
 *   docker compose build --build-arg APP_BRAND=bfa
 *
 * Unset / unknown values fall back to the SDL brand so local dev and
 * the canonical SDL deploy "just work" with no env var.
 *
 * Internal identifiers (metafield namespace `sdl_3d`, file names,
 * package name) stay as-is — they're invisible to merchants unless
 * they dig into Settings → Custom data, and renaming the namespace
 * would break already-published storefront configs.
 */

type BrandId = "sdl" | "bfa";

type Brand = {
  id: BrandId;
  /** Short vendor identifier used in copy ("Your bucket — never X's"). */
  vendorName: string;
  /** Full app name shown in page titles, modal headers, onboarding. */
  appName: string;
  /** Theme block name as referenced in admin onboarding copy. Must
   *  match the liquid schema's `name` field 1:1 so merchants find
   *  the same string in the Theme Customizer that we tell them to
   *  look for. The schema name is hardcoded brand-neutral (one
   *  string ships in the same TAE bundle for every brand) — see
   *  extensions/product-3d-viewer/blocks/product-3d-viewer.liquid. */
  themeBlockName: string;
};

const SHARED_BLOCK_NAME = "3D product viewer";

const BRANDS: Record<BrandId, Brand> = {
  sdl: {
    id: "sdl",
    vendorName: "SDL",
    appName: "SDL 3D Hotspots",
    themeBlockName: SHARED_BLOCK_NAME,
  },
  bfa: {
    id: "bfa",
    vendorName: "BFA",
    appName: "BFA 3D Hotspots",
    themeBlockName: SHARED_BLOCK_NAME,
  },
};

function resolveBrandId(): BrandId {
  // Vite replaces `import.meta.env.VITE_APP_BRAND` at build time. The
  // `import.meta.env` global is undefined when this module is consumed
  // outside a Vite build (e.g. node-only worker entry on first import
  // before bundling), so guard the lookup.
  const fromVite =
    typeof import.meta !== "undefined" && import.meta.env
      ? (import.meta.env.VITE_APP_BRAND as string | undefined)
      : undefined;
  const fromNode =
    typeof process !== "undefined" ? process.env?.APP_BRAND : undefined;
  const raw = (fromVite ?? fromNode ?? "sdl").toLowerCase();
  return raw === "bfa" ? "bfa" : "sdl";
}

export const BRAND: Brand = BRANDS[resolveBrandId()];
