import { useBlocker, useFetcher, useLoaderData, useNavigate, useRevalidator, useRouteError, useSearchParams, isRouteErrorResponse } from "react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  Card,
  Checkbox,
  Collapsible,
  Icon,
  InlineStack,
  Modal,
  Select,
  Text,
  TextField,
  Tooltip,
} from "@shopify/polaris";
import { ChevronDownIcon, ChevronUpIcon } from "@shopify/polaris-icons";
import "../styles/editor.css";

import prisma from "../db.server";
import shopify from "../shopify.server";
import { adminGraphql, ensureShop } from "../lib/sdl3d-graphql.server";

import { defaultViewerSettings, safeJsonParse, isValidConfigExport, viewerTypeDbToWire, normalizeViewerTypeToDb, normalizeHotspotAnimation, type ViewerType, type ImageSequenceFrame, type Hotspot360, type ConfigExport } from "../lib/sdl3d-shared";
import { validateDraftForPublish } from "../lib/sdl3d-validation";
import {
  listShopifyFiles,
  resolveSelectedAssetUrls,
  resolveImageUrlsByGid,
} from "../lib/sdl3d-files.server";
import { resolveImageSequenceUrls } from "../lib/sdl3d-image-sequence.server";
import { hasSyncableSdl3dMetafields, pullMetafieldsToDraft } from "../lib/sdl3d-sync.server";
import { listStoragesForShop, type ShopStorageSummary } from "../lib/storage.server";
import { notify } from "../lib/notify.server";
import { BRAND } from "../lib/brand";

import {
  parseInitialHotspots,
  serializeHotspots,
  Sdl3dHotspotEditor,
  blankHotspot,
  makeId,
  normalizeSortOrder,
  type EditableHotspot,
} from "../components/Sdl3dHotspotEditor";
import { Sdl3dEditorPreview } from "../components/Sdl3dEditorPreview";
import { Sdl3dViewerSettingsEditor } from "../components/Sdl3dViewerSettingsEditor";
import {
  Sdl3dEditorSidebar,
  type Step,
  type StepId,
  type ValidationIssue,
} from "../components/Sdl3dEditorSidebar";
import { Sdl3dImageSequencePreview } from "../components/Sdl3dImageSequencePreview";
import {
  Sdl3dHotspot360Editor,
  parseInitialHotspots360,
  serializeHotspots360,
} from "../components/Sdl3dHotspot360Editor";
import { useUndoRedo } from "../components/useUndoRedo";
import { FileBrowserModal } from "../components/FileBrowserModal";
import { ProductBrowserModal } from "../components/ProductBrowserModal";
import { PresetBrowserModal, type PresetSummary } from "../components/PresetBrowserModal";
import {
  PresetApplyDedupModal,
  type PresetApplyCandidate,
} from "../components/PresetApplyDedupModal";
import { Sdl3dMediaSourceModal } from "../components/Sdl3dMediaSourceModal";
import { Sdl3dHotspotsModal } from "../components/Sdl3dHotspotsModal";
import type { Tone, RightTab } from "../components/Sdl3dEditorUI";


export async function loader({ request }: { request: Request }) {
  const { admin, session } = await shopify.authenticate.admin(request);
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const productGid = url.searchParams.get("product") || "";
  const flash = url.searchParams.get("flash") || "";

  const shop = await ensureShop(session.shop);

  type ProductResult = {
    id: string;
    title: string;
    handle: string | null;
    status: string | null;
    featuredMedia: { preview?: { image?: { url: string } } } | null;
  };

  // ── Phase 1: all independent queries in parallel ──
  const [
    searchResult,
    selectedProduct,
    initialConfig,
    modelFileResult,
    posterFileResult,
    availableStorages,
  ] = await Promise.all([
    // Search products (GraphQL)
    adminGraphql<{ products: { nodes: ProductResult[] } }>(
          admin,
          `query SearchProducts($query: String!) {
            products(first: 50, query: $query) {
              nodes { id title handle status }
            }
          }`,
          { query: q || "status:active" },
        ).then((d) => d.products.nodes),

    // Get selected product (GraphQL)
    productGid
      ? adminGraphql<{ product: ProductResult | null }>(
          admin,
          `query GetProduct($id: ID!) {
            product(id: $id) {
              id title handle status
              featuredMedia { preview { image { url } } }
            }
          }`,
          { id: productGid },
        ).then((d) => d.product)
      : Promise.resolve(null as ProductResult | null),

    // Product config (DB)
    productGid
      ? prisma.productConfig.findUnique({
          where: {
            shopId_shopifyProductGid: {
              shopId: shop.id,
              shopifyProductGid: productGid,
            },
          },
          include: {
            hotspots: { orderBy: { sortOrder: "asc" } },
            captures: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        })
      : Promise.resolve(null),

    // File lists (GraphQL)
    listShopifyFiles(admin, "MODEL3D"),
    listShopifyFiles(admin, "IMAGE"),

    // Storage rows (DB) — Slice 6 PR #3 top-bar selector
    listStoragesForShop(shop.id),
  ]);

  const products = searchResult;

  // If no local draft exists but the product already has SDL metafields
  // (e.g. written by the sdl-platform pipeline), auto-pull them so the editor
  // recognizes the CDN-hosted frames / model without a manual Pull click.
  let config = initialConfig;
  if (!config && productGid && selectedProduct) {
    try {
      const hasSync = await hasSyncableSdl3dMetafields({ admin, shopifyProductGid: productGid });
      if (hasSync) {
        await pullMetafieldsToDraft({
          admin,
          shopDomain: session.shop,
          shopifyProductGid: productGid,
        });
        config = await prisma.productConfig.findUnique({
          where: {
            shopId_shopifyProductGid: {
              shopId: shop.id,
              shopifyProductGid: productGid,
            },
          },
          include: {
            hotspots: { orderBy: { sortOrder: "asc" } },
            captures: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        });
      }
    } catch (err) {
      console.error("Auto-pull from metafields failed", err);
      void notify({
        title: `Auto-pull from metafields failed for ${session.shop}`,
        body: `${productGid}: ${String(err)}`,
        level: "error",
      });
    }
  }

  // Stale-PENDING reaper. signRawUpload mints a Capture row in PENDING
  // before the browser begins its PUT to the bucket; if the upload never
  // finishes (tab closed, network drop, CORS rejection pre-fix), the row
  // sits in PENDING/UPLOADING forever and the loader keeps surfacing it
  // as the "latest" capture. 1 hour is well past any plausible upload time
  // even for slow connections + huge captures; anything older is abandoned.
  const STALE_CAPTURE_MS = 60 * 60 * 1000;
  const latestCapture = config?.captures?.[0];
  if (
    latestCapture &&
    (latestCapture.status === "PENDING" || latestCapture.status === "UPLOADING") &&
    Date.now() - latestCapture.createdAt.getTime() > STALE_CAPTURE_MS
  ) {
    await prisma.capture.update({
      where: { id: latestCapture.id },
      data: {
        status: "FAILED",
        errorMessage:
          "Upload abandoned — no recordRawUpload within 1 hour of signRawUpload. Restart the upload.",
        completedAt: new Date(),
      },
    });
    // Reflect the new state in-memory so the rest of the loader sees the
    // fresh status without a second findUnique round-trip.
    latestCapture.status = "FAILED";
    latestCapture.errorMessage =
      "Upload abandoned — no recordRawUpload within 1 hour of signRawUpload. Restart the upload.";
  }

  // ── Phase 2: queries that depend on Phase 1 results ──
  const viewerType = (config?.viewerType || "MODEL_3D") as "MODEL_3D" | "IMAGE_360";

  // Slice 8 hotspots PR #4 + PR #5 — collect icon + mediaImage GIDs
  // from 3D rows + 360 JSON for batched resolution. Non-GID values
  // (preset names, URLs) pass through resolveImageUrlsByGid's prefix
  // filter and don't hit the Admin API. The map is keyed by GID
  // and reused for both icon and media image live previews.
  const iconGids: string[] = [];
  if (config) {
    for (const row of config.hotspots) {
      if (row.icon && row.icon.startsWith("gid://shopify/")) iconGids.push(row.icon);
      if (row.mediaImageUrl && row.mediaImageUrl.startsWith("gid://shopify/")) iconGids.push(row.mediaImageUrl);
    }
    if (config.hotspotsJson360) {
      try {
        const arr = JSON.parse(config.hotspotsJson360);
        if (Array.isArray(arr)) {
          for (const h of arr) {
            const icon = (h as { icon?: unknown }).icon;
            if (typeof icon === "string" && icon.startsWith("gid://shopify/")) {
              iconGids.push(icon);
            }
            const media = (h as { mediaImageUrl?: unknown }).mediaImageUrl;
            if (typeof media === "string" && media.startsWith("gid://shopify/")) {
              iconGids.push(media);
            }
          }
        }
      } catch { /* malformed JSON — ignore, schema parse will catch */ }
    }
  }

  const [resolvedAssets, imageSequenceFrames, iconResolvedUrls] = await Promise.all([
    // Resolve model/poster URLs (GraphQL — needs config)
    resolveSelectedAssetUrls({
      admin,
      modelFileGid: config?.modelFileShopifyGid,
      posterFileGid: config?.posterFileShopifyGid,
    }),

    // Resolve 360° sequence URLs (GraphQL — needs config)
    viewerType === "IMAGE_360" && config?.imageSequenceJson
      ? resolveImageSequenceUrls({ admin, imageSequenceJson: config.imageSequenceJson })
      : Promise.resolve([] as ImageSequenceFrame[]),

    // Resolve hotspot icon GIDs for live preview in the picker.
    iconGids.length ? resolveImageUrlsByGid(admin, iconGids) : Promise.resolve({} as Record<string, string>),
  ]);

  // ── Derived data (sync, no I/O) ──
  const viewerSettingsObject = config
    ? safeJsonParse(config.viewerSettingsJson, defaultViewerSettings)
    : defaultViewerSettings;

  const hotspotsArray = config
    ? config.hotspots.map((h) => ({
      id: h.id,
      sortOrder: h.sortOrder,
      visible: h.visible,
      title: h.title,
      body: h.body,
      icon: h.icon,
      style: h.style,
      color: h.color,
      animation: h.animation ?? "none",
      mediaImageUrl: h.mediaImageUrl,
      mediaVideoUrl: h.mediaVideoUrl,
      position: `${h.positionX}m ${h.positionY}m ${h.positionZ}m`,
      normal:
        h.normalX != null && h.normalY != null && h.normalZ != null
          ? `${h.normalX}m ${h.normalY}m ${h.normalZ}m`
          : null,
      focusTarget:
        h.focusTargetX != null &&
          h.focusTargetY != null &&
          h.focusTargetZ != null
          ? `${h.focusTargetX}m ${h.focusTargetY}m ${h.focusTargetZ}m`
          : null,
      focusOrbit: h.focusOrbit,
      ctaLabel: h.ctaLabel,
      ctaUrl: h.ctaUrl,
    }))
    : [];

  const productFeaturedImageUrl = selectedProduct?.featuredMedia?.preview?.image?.url ?? null;

  return {
    shop: session.shop,
    darkMode: shop.darkMode ?? false,
    shopLogoUrl: shop.logoUrl ?? null,
    shopDefaultBackgroundColor: shop.defaultViewerBackgroundColor ?? null,
    hotspotEditorMode: shop.hotspotEditorMode === "advanced" ? "advanced" : "simple",
    productFeaturedImageUrl,
    q,
    flash,
    productGid,
    products,
    selectedProduct,
    modelFiles: modelFileResult.files,
    posterFiles: posterFileResult.files,
    modelFilesHasMore: modelFileResult.hasNextPage,
    posterFilesHasMore: posterFileResult.hasNextPage,
    modelFilesCursor: modelFileResult.endCursor,
    posterFilesCursor: posterFileResult.endCursor,
    resolvedAssets,
    imageSequenceFrames,
    iconResolvedUrls,
    config: config
      ? {
        id: config.id,
        enabled: config.enabled,
        sourceMode: config.sourceMode,
        viewerType: config.viewerType || "MODEL_3D",
        status: config.status,
        modelFileShopifyGid: config.modelFileShopifyGid || "",
        posterFileShopifyGid: config.posterFileShopifyGid || "",
        viewerSettingsJson: JSON.stringify(viewerSettingsObject, null, 2),
        hotspotsJson: JSON.stringify(hotspotsArray, null, 2),
        hotspotsJson360: config.hotspotsJson360 || "[]",
        frameCount: config.frameCount || 0,
        imageSequencePrefix: config.imageSequencePrefix || "",
      }
      : {
        id: "",
        enabled: false,
        sourceMode: "APP",
        viewerType: "MODEL_3D" as const,
        status: "DRAFT",
        modelFileShopifyGid: "",
        posterFileShopifyGid: "",
        viewerSettingsJson: JSON.stringify(defaultViewerSettings, null, 2),
        hotspotsJson: "[]",
        hotspotsJson360: "[]",
        frameCount: 0,
        imageSequencePrefix: "",
      },
    // Only hydrate the uploader with in-progress captures (QUEUED /
    // PROCESSING) so the merchant lands on an idle upload UI on remount
    // instead of seeing a stale FAILED banner from a previous session.
    // Terminal states (COMPLETED / FAILED / CANCELLED) surface on the
    // dashboard's Failed captures section — moved there 2026-05-27 from
    // Settings so errors live in one place.
    latestCapture: config?.captures?.[0] &&
      (config.captures[0].status === "QUEUED" ||
        config.captures[0].status === "PROCESSING")
      ? {
        id: config.captures[0].id,
        status: config.captures[0].status as
          | "PENDING" | "UPLOADING" | "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED",
        errorMessage: config.captures[0].errorMessage,
        frameCountActual: config.captures[0].frameCountActual,
        frameCountTarget: config.captures[0].frameCountTarget,
        validationJson: config.captures[0].validationJson,
      }
      : null,
    availableStorages: availableStorages as ShopStorageSummary[],
  };
}

// Action removed — all mutations go through API routes:
//   /api/sdl3d/config  (saveDraft, publish, pull, copyConfig, setViewerType)
//   /api/sdl3d/files   (upload, select, search, loadMore)
//   /api/sdl3d/presets  (saveAsPreset)

export default function Sdl3dEditorRoute() {
  const loaderData = useLoaderData<typeof loader>();

  const revalidator = useRevalidator();
  const [rightTab, setRightTab] = useState<RightTab>("upload");
  // Slice 7 PR #2: Edit/Preview tabs removed — canvas is always editable.
  // Background colour control moved into the Viewer inspector tab where it
  // belongs and now persists via viewerSettings.backgroundColor (which both
  // preview components already read).
  const [toastMessage, setToastMessage] = useState(loaderData.flash || "");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saveStatusNow, setSaveStatusNow] = useState(Date.now());

  // Slice 6 PR #3: top-bar storage selector. Initialized to the shop's default
  // row; subsequent captures + folder-picker calls use whichever row is
  // currently selected. Override is editor-state only — never persisted.
  const defaultStorageId = useMemo(
    () =>
      loaderData.availableStorages.find((s) => s.isDefault)?.id ??
      loaderData.availableStorages[0]?.id ??
      "",
    [loaderData.availableStorages],
  );
  const [selectedStorageId, setSelectedStorageId] = useState(defaultStorageId);
  const storageOverrideActive =
    !!selectedStorageId && selectedStorageId !== defaultStorageId;
  const activeStorageRow = useMemo(
    () => loaderData.availableStorages.find((s) => s.id === selectedStorageId) ?? null,
    [loaderData.availableStorages, selectedStorageId],
  );

  const saveFetcher = useFetcher<{
    ok?: boolean;
    autoSaved?: boolean;
    message?: string;
  }>();
  const actionFetcher = useFetcher<{
    ok?: boolean;
    message?: string;
    reload?: boolean;
  }>();
  // Slice 8 hotspots PR #2 — per-shop Simple/Advanced editor mode.
  // Local state shadows loaderData so the toggle flips optimistically;
  // the API call is fire-and-forget (no loader revalidation needed —
  // editorMode is a pure UI gate, no derived loader data depends on it).
  const editorModeFetcher = useFetcher<{
    ok?: boolean;
    hotspotEditorMode?: "simple" | "advanced";
  }>();
  // Shop.hotspotEditorMode is a free-form String in Prisma; narrow at the
  // boundary so the local state stays strictly typed. Anything that isn't
  // explicitly "advanced" falls back to "simple" (matches the column's
  // @default).
  const [editorMode, setEditorModeLocal] = useState<"simple" | "advanced">(
    loaderData.hotspotEditorMode === "advanced" ? "advanced" : "simple",
  );
  function setEditorMode(next: "simple" | "advanced") {
    if (next === editorMode) return;
    setEditorModeLocal(next);
    const fd = new FormData();
    fd.set("intent", "setHotspotEditorMode");
    fd.set("mode", next);
    editorModeFetcher.submit(fd, { method: "post", action: "/api/sdl3d/settings" });
  }
  // Slice 8 PR #2 — "Delete this config" reuses the dashboard's
  // intent=deleteConfig (clears the DB row + cascaded hotspots/captures;
  // metafields are intentionally left intact so the merchant can recover
  // a published config by pulling from metafield).
  const navigate = useNavigate();
  const deleteConfigFetcher = useFetcher<{
    ok?: boolean;
    message?: string;
    productGid?: string;
    wasPublished?: boolean;
  }>();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const initialHotspots = parseInitialHotspots(
    loaderData.config.hotspotsJson || "[]",
  );

  const [viewerSettingsJson, setViewerSettingsJson] = useState(
    loaderData.config.viewerSettingsJson ||
    JSON.stringify(defaultViewerSettings, null, 2),
  );
  const {
    value: hotspots, setValue: setHotspots,
    undo: undoHotspots, redo: redoHotspots,
    canUndo: canUndoHotspots, canRedo: canRedoHotspots,
    resetHistory: resetHotspotsHistory,
  } = useUndoRedo<EditableHotspot[]>(initialHotspots);
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(
    initialHotspots[0]?.id ?? null,
  );
  const [enabled, setEnabled] = useState(loaderData.config.enabled);
  const sourceMode = "APP";
  const [viewerType, setViewerType] = useState<ViewerType>(
    (loaderData.config.viewerType as ViewerType) || "MODEL_3D",
  );
  const initialHotspots360 = parseInitialHotspots360(loaderData.config.hotspotsJson360 || "[]");
  const {
    value: hotspots360, setValue: setHotspots360,
    undo: undoHotspots360, redo: redoHotspots360,
    canUndo: canUndoHotspots360, canRedo: canRedoHotspots360,
    resetHistory: resetHotspots360History,
  } = useUndoRedo<Hotspot360[]>(initialHotspots360);
  const [currentFrame360] = useState(0);

  // File/product browser modal state
  const [showProductBrowser, setShowProductBrowser] = useState(false);
  const [showModelBrowser, setShowModelBrowser] = useState(false);
  const [showPosterBrowser, setShowPosterBrowser] = useState(false);
  const [showSequenceBrowser, setShowSequenceBrowser] = useState(false);
  // Slice 8 hotspots PR #4 — Shopify Files picker for hotspot icons.
  // FileBrowserModal opens in poster (image-single-select) mode; the
  // selected GID is written to the icon field of the hotspot whose
  // picker fired the request, tracked by id so concurrent rows don't
  // collide.
  const [showIconBrowser, setShowIconBrowser] = useState(false);
  const [iconBrowserHotspotId, setIconBrowserHotspotId] = useState<string | null>(null);
  // Optimistic gid → previewUrl map. Populated on icon pick so the
  // preview renders immediately without waiting for a loader revalidate;
  // merges over loaderData.iconResolvedUrls so a later loader run that
  // includes the same gid takes precedence (returns the canonical URL).
  const [optimisticIconUrls, setOptimisticIconUrls] = useState<Record<string, string>>({});
  // Slice 8 hotspots PR #5 — same FileBrowserModal reuse for the
  // mediaImageUrl slot. Separate state so concurrent picker invocations
  // (icon vs media) don't collide.
  const [showMediaImageBrowser, setShowMediaImageBrowser] = useState(false);
  const [mediaImageBrowserHotspotId, setMediaImageBrowserHotspotId] = useState<string | null>(null);
  // Slice 7 PR #3b — unified 360° source Modal. The FileTriggerCard opens
  // this; the legacy `showSequenceBrowser` (FileBrowserModal mode=sequence)
  // is now only triggered from inside this Modal's "Browse Shopify Files"
  // tab via the onOpenShopifyFilesBrowser callback.
  const [showMediaSourceModal, setShowMediaSourceModal] = useState(false);
  // Slice 9 hotspot UX rework — full-screen hotspots editor modal. Opens
  // from the new "Edit hotspots (N)" button below the canvas + from any
  // dot click on the preview. Replaces the right-column accordion section
  // that previously stacked all 15+ per-hotspot fields vertically.
  const [showHotspotsModal, setShowHotspotsModal] = useState(false);

  // Slice 9 PR #2 — deep-link entry from the onboarding wizard.
  //
  // The wizard's "Open editor to upload" CTA lands here with
  // `?openMediaUpload=1`. Two cases to handle:
  //   (a) merchant already had a product selected (rare on first visit, but
  //       possible if they bounced back to the wizard) → open the media
  //       modal directly.
  //   (b) no product selected (the normal first-run case) → open the
  //       product browser, then re-open the media modal *after* the product
  //       picker triggers a fresh navigation. ProductBrowserModal's
  //       `handleSelectProduct` rebuilds the URL from scratch and drops
  //       `openMediaUpload`, so the intent has to survive in
  //       sessionStorage (per-tab, fine for our one-merchant scenario)
  //       rather than the URL.
  const SESSION_KEY = "sdl3d:openMediaUploadPending";
  const [searchParams, setSearchParams] = useSearchParams();
  const autoOpenedMediaUploadRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (autoOpenedMediaUploadRef.current) return;

    const fromUrl = searchParams.get("openMediaUpload") === "1";
    if (fromUrl) {
      window.sessionStorage.setItem(SESSION_KEY, "1");
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("openMediaUpload");
          return next;
        },
        { replace: true },
      );
    }

    const pending = window.sessionStorage.getItem(SESSION_KEY) === "1";
    if (!pending) return;

    if (!loaderData.selectedProduct) {
      // Open the picker — once the merchant picks, the page navigates and
      // we re-enter this effect with a selected product.
      setShowProductBrowser(true);
      return;
    }

    autoOpenedMediaUploadRef.current = true;
    window.sessionStorage.removeItem(SESSION_KEY);
    setShowMediaSourceModal(true);
  }, [searchParams, setSearchParams, loaderData.selectedProduct]);
  const [showPresetBrowser, setShowPresetBrowser] = useState(false);
  const [showPresetSaveDialog, setShowPresetSaveDialog] = useState(false);
  const [presetSaveHotspots3d, setPresetSaveHotspots3d] = useState<EditableHotspot[]>([]);
  const [presetSaveHotspots360, setPresetSaveHotspots360] = useState<Hotspot360[]>([]);
  const [presetSaveName, setPresetSaveName] = useState("");
  // Slice 8 — per-hotspot dedup picker that opens after the merchant
  // chooses preset(s) in PresetBrowserModal. Held as two separate states
  // so 3D and 360 modes keep distinct payload shapes through to merge.
  const [dedup3dCandidates, setDedup3dCandidates] = useState<PresetApplyCandidate<EditableHotspot>[] | null>(null);
  const [dedup360Candidates, setDedup360Candidates] = useState<PresetApplyCandidate<Hotspot360>[] | null>(null);
  const [dedupSourceCount, setDedupSourceCount] = useState(0);

  useEffect(() => {
    setToastMessage(loaderData.flash || "");

    if (loaderData.flash === "Draft saved.") {
      setLastSavedAt(Date.now());
    }
  }, [loaderData.flash]);

  useEffect(() => {
    if (!toastMessage) return;

    const timeout = window.setTimeout(() => {
      setToastMessage("");
    }, 3200);

    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  useEffect(() => {
    const vsJson =
      loaderData.config.viewerSettingsJson ||
      JSON.stringify(defaultViewerSettings, null, 2);

    setViewerSettingsJson(vsJson);

    const parsed = parseInitialHotspots(loaderData.config.hotspotsJson || "[]");
    resetHotspotsHistory(parsed);
    setSelectedHotspotId(parsed[0]?.id ?? null);
    setEnabled(loaderData.config.enabled);
    const vt = (loaderData.config.viewerType as ViewerType) || "MODEL_3D";
    setViewerType(vt);
    const parsed360 = parseInitialHotspots360(loaderData.config.hotspotsJson360 || "[]");
    resetHotspots360History(parsed360);

    const loaderSnapshot = JSON.stringify({
      enabled: loaderData.config.enabled,
      viewerSettingsJson: vsJson,
      hotspotsJson: serializeHotspots(parsed),
      viewerType: vt,
      hotspotsJson360: serializeHotspots360(parsed360),
    });
    setSavedDraftSnapshot(loaderSnapshot);
  }, [
    loaderData.config.viewerSettingsJson,
    loaderData.config.hotspotsJson,
    loaderData.config.hotspotsJson360,
    loaderData.config.id,
    loaderData.config.enabled,
    loaderData.config.viewerType,
  ]);

  const hotspotsJson = useMemo(() => serializeHotspots(hotspots), [hotspots]);
  const hotspotsJson360Memo = useMemo(() => serializeHotspots360(hotspots360), [hotspots360]);

  const initialDraftSnapshot = useMemo(
    () =>
      JSON.stringify({
        enabled: loaderData.config.enabled,
        viewerSettingsJson: loaderData.config.viewerSettingsJson,
        hotspotsJson: loaderData.config.hotspotsJson,
        viewerType: loaderData.config.viewerType,
        hotspotsJson360: loaderData.config.hotspotsJson360,
      }),
    [
      loaderData.config.enabled,
      loaderData.config.viewerSettingsJson,
      loaderData.config.hotspotsJson,
      loaderData.config.viewerType,
      loaderData.config.hotspotsJson360,
      loaderData.config.id,
    ],
  );

  const [savedDraftSnapshot, setSavedDraftSnapshot] = useState(initialDraftSnapshot);

  const currentDraftSnapshot = useMemo(
    () =>
      JSON.stringify({
        enabled,
        viewerSettingsJson,
        hotspotsJson,
        viewerType,
        hotspotsJson360: hotspotsJson360Memo,
      }),
    [enabled, viewerSettingsJson, hotspotsJson, viewerType, hotspotsJson360Memo],
  );

  const isDirty = savedDraftSnapshot !== currentDraftSnapshot;

  const blocker = useBlocker(isDirty);

  useEffect(() => {
    if (blocker.state === "blocked") {
      const shouldLeave = window.confirm(
        "You have unsaved changes. Leave without saving?",
      );

      if (shouldLeave) {
        blocker.proceed();
      } else {
        blocker.reset();
      }
    }
  }, [blocker]);

  const validation = useMemo(
    () =>
      validateDraftForPublish({
        viewerSettingsJson,
        hotspots,
        hasModel: Boolean(loaderData.config.modelFileShopifyGid),
        viewerType,
        frameCount: loaderData.config.frameCount,
      }),
    [viewerSettingsJson, hotspots, loaderData.config.modelFileShopifyGid, viewerType, loaderData.config.frameCount],
  );

  const publishDisabled =
    !loaderData.config.id || validation.errors.length > 0 || isDirty;

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const lastHandledSaveRef = useRef<unknown>(null);
  useEffect(() => {
    if (saveFetcher.state !== "idle") return;
    if (!saveFetcher.data) return;
    if (saveFetcher.data === lastHandledSaveRef.current) return;
    lastHandledSaveRef.current = saveFetcher.data;

    if (saveFetcher.data.ok) {
      setSavedDraftSnapshot(currentDraftSnapshot);
      setLastSavedAt(Date.now());
    }
    if (saveFetcher.data.message) {
      setToastMessage(saveFetcher.data.message);
    }
  }, [saveFetcher.state, saveFetcher.data, currentDraftSnapshot]);

  useEffect(() => {
    if (!lastSavedAt || isDirty) return;

    const interval = window.setInterval(() => {
      setSaveStatusNow(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, [lastSavedAt, isDirty]);

  // Handle actionFetcher (publish/pull) responses.
  // Guard with a ref: useRevalidator() returns a new object identity on every
  // idle→loading→idle cycle, so without this the effect would re-fire after
  // its own revalidate() call and infinite-loop the toast + revalidate.
  const handledActionDataRef = useRef<unknown>(null);
  useEffect(() => {
    if (actionFetcher.state !== "idle" || !actionFetcher.data) return;
    if (handledActionDataRef.current === actionFetcher.data) return;
    handledActionDataRef.current = actionFetcher.data;
    if (actionFetcher.data.message) {
      setToastMessage(actionFetcher.data.message);
    }
    if (actionFetcher.data.reload) {
      revalidator.revalidate();
    }
  }, [actionFetcher.state, actionFetcher.data, revalidator]);

  // Delete-config response — on success, navigate back to the dashboard
  // since the editor's loaded state no longer matches the DB. Same
  // ref-guard pattern as the actionFetcher effect (feedback_react_router_revalidator).
  const handledDeleteDataRef = useRef<unknown>(null);
  useEffect(() => {
    if (deleteConfigFetcher.state !== "idle" || !deleteConfigFetcher.data) return;
    if (handledDeleteDataRef.current === deleteConfigFetcher.data) return;
    handledDeleteDataRef.current = deleteConfigFetcher.data;
    const res = deleteConfigFetcher.data;
    if (res.ok) {
      // Dashboard doesn't support a flash URL param, so just navigate
      // — the deleted product disappearing from the list is the
      // visual confirmation. Surfacing a toast would need a session
      // mechanism that's out of scope for this PR.
      navigate("/app");
    } else {
      setToastMessage(res.message ?? "Delete failed.");
      setShowDeleteConfirm(false);
    }
  }, [deleteConfigFetcher.state, deleteConfigFetcher.data, loaderData.selectedProduct, navigate]);

  const submitPublish = useCallback(() => {
    if (!loaderData.selectedProduct || !loaderData.config.id) return;
    const fd = new FormData();
    fd.set("intent", "publish");
    fd.set("fetcherMode", "1");
    fd.set("productGid", loaderData.productGid);
    fd.set("productConfigId", loaderData.config.id);
    fd.set("q", loaderData.q);
    actionFetcher.submit(fd, { method: "post", action: "/api/sdl3d/config" });
  }, [loaderData, actionFetcher]);

  const isActionBusy = actionFetcher.state !== "idle";

  // ── Modal callbacks ──
  const handleModelSelect = useCallback((gids: string[]) => {
    if (!loaderData.selectedProduct) return;
    const fd = new FormData();
    fd.set("intent", "selectModelFile");
    fd.set("fetcherMode", "1");
    fd.set("productGid", loaderData.selectedProduct.id);
    fd.set("q", loaderData.q);
    fd.set("selectedModelFileGid", gids[0] || "");
    actionFetcher.submit(fd, { method: "post", action: "/api/sdl3d/files" });
  }, [loaderData, actionFetcher]);

  const handlePosterSelect = useCallback((gids: string[]) => {
    if (!loaderData.selectedProduct) return;
    const fd = new FormData();
    fd.set("intent", "selectPosterFile");
    fd.set("fetcherMode", "1");
    fd.set("productGid", loaderData.selectedProduct.id);
    fd.set("q", loaderData.q);
    fd.set("selectedPosterFileGid", gids[0] || "");
    actionFetcher.submit(fd, { method: "post", action: "/api/sdl3d/files" });
  }, [loaderData, actionFetcher]);

  const handleSequenceSelect = useCallback((gids: string[]) => {
    if (!loaderData.selectedProduct || !gids.length) return;
    const fd = new FormData();
    fd.set("intent", "selectImageSequence");
    fd.set("fetcherMode", "1");
    fd.set("productGid", loaderData.selectedProduct.id);
    fd.set("q", loaderData.q);
    fd.set("selectedGids", JSON.stringify(gids));
    fd.set("prefix", "");
    actionFetcher.submit(fd, { method: "post", action: "/api/sdl3d/files" });
  }, [loaderData, actionFetcher]);

  const handleModelUpload = useCallback((files: FileList) => {
    if (!loaderData.selectedProduct) return;
    const fd = new FormData();
    fd.set("intent", "uploadModelFile");
    fd.set("fetcherMode", "1");
    fd.set("productGid", loaderData.selectedProduct.id);
    fd.set("q", loaderData.q);
    fd.append("modelUpload", files[0]);
    actionFetcher.submit(fd, { method: "post", encType: "multipart/form-data", action: "/api/sdl3d/files" });
  }, [loaderData, actionFetcher]);

  const handlePosterUpload = useCallback((files: FileList) => {
    if (!loaderData.selectedProduct) return;
    const fd = new FormData();
    fd.set("intent", "uploadPosterFile");
    fd.set("fetcherMode", "1");
    fd.set("productGid", loaderData.selectedProduct.id);
    fd.set("q", loaderData.q);
    fd.append("posterUpload", files[0]);
    actionFetcher.submit(fd, { method: "post", encType: "multipart/form-data", action: "/api/sdl3d/files" });
  }, [loaderData, actionFetcher]);

  const handleSequenceUpload = useCallback((files: FileList) => {
    if (!loaderData.selectedProduct) return;
    const fd = new FormData();
    fd.set("intent", "uploadImageSequence");
    fd.set("fetcherMode", "1");
    fd.set("productGid", loaderData.selectedProduct.id);
    fd.set("q", loaderData.q);
    for (let i = 0; i < files.length; i++) {
      fd.append("imageSequenceUpload", files[i]);
    }
    actionFetcher.submit(fd, { method: "post", encType: "multipart/form-data", action: "/api/sdl3d/files" });
  }, [loaderData, actionFetcher]);

  // File lists from loader (modals handle their own pagination)
  const allModelFiles = loaderData.modelFiles;
  const allPosterFiles = loaderData.posterFiles;
  const modelHasMore = loaderData.modelFilesHasMore;
  const modelCursor = loaderData.modelFilesCursor;
  const posterHasMore = loaderData.posterFilesHasMore;
  const posterCursor = loaderData.posterFilesCursor;

  // 360° zip upload state
  const [zipProcessing, setZipProcessing] = useState(false);

  function extractFrameIndex(filename: string): number {
    const match = filename.match(/(\d+)\.[^.]+$/);
    return match ? parseInt(match[1], 10) : 0;
  }

  async function handleZipUploadFile(file: File) {
    if (!loaderData.selectedProduct) return;

    setZipProcessing(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(file);

      const IMAGE_EXTS = /\.(jpe?g|png|webp|avif|gif|bmp|tiff?)$/i;
      const imageEntries: Array<{ name: string; entry: any }> = [];

      zip.forEach((relativePath, entry) => {
        if (entry.dir) return;
        // Skip macOS resource fork files
        if (relativePath.startsWith("__MACOSX/") || relativePath.startsWith(".")) return;
        const filename = relativePath.split("/").pop() || "";
        if (IMAGE_EXTS.test(filename)) {
          imageEntries.push({ name: filename, entry });
        }
      });

      if (!imageEntries.length) {
        setZipProcessing(false);
        alert("No image files found in the zip archive.");
        return;
      }

      // Sort by frame index for consistent ordering
      imageEntries.sort((a, b) => {
        const aIdx = extractFrameIndex(a.name);
        const bIdx = extractFrameIndex(b.name);
        return aIdx - bIdx;
      });

      // Extract all images to File objects
      const fd = new FormData();
      fd.set("intent", "uploadImageSequence");
      fd.set("fetcherMode", "1");
      fd.set("productGid", loaderData.selectedProduct.id);
      fd.set("q", loaderData.q);
      fd.set("zipFolderName", file.name.replace(/\.zip$/i, ""));

      for (const { name, entry } of imageEntries) {
        const blob = await entry.async("blob");
        const ext = name.match(/\.[^.]+$/)?.[0]?.toLowerCase() || ".jpg";
        const mimeMap: Record<string, string> = {
          ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
          ".png": "image/png", ".webp": "image/webp",
          ".avif": "image/avif", ".gif": "image/gif",
          ".bmp": "image/bmp", ".tif": "image/tiff", ".tiff": "image/tiff",
        };
        const imageFile = new File([blob], name, { type: mimeMap[ext] || "image/jpeg" });
        fd.append("imageSequenceUpload", imageFile);
      }

      actionFetcher.submit(fd, { method: "post", encType: "multipart/form-data", action: "/api/sdl3d/files" });
    } catch (err) {
      console.error("Zip extraction failed:", err);
      alert("Failed to extract zip file. Make sure it's a valid zip archive.");
    } finally {
      setZipProcessing(false);
    }
  }

  const selectedModelFile =
    allModelFiles.find(
      (file) => file.id === loaderData.config.modelFileShopifyGid,
    ) ?? null;

  const selectedPosterFile =
    allPosterFiles.find(
      (file) => file.id === loaderData.config.posterFileShopifyGid,
    ) ?? null;

  const readyTone: Tone = validation.isPublishReady ? "success" : "danger";
  const toastTone: Tone =
    toastMessage &&
      (toastMessage.toLowerCase().includes("saved") ||
        toastMessage.toLowerCase().includes("published") ||
        toastMessage.toLowerCase().includes("pulled") ||
        toastMessage.toLowerCase().includes("uploaded"))
      ? "success"
      : "danger";

  function formatSavedAgo(timestamp: number, now: number) {
    const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));

    if (seconds < 5) return "Saved just now";
    if (seconds < 60) return `Saved ${seconds}s ago`;

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `Saved ${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    return `Saved ${hours}h ago`;
  }

  // Unified undo/redo that picks the right stack based on viewer type
  const canUndo = viewerType === "IMAGE_360" ? canUndoHotspots360 : canUndoHotspots;
  const canRedo = viewerType === "IMAGE_360" ? canRedoHotspots360 : canRedoHotspots;

  const handleUndo = useCallback(() => {
    if (viewerType === "IMAGE_360") {
      if (undoHotspots360()) setToastMessage("Undo");
    } else {
      if (undoHotspots()) setToastMessage("Undo");
    }
  }, [viewerType, undoHotspots, undoHotspots360]);

  const handleRedo = useCallback(() => {
    if (viewerType === "IMAGE_360") {
      if (redoHotspots360()) setToastMessage("Redo");
    } else {
      if (redoHotspots()) setToastMessage("Redo");
    }
  }, [viewerType, redoHotspots, redoHotspots360]);

  const forceSave = useCallback(() => {
    const selectedProductId = loaderData.selectedProduct?.id;
    if (!selectedProductId || !isDirty) return;
    if (saveFetcher.state !== "idle") return;

    const formData = new FormData();
    formData.set("intent", "saveDraft");
    formData.set("productGid", selectedProductId);
    formData.set("productConfigId", loaderData.config.id);
    formData.set("q", loaderData.q);
    formData.set("hotspotsJson", hotspotsJson);
    formData.set("viewerSettingsJson", viewerSettingsJson);
    formData.set("modelFileShopifyGid", loaderData.config.modelFileShopifyGid);
    formData.set("posterFileShopifyGid", loaderData.config.posterFileShopifyGid);
    formData.set("sourceMode", sourceMode);
    formData.set("viewerType", viewerType);
    formData.set("hotspotsJson360", hotspotsJson360Memo);
    if (enabled) formData.set("enabled", "on");

    saveFetcher.submit(formData, { method: "post", action: "/api/sdl3d/config" });
    setToastMessage("Saving…");
  }, [loaderData.selectedProduct, loaderData.config, loaderData.q, isDirty, saveFetcher, hotspotsJson, viewerSettingsJson, sourceMode, viewerType, hotspotsJson360Memo, enabled]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const isTyping = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      const mod = e.ctrlKey || e.metaKey;

      // Ctrl+S — force save (works even in inputs)
      if (mod && e.key === "s") {
        e.preventDefault();
        forceSave();
        return;
      }

      // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — undo/redo (works even in inputs for hotspot state)
      if (mod && e.key === "z") {
        // Only intercept if not typing, so browser undo works in text fields
        if (!isTyping) {
          e.preventDefault();
          if (e.shiftKey) handleRedo();
          else handleUndo();
        }
        return;
      }
      if (mod && e.key === "y") {
        if (!isTyping) {
          e.preventDefault();
          handleRedo();
        }
        return;
      }

      // All remaining shortcuts skip when typing in inputs
      if (isTyping) return;
      if (!loaderData.selectedProduct) return;

      // Escape — deselect hotspot
      if (e.key === "Escape") {
        setSelectedHotspotId(null);
        return;
      }

      // H — add hotspot
      if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        if (viewerType === "IMAGE_360") {
          const idx = hotspots360.length + 1;
          const hs: Hotspot360 = {
            id: `hs360_${Date.now()}_${idx}`,
            sortOrder: idx,
            visible: true,
            title: `Hotspot ${idx}`,
            body: "",
            style: "card",
            color: null,
            visibleFrameStart: 0,
            visibleFrameEnd: Math.max(0, loaderData.config.frameCount - 1),
            keyframes: [],
            ctaLabel: null,
            ctaUrl: null,
          };
          setHotspots360([...hotspots360, hs]);
          setSelectedHotspotId(hs.id);
        } else {
          const hs = blankHotspot(hotspots.length);
          setHotspots([...hotspots, hs]);
          setSelectedHotspotId(hs.id);
        }
        // Slice 9 — open the hotspots modal so the merchant sees the new
        // hotspot's editor immediately; previously the right-column tab
        // switched to "hotspots".
        setShowHotspotsModal(true);
        setToastMessage("Hotspot added");
        return;
      }

      // Delete / Backspace — delete selected hotspot
      if (e.key === "Delete" || e.key === "Backspace") {
        if (!selectedHotspotId) return;
        e.preventDefault();
        if (viewerType === "IMAGE_360") {
          const next = hotspots360.filter((h) => h.id !== selectedHotspotId);
          setHotspots360(next);
          setSelectedHotspotId(next[0]?.id ?? null);
        } else {
          const next = normalizeSortOrder(hotspots.filter((h) => h.id !== selectedHotspotId));
          setHotspots(next);
          setSelectedHotspotId(next[0]?.id ?? null);
        }
        setToastMessage("Hotspot deleted");
        return;
      }

      // D — duplicate selected hotspot
      if (e.key === "d" || e.key === "D") {
        if (!selectedHotspotId) return;
        e.preventDefault();
        if (viewerType === "IMAGE_360") {
          const src = hotspots360.find((h) => h.id === selectedHotspotId);
          if (!src) return;
          const copy: Hotspot360 = { ...src, id: `hs360_${Date.now()}_dup`, title: `${src.title} Copy` };
          setHotspots360([...hotspots360, copy]);
          setSelectedHotspotId(copy.id);
        } else {
          const src = hotspots.find((h) => h.id === selectedHotspotId);
          if (!src) return;
          const copy: EditableHotspot = { ...src, id: makeId(), title: `${src.title} Copy` };
          const idx = hotspots.findIndex((h) => h.id === selectedHotspotId);
          const next = [...hotspots];
          next.splice(idx + 1, 0, copy);
          setHotspots(normalizeSortOrder(next));
          setSelectedHotspotId(copy.id);
        }
        setToastMessage("Hotspot duplicated");
        return;
      }

      // Tab — cycle through hotspots
      if (e.key === "Tab") {
        const list = viewerType === "IMAGE_360" ? hotspots360 : hotspots;
        if (!list.length) return;
        e.preventDefault();
        const currentIdx = list.findIndex((h) => h.id === selectedHotspotId);
        const nextIdx = e.shiftKey
          ? (currentIdx <= 0 ? list.length - 1 : currentIdx - 1)
          : (currentIdx + 1) % list.length;
        setSelectedHotspotId(list[nextIdx].id);
        setShowHotspotsModal(true);
        return;
      }

      // Space — toggle auto-rotate
      if (e.key === " ") {
        e.preventDefault();
        try {
          const settings = JSON.parse(viewerSettingsJson);
          settings.autoRotate = !settings.autoRotate;
          setViewerSettingsJson(JSON.stringify(settings, null, 2));
          setToastMessage(settings.autoRotate ? "Auto-rotate on" : "Auto-rotate off");
        } catch { /* ignore parse errors */ }
        return;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    handleUndo, handleRedo, forceSave, viewerType, selectedHotspotId,
    hotspots, hotspots360, viewerSettingsJson, loaderData.selectedProduct,
    loaderData.config.frameCount,
  ]);

  function updateHotspot(id: string, patch: Partial<EditableHotspot>) {
    setHotspots((current) =>
      current.map((hotspot) =>
        hotspot.id === id ? { ...hotspot, ...patch } : hotspot,
      ),
    );
  }
  // Slice 8 hotspots PR #4 — icon picker → Shopify Files modal handlers.
  function handleOpenIconBrowser(hotspotId: string) {
    setIconBrowserHotspotId(hotspotId);
    setShowIconBrowser(true);
  }
  function handleIconBrowserSelect(gids: string[]) {
    const gid = gids[0];
    setShowIconBrowser(false);
    if (!iconBrowserHotspotId || !gid) {
      setIconBrowserHotspotId(null);
      return;
    }
    // Cache the previewUrl from the just-picked file so the icon
    // preview renders immediately. Without this, classifyIcon sees a
    // gid:// value, looks it up in iconResolvedUrls (loader-only data),
    // misses, and shows "?" until the next loader revalidation.
    const file = allPosterFiles.find((f) => f.id === gid);
    if (file?.previewUrl) {
      setOptimisticIconUrls((prev) => ({ ...prev, [gid]: file.previewUrl! }));
    }
    if (viewerType === "IMAGE_360") {
      setHotspots360((current) =>
        current.map((h) => (h.id === iconBrowserHotspotId ? { ...h, icon: gid } : h)),
      );
    } else {
      setHotspots((current) =>
        current.map((h) => (h.id === iconBrowserHotspotId ? { ...h, icon: gid } : h)),
      );
    }
    setIconBrowserHotspotId(null);
  }
  function handleOpenMediaImageBrowser(hotspotId: string) {
    setMediaImageBrowserHotspotId(hotspotId);
    setShowMediaImageBrowser(true);
  }
  function handleMediaImageBrowserSelect(gids: string[]) {
    const gid = gids[0];
    setShowMediaImageBrowser(false);
    if (!mediaImageBrowserHotspotId || !gid) {
      setMediaImageBrowserHotspotId(null);
      return;
    }
    // Same optimistic-resolve pattern as handleIconBrowserSelect — caches
    // the just-picked file's previewUrl so the Preview sub-tab renders
    // the image immediately instead of waiting for loader revalidation.
    const file = allPosterFiles.find((f) => f.id === gid);
    if (file?.previewUrl) {
      setOptimisticIconUrls((prev) => ({ ...prev, [gid]: file.previewUrl! }));
    }
    if (viewerType === "IMAGE_360") {
      setHotspots360((current) =>
        current.map((h) =>
          h.id === mediaImageBrowserHotspotId ? { ...h, mediaImageUrl: gid } : h,
        ),
      );
    } else {
      setHotspots((current) =>
        current.map((h) =>
          h.id === mediaImageBrowserHotspotId ? { ...h, mediaImageUrl: gid } : h,
        ),
      );
    }
    setMediaImageBrowserHotspotId(null);
  }
  const handlePreviewHotspotSelect = useCallback((id: string | null) => {
    setSelectedHotspotId(id);
  }, []);

  const handleAddPreviewHotspot = useCallback((hotspot: EditableHotspot) => {
    setHotspots((current) => [...current, hotspot]);
  }, []);

  const handleSaveHotspotsAsPreset = useCallback((selectedHotspots: EditableHotspot[]) => {
    setPresetSaveHotspots3d(selectedHotspots);
    setPresetSaveHotspots360([]);
    setPresetSaveName("");
    setShowPresetSaveDialog(true);
  }, []);

  const handleSave360HotspotsAsPreset = useCallback((selectedHotspots: Hotspot360[]) => {
    setPresetSaveHotspots3d([]);
    setPresetSaveHotspots360(selectedHotspots);
    setPresetSaveName("");
    setShowPresetSaveDialog(true);
  }, []);

  // Slice 8 — apply presets opens a dedup picker first. Builds the
  // shaped candidate list (cross-mode conversion lives here) and stashes
  // it in state; the merchant chooses the subset to add in
  // PresetApplyDedupModal, then handleConfirmPresetDedup merges only the
  // checked payloads. Title + body carry through unchanged so the dedup
  // helper sees the same text both sides will see post-apply.
  const handleApplyPresets = useCallback((appliedPresets: PresetSummary[]) => {
    const fc = loaderData.config.frameCount || 0;

    if (viewerType === "IMAGE_360") {
      const candidates: PresetApplyCandidate<Hotspot360>[] = [];
      let candidateIdx = 0;
      for (const preset of appliedPresets) {
        // Native 360 hotspots first; fall through to 3D conversion if absent.
        let consumed = false;
        if (preset.hotspotsJson360) {
          try {
            const parsed = JSON.parse(preset.hotspotsJson360);
            if (Array.isArray(parsed) && parsed.length > 0) {
              for (const h of parsed as Partial<Hotspot360>[]) {
                const payload: Hotspot360 = {
                  id: `hs360_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                  sortOrder: 0,
                  visible: Boolean(h.visible ?? true),
                  title: String(h.title ?? "Hotspot"),
                  body: String(h.body ?? ""),
                  style: String(h.style ?? "card"),
                  color: h.color ?? null,
                  visibleFrameStart: h.visibleFrameStart ?? 0,
                  visibleFrameEnd: h.visibleFrameEnd ?? Math.max(0, fc - 1),
                  keyframes: Array.isArray(h.keyframes) ? h.keyframes : [],
                  ctaLabel: h.ctaLabel ?? null,
                  ctaUrl: h.ctaUrl ?? null,
                };
                candidates.push({
                  id: `${preset.id}-${candidateIdx++}`,
                  title: payload.title,
                  body: payload.body,
                  presetName: preset.name,
                  payload,
                });
              }
              consumed = true;
            }
          } catch { /* fall through to 3D conversion */ }
        }
        if (!consumed) {
          try {
            const parsed = JSON.parse(preset.hotspotsJson);
            if (Array.isArray(parsed)) {
              for (const h of parsed as Record<string, unknown>[]) {
                const payload: Hotspot360 = {
                  id: `hs360_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                  sortOrder: 0,
                  visible: Boolean(h.visible ?? true),
                  title: String(h.title ?? "Hotspot"),
                  body: String(h.body ?? ""),
                  style: String(h.style ?? "card"),
                  color: (h.color as string) ?? null,
                  visibleFrameStart: 0,
                  visibleFrameEnd: Math.max(0, fc - 1),
                  keyframes: [{ frame: 0, x: 50, y: 50 }],
                  ctaLabel: (h.ctaLabel as string) ?? null,
                  ctaUrl: (h.ctaUrl as string) ?? null,
                };
                candidates.push({
                  id: `${preset.id}-${candidateIdx++}`,
                  title: payload.title,
                  body: payload.body,
                  presetName: preset.name,
                  payload,
                });
              }
            }
          } catch { /* ignore */ }
        }
      }
      if (candidates.length === 0) {
        setToastMessage("Selected preset(s) had no hotspots to add.");
        return;
      }
      setDedupSourceCount(appliedPresets.length);
      setDedup360Candidates(candidates);
    } else {
      const candidates: PresetApplyCandidate<EditableHotspot>[] = [];
      let candidateIdx = 0;
      for (const preset of appliedPresets) {
        let consumed = false;
        try {
          const parsed = JSON.parse(preset.hotspotsJson);
          if (Array.isArray(parsed) && parsed.length > 0) {
            for (const h of parsed as Partial<EditableHotspot>[]) {
              const payload: EditableHotspot = {
                id: makeId(),
                sortOrder: 0,
                visible: Boolean(h.visible ?? true),
                title: String(h.title ?? "Hotspot"),
                body: String(h.body ?? ""),
                icon: h.icon ?? null,
                style: String(h.style ?? "card"),
                color: h.color ?? "#3b82f6",
                animation: normalizeHotspotAnimation(h.animation),
                mediaImageUrl: h.mediaImageUrl ?? null,
                mediaVideoUrl: h.mediaVideoUrl ?? null,
                position: String(h.position ?? "0m 0m 0m"),
                normal: h.normal ?? null,
                focusTarget: h.focusTarget ?? null,
                focusOrbit: h.focusOrbit ?? null,
                ctaLabel: h.ctaLabel ?? null,
                ctaUrl: h.ctaUrl ?? null,
              };
              candidates.push({
                id: `${preset.id}-${candidateIdx++}`,
                title: payload.title,
                body: payload.body,
                presetName: preset.name,
                payload,
              });
            }
            consumed = true;
          }
        } catch { /* fall through to 360 conversion */ }
        if (!consumed && preset.hotspotsJson360) {
          try {
            const parsed = JSON.parse(preset.hotspotsJson360);
            if (Array.isArray(parsed)) {
              for (const h of parsed as Record<string, unknown>[]) {
                const payload: EditableHotspot = {
                  id: makeId(),
                  sortOrder: 0,
                  visible: Boolean(h.visible ?? true),
                  title: String(h.title ?? "Hotspot"),
                  body: String(h.body ?? ""),
                  icon: "plus",
                  style: String(h.style ?? "card"),
                  color: (h.color as string) ?? "#3b82f6",
                  // Slice 8 fields — 360 presets don't store animation /
                  // typed media slots, but EditableHotspot requires them;
                  // normalize the same way the 3D path above does.
                  animation: normalizeHotspotAnimation(h.animation),
                  mediaImageUrl: (h.mediaImageUrl as string) ?? null,
                  mediaVideoUrl: (h.mediaVideoUrl as string) ?? null,
                  position: "0m 0m 0m",
                  normal: null,
                  focusTarget: null,
                  focusOrbit: null,
                  ctaLabel: (h.ctaLabel as string) ?? null,
                  ctaUrl: (h.ctaUrl as string) ?? null,
                };
                candidates.push({
                  id: `${preset.id}-${candidateIdx++}`,
                  title: payload.title,
                  body: payload.body,
                  presetName: preset.name,
                  payload,
                });
              }
            }
          } catch { /* ignore */ }
        }
      }
      if (candidates.length === 0) {
        setToastMessage("Selected preset(s) had no hotspots to add.");
        return;
      }
      setDedupSourceCount(appliedPresets.length);
      setDedup3dCandidates(candidates);
    }
  }, [viewerType, loaderData.config.frameCount]);

  const handleConfirmDedup3d = useCallback((selected: EditableHotspot[]) => {
    if (selected.length > 0) {
      const merged = [...hotspots, ...selected];
      setHotspots(normalizeSortOrder(merged));
      setToastMessage(`Applied ${selected.length} hotspot${selected.length === 1 ? "" : "s"} from ${dedupSourceCount} preset${dedupSourceCount === 1 ? "" : "s"}.`);
    }
  }, [hotspots, dedupSourceCount]);

  const handleConfirmDedup360 = useCallback((selected: Hotspot360[]) => {
    if (selected.length > 0) {
      const merged = [...hotspots360, ...selected].map((h, i) => ({ ...h, sortOrder: i + 1 }));
      setHotspots360(merged);
      setToastMessage(`Applied ${selected.length} hotspot${selected.length === 1 ? "" : "s"} from ${dedupSourceCount} preset${dedupSourceCount === 1 ? "" : "s"}.`);
    }
  }, [hotspots360, dedupSourceCount]);

  const handleExportConfig = useCallback(() => {
    const exportData: ConfigExport = {
      version: 1,
      viewerType: viewerTypeDbToWire(viewerType),
      enabled,
      sourceMode,
      viewerSettings: safeJsonParse(viewerSettingsJson, defaultViewerSettings),
      hotspots: JSON.parse(hotspotsJson || "[]"),
      hotspots360: hotspots360,
      modelFileGid: loaderData.config.modelFileShopifyGid || null,
      posterFileGid: loaderData.config.posterFileShopifyGid || null,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const title = loaderData.selectedProduct?.title?.replace(/[^a-z0-9]/gi, "-") || "product";
    a.download = `sdl3d-config-${title}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setToastMessage("Configuration exported.");
  }, [viewerType, enabled, sourceMode, viewerSettingsJson, hotspotsJson, hotspots360, loaderData]);

  const handleImportConfig = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string);
          if (!isValidConfigExport(data)) {
            setToastMessage(`Invalid config file. Expected ${BRAND.appName} export format.`);
            return;
          }
          setViewerType(normalizeViewerTypeToDb(data.viewerType));
          setEnabled(data.enabled);
          setViewerSettingsJson(JSON.stringify(data.viewerSettings, null, 2));
          setHotspots(parseInitialHotspots(JSON.stringify(data.hotspots)));
          setHotspots360(parseInitialHotspots360(JSON.stringify(data.hotspots360)));
          setToastMessage("Configuration imported. Save draft to persist.");
        } catch {
          setToastMessage("Failed to parse config file.");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, []);

  function confirmDiscardChanges() {
    if (!isDirty) return true;
    return window.confirm("You have unsaved changes. Leave without saving?");
  }

  const saveStateLabel = saveFetcher.state !== "idle"
    ? "Saving…"
    : isDirty
      ? "Unsaved"
      : lastSavedAt
        ? formatSavedAgo(lastSavedAt, saveStatusNow)
        : "Saved";
  const saveStateTone: "info" | "warning" | "success" =
    saveFetcher.state !== "idle" ? "info" : isDirty ? "warning" : "success";

  // Workflow step state for the sidebar step navigator.
  const hasMedia = viewerType === "IMAGE_360"
    ? loaderData.imageSequenceFrames.length > 0
    : Boolean(loaderData.config.modelFileShopifyGid);

  const steps: Step[] = [
    {
      id: "product",
      label: "Product",
      status: loaderData.selectedProduct ? "done" : "todo",
    },
    {
      id: "media",
      label: "Media",
      status: hasMedia ? "done" : "todo",
    },
    {
      id: "viewer",
      label: "Viewer",
      status: "done",
    },
    {
      id: "hotspots",
      label: "Hotspots",
      status: hotspots.length > 0 || hotspots360.length > 0 ? "done" : "todo",
    },
    {
      id: "publish",
      label: "Publish",
      status: validation.isPublishReady
        ? "done"
        : validation.errors.length > 0
          ? "warn"
          : "todo",
    },
  ];

  const tabToStep: Record<typeof rightTab, StepId> = {
    upload: "media",
    viewer: "viewer",
    hotspots: "hotspots",
    advanced: "publish",
  };
  const currentStep: StepId = tabToStep[rightTab];

  const handleStepClick = (id: StepId) => {
    switch (id) {
      case "product":
        setShowProductBrowser(true);
        break;
      case "media":
        setRightTab("upload");
        break;
      case "viewer":
        setRightTab("viewer");
        break;
      case "hotspots":
        // Slice 9 — Setup wizard's "Hotspots" step opens the full-screen
        // hotspots modal instead of switching the right-column tab.
        setShowHotspotsModal(true);
        break;
      case "publish":
        setRightTab("advanced");
        break;
    }
  };

  // PR #4 — itemized publish blockers feed the sidebar's Publish step.
  // Each issue resolves the inspector tab that owns the field via the
  // existing categorize → tabLabel pipeline, with the jump action wired
  // straight to setRightTab (no intermediate handler in the sidebar).
  const validationIssues: ValidationIssue[] = [
    ...validation.errors.map<ValidationIssue>((message, i) => {
      const tab = categorizeValidationMessage(message);
      return {
        id: `err-${i}-${message}`,
        kind: "error",
        message,
        jumpLabel: tab ? tabLabel(tab) : null,
        onJump: tab ? () => setRightTab(tab) : null,
      };
    }),
    ...validation.warnings.map<ValidationIssue>((message, i) => {
      const tab = categorizeValidationMessage(message);
      return {
        id: `warn-${i}-${message}`,
        kind: "warning",
        message,
        jumpLabel: tab ? tabLabel(tab) : null,
        onJump: tab ? () => setRightTab(tab) : null,
      };
    }),
  ];


  return (
    <div className="sdl-editor">
      <div className="sdl-editor__inner">
        {toastMessage ? (
          <div className={`sdl-toast ${toastTone === "success" ? "sdl-toast--success" : "sdl-toast--error"}`}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.8 }}>
                {toastTone === "success" ? "Done" : "Issue"}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{toastMessage}</div>
            </div>
            <Button
              variant="plain"
              size="micro"
              onClick={() => setToastMessage("")}
              accessibilityLabel="Dismiss notification"
            >
              ✕
            </Button>
          </div>
        ) : null}

        {/* Top bar — Slice 5C PR #5a: Polaris primitives (Button, Badge)
            inside the existing sdl-editor__topbar flex container. Full
            Polaris Page wrap is deferred to 5c, since the editor uses a
            fixed-height embedded shell layout (per feedback_shopify_body_lock.md)
            that conflicts with Polaris Page's centered-page chrome. Save-status
            Banner UX win is also deferred — Banner would consume editor canvas
            vertical space; the inline Badge is the right shape here. */}
        <div className="sdl-editor__topbar">
          <div className="sdl-editor__topbar__left">
            <Button onClick={() => setShowProductBrowser(true)} size="slim">
              Browse product
            </Button>
            <TopbarField label="Product" value={loaderData.selectedProduct?.title ?? "—"} />
            {loaderData.selectedProduct ? (
              <>
                <Badge tone={readyTone === "danger" ? "critical" : "success"}>
                  {validation.isPublishReady ? "ready" : "blocked"}
                </Badge>
                {/* Slice 7 PR #3a: Mode display removed from topbar.
                    Viewer-type toggle now lives in the Media inspector
                    section next to the thing it controls. */}
                {/* Slice 7 PR #1 — moved from the inspector's first card.
                    Single most-toggled control; belongs at the top where it's
                    always one click away. Wired through the same `enabled`
                    state the inspector toggle used, so autosave behavior is
                    unchanged. */}
                <Checkbox
                  label="On storefront"
                  labelHidden={false}
                  checked={enabled}
                  onChange={(checked) => setEnabled(checked)}
                />
                {loaderData.availableStorages.length > 1 ? (
                  <>
                    <Select
                      label="Storage"
                      labelInline
                      options={loaderData.availableStorages.map((s) => ({
                        label: `${s.provider}: ${s.bucket}`,
                        value: s.id,
                      }))}
                      value={selectedStorageId}
                      onChange={setSelectedStorageId}
                    />
                    <Badge tone={storageOverrideActive ? "attention" : undefined}>
                      {storageOverrideActive ? "override" : "default"}
                    </Badge>
                  </>
                ) : null}
                <Badge tone={saveStateTone}>{saveStateLabel}</Badge>
              </>
            ) : null}
          </div>
          <div className="sdl-editor__topbar__right">
            {loaderData.selectedProduct ? (
              <>
                {/* Slice 9 hotspot UX rework — primary entry into the
                    new full-screen hotspots editor. Count badges the
                    button so merchants can see at a glance how many
                    hotspots are configured. */}
                <Button
                  size="slim"
                  onClick={() => setShowHotspotsModal(true)}
                  disabled={!loaderData.config.id}
                >
                  {`Edit hotspots (${
                    viewerType === "IMAGE_360" ? hotspots360.length : hotspots.length
                  })`}
                </Button>
                <Button
                  onClick={forceSave}
                  size="slim"
                  disabled={!isDirty}
                  loading={saveFetcher.state !== "idle"}
                >
                  Save draft
                </Button>
                <Button
                  variant="primary"
                  tone="success"
                  size="slim"
                  onClick={submitPublish}
                  disabled={publishDisabled || isActionBusy}
                  loading={
                    isActionBusy &&
                    actionFetcher.formData?.get("intent") === "publish"
                  }
                >
                  Publish
                </Button>
              </>
            ) : null}
          </div>
        </div>

        <div className="sdl-editor__grid">
          <aside className="sdl-editor__sidebar">
            <Sdl3dEditorSidebar
              loaderData={loaderData}
              readyTone={readyTone}
              steps={steps}
              currentStep={currentStep}
              onStepClick={handleStepClick}
              validationIssues={validationIssues}
            />
          </aside>

          <main className="sdl-main-panel">
            {loaderData.selectedProduct ? (
              <>
                <Card padding="300">
                  {/* Slice 7 PR #3a: viewer-type toggle moved into Media
                      inspector section; middle-pane header now hosts the
                      canvas directly with no chrome above it. */}
                  {viewerType === "IMAGE_360" ? (
                    <Sdl3dImageSequencePreview
                      frames={loaderData.imageSequenceFrames}
                      hotspots={hotspots360}
                      selectedHotspotId={selectedHotspotId}
                      viewerSettingsJson={viewerSettingsJson}
                      onSelectHotspot={handlePreviewHotspotSelect}
                      onPlaceHotspot={(frame, x, y) => {
                        if (selectedHotspotId) {
                          setHotspots360((prev) =>
                            prev.map((h) => {
                              if (h.id !== selectedHotspotId) return h;
                              const existing = h.keyframes.findIndex((kf) => kf.frame === frame);
                              const newKeyframes = existing >= 0
                                ? h.keyframes.map((kf, i) => i === existing ? { frame, x, y } : kf)
                                : [...h.keyframes, { frame, x, y }];
                              newKeyframes.sort((a, b) => a.frame - b.frame);
                              return { ...h, keyframes: newKeyframes };
                            }),
                          );
                        }
                      }}
                      onDragHotspot={(hotspotId, frame, x, y) => {
                        setHotspots360((prev) =>
                          prev.map((h) => {
                            if (h.id !== hotspotId) return h;
                            const existing = h.keyframes.findIndex((kf) => kf.frame === frame);
                            const newKeyframes = existing >= 0
                              ? h.keyframes.map((kf, i) => i === existing ? { frame, x, y } : kf)
                              : [...h.keyframes, { frame, x, y }];
                            newKeyframes.sort((a, b) => a.frame - b.frame);
                            return { ...h, keyframes: newKeyframes };
                          }),
                        );
                      }}
                      onRemoveKeyframe={(hotspotId, frame) => {
                        setHotspots360((prev) =>
                          prev.map((h) => {
                            if (h.id !== hotspotId) return h;
                            return {
                              ...h,
                              keyframes: h.keyframes.filter((kf) => kf.frame !== frame),
                            };
                          }),
                        );
                      }}
                      captureMode={selectedHotspotId ? "placeHotspot" : "none"}
                    />
                  ) : (
                    <Sdl3dEditorPreview
                      modelSourceUrl={loaderData.resolvedAssets.modelSourceUrl}
                      posterUrl={loaderData.resolvedAssets.posterUrl}
                      viewerSettingsJson={viewerSettingsJson}
                      hotspots={hotspots}
                      selectedHotspotId={selectedHotspotId}
                      onAddHotspot={handleAddPreviewHotspot}
                      onUpdateHotspot={updateHotspot}
                      onSelectHotspot={handlePreviewHotspotSelect}
                      onReplaceViewerSettingsJson={setViewerSettingsJson}
                    />
                  )}
                </Card>

                {/* Slice 9 follow-up — the below-canvas position panel
                    was removed. 360 keyframe X/Y edits happen via a
                    floating editor on the viewer itself (click a
                    keyframe dot on the timeline), and visibility range
                    fields moved into the hotspots modal. 3D positions
                    are set entirely via canvas click-to-place + the
                    Capture Orbit / Capture Target toolbar buttons on
                    Sdl3dEditorPreview; raw XYZ tweaks (rare) live in
                    the Publish → Advanced hotspots JSON editor. */}
              </>
            ) : (
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    Start by choosing a product
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    The live preview will appear here once a product is selected. Search for a product on the left, then open it to configure the model, poster, viewer settings, and hotspots.
                  </Text>
                </BlockStack>
              </Card>
            )}
          </main>

          <aside className="sdl-editor__inspector">
            {loaderData.selectedProduct ? (
              <BlockStack gap="300">
                {/* Storefront-visibility toggle relocated to the topbar in
                    Slice 7 PR #1; inspector starts with Media directly. */}
                <InspectorSection
                  id="inspector-media"
                  title="Media"
                  open={rightTab === "upload"}
                  onToggle={() => setRightTab(rightTab === "upload" ? "viewer" : "upload")}
                >
                  <BlockStack gap="300">
                    {/* Slice 7 PR #3a: viewer-type toggle relocated here
                        from the middle-pane header. Sits at the top of
                        Media because it dictates which media slots render
                        below. */}
                    <ButtonGroup variant="segmented" fullWidth>
                      <Button
                        pressed={viewerType === "MODEL_3D"}
                        onClick={() => setViewerType("MODEL_3D")}
                      >
                        3D Model
                      </Button>
                      <Button
                        pressed={viewerType === "IMAGE_360"}
                        onClick={() => setViewerType("IMAGE_360")}
                      >
                        360° Images
                      </Button>
                    </ButtonGroup>

                    {viewerType === "MODEL_3D" ? (
                      <>
                        <FileTriggerCard
                          title="Model file"
                          name={selectedModelFile?.name ?? "No model selected"}
                          meta={
                            selectedModelFile
                              ? `${selectedModelFile.typeName} · ${selectedModelFile.fileStatus}`
                              : "Click to browse or upload"
                          }
                          thumbUrl={selectedModelFile?.previewUrl ?? null}
                          fallbackEmoji="📦"
                          onClick={() => setShowModelBrowser(true)}
                        />
                        <FileTriggerCard
                          title="Poster file"
                          name={selectedPosterFile?.name ?? "No poster selected"}
                          meta={
                            selectedPosterFile
                              ? `${selectedPosterFile.typeName} · ${selectedPosterFile.fileStatus}`
                              : loaderData.productFeaturedImageUrl
                                ? "Using product image as fallback"
                                : "Click to browse or upload"
                          }
                          thumbUrl={selectedPosterFile?.previewUrl ?? loaderData.productFeaturedImageUrl ?? null}
                          fallbackEmoji="🖼"
                          onClick={() => setShowPosterBrowser(true)}
                        />
                      </>
                    ) : (
                      <>
                        {/* Slice 7 PR #3b — three sources collapsed into
                            one entry point. The FileTriggerCard opens
                            Sdl3dMediaSourceModal which has tabs for the
                            CDN upload, Shopify Files browse, and CDN
                            folder reuse paths. */}
                        <FileTriggerCard
                          title="360° Image Sequence"
                          name={
                            loaderData.config.frameCount > 0
                              ? `${loaderData.config.frameCount} frames uploaded`
                              : "No frames uploaded"
                          }
                          meta="Click to upload or browse"
                          thumbUrl={null}
                          fallbackEmoji="📷"
                          onClick={() => setShowMediaSourceModal(true)}
                        />

                        <FileTriggerCard
                          title="Poster file"
                          name={selectedPosterFile?.name ?? "No poster selected"}
                          meta={
                            selectedPosterFile
                              ? `${selectedPosterFile.typeName} · ${selectedPosterFile.fileStatus}`
                              : loaderData.productFeaturedImageUrl
                                ? "Using product image as fallback"
                                : "Click to browse or upload"
                          }
                          thumbUrl={selectedPosterFile?.previewUrl ?? loaderData.productFeaturedImageUrl ?? null}
                          fallbackEmoji="🖼"
                          onClick={() => setShowPosterBrowser(true)}
                        />
                      </>
                    )}
                  </BlockStack>
                </InspectorSection>

                <InspectorSection
                  id="inspector-viewer"
                  title="Viewer"
                  open={rightTab === "viewer"}
                  onToggle={() => setRightTab(rightTab === "viewer" ? "upload" : "viewer")}
                >
                  <Sdl3dViewerSettingsEditor
                    valueJson={viewerSettingsJson}
                    onChangeJson={setViewerSettingsJson}
                    viewerType={viewerType}
                    shopDefaultBackgroundColor={loaderData.shopDefaultBackgroundColor}
                  />
                </InspectorSection>

                {/* Slice 9 hotspot UX rework — the previous "Hotspots"
                    InspectorSection was lifted into Sdl3dHotspotsModal
                    (full-screen takeover). Open via dot click on the
                    canvas, the H keyboard shortcut, or the "Edit hotspots"
                    button below the canvas. The Modal owns Undo/Redo +
                    Simple/Advanced toggle that used to live here. */}

                <InspectorSection
                  id="inspector-publish"
                  title="Publish"
                  open={rightTab === "advanced"}
                  onToggle={() => setRightTab(rightTab === "advanced" ? "upload" : "advanced")}
                >
                  <Sdl3dViewerSettingsEditor
                    valueJson={viewerSettingsJson}
                    onChangeJson={setViewerSettingsJson}
                    advanced
                    viewerType={viewerType}
                    shopDefaultBackgroundColor={loaderData.shopDefaultBackgroundColor}
                  />
                  <Box paddingBlockStart="300">
                    <JsonAdvancedPanel
                      viewerSettingsJson={viewerSettingsJson}
                      onChangeViewerSettings={setViewerSettingsJson}
                      hotspotsJson={viewerType === "IMAGE_360" ? hotspotsJson360Memo : hotspotsJson}
                      hotspotsLabel={viewerType === "IMAGE_360" ? "360° Hotspots JSON" : "Hotspots JSON"}
                      onExport={handleExportConfig}
                      onImport={handleImportConfig}
                    />
                  </Box>

                  {/* Slice 8 PR #2 — Danger zone at the bottom of the
                      Publish inspector. Mirrors the dashboard's
                      per-row delete button (intent=deleteConfig); on
                      success, navigates back to /app since the editor
                      no longer has a config to render. */}
                  {loaderData.config.id ? (
                    <Box paddingBlockStart="400" borderBlockStartWidth="025" borderColor="border">
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm" fontWeight="semibold">
                          Danger zone
                        </Text>
                        <Text as="p" tone="subdued" variant="bodySm">
                          Removes this product&apos;s config, hotspots, and capture history. Metafields are kept so you can recover by pulling from metafield later.
                        </Text>
                        <InlineStack>
                          <Button
                            tone="critical"
                            variant="primary"
                            onClick={() => setShowDeleteConfirm(true)}
                            disabled={deleteConfigFetcher.state !== "idle"}
                          >
                            Delete this config
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  ) : null}
                </InspectorSection>
              </BlockStack>
            ) : (
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    Editor panel
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Upload controls, viewer settings, and hotspots will appear here once a product is selected.
                  </Text>
                </BlockStack>
              </Card>
            )}
          </aside>
        </div>

      </div>

      {/* ── File / Product Browser Modals ── */}
      {loaderData.selectedProduct && (
        <>
          <FileBrowserModal
            open={showModelBrowser}
            onClose={() => setShowModelBrowser(false)}
            mode="model"
            initialFiles={allModelFiles}
            initialHasMore={modelHasMore}
            initialCursor={modelCursor}
            selectedGid={loaderData.config.modelFileShopifyGid}
            onSelect={handleModelSelect}
            onUpload={handleModelUpload}
            productGid={loaderData.selectedProduct.id}
            q={loaderData.q}
            busy={isActionBusy}
            referenceFilename={allModelFiles.find((f) => f.id === loaderData.config.modelFileShopifyGid)?.name}
          />
          <FileBrowserModal
            open={showPosterBrowser}
            onClose={() => setShowPosterBrowser(false)}
            mode="poster"
            initialFiles={allPosterFiles}
            initialHasMore={posterHasMore}
            initialCursor={posterCursor}
            selectedGid={loaderData.config.posterFileShopifyGid}
            onSelect={handlePosterSelect}
            onUpload={handlePosterUpload}
            productGid={loaderData.selectedProduct.id}
            q={loaderData.q}
            busy={isActionBusy}
            shopLogoUrl={loaderData.shopLogoUrl}
            productFeaturedImageUrl={loaderData.productFeaturedImageUrl}
            referenceFilename={allPosterFiles.find((f) => f.id === loaderData.config.posterFileShopifyGid)?.name}
          />
          <FileBrowserModal
            open={showIconBrowser}
            onClose={() => {
              setShowIconBrowser(false);
              setIconBrowserHotspotId(null);
            }}
            mode="poster"
            initialFiles={allPosterFiles}
            initialHasMore={posterHasMore}
            initialCursor={posterCursor}
            onSelect={handleIconBrowserSelect}
            onUpload={handlePosterUpload}
            productGid={loaderData.selectedProduct.id}
            q={loaderData.q}
            busy={isActionBusy}
          />
          <FileBrowserModal
            open={showMediaImageBrowser}
            onClose={() => {
              setShowMediaImageBrowser(false);
              setMediaImageBrowserHotspotId(null);
            }}
            mode="poster"
            initialFiles={allPosterFiles}
            initialHasMore={posterHasMore}
            initialCursor={posterCursor}
            onSelect={handleMediaImageBrowserSelect}
            onUpload={handlePosterUpload}
            productGid={loaderData.selectedProduct.id}
            q={loaderData.q}
            busy={isActionBusy}
          />
          <FileBrowserModal
            open={showSequenceBrowser}
            onClose={() => setShowSequenceBrowser(false)}
            mode="sequence"
            initialFiles={allPosterFiles}
            initialHasMore={posterHasMore}
            initialCursor={posterCursor}
            onSelect={handleSequenceSelect}
            onUpload={handleSequenceUpload}
            productGid={loaderData.selectedProduct.id}
            q={loaderData.q}
            busy={isActionBusy}
            onZipUpload={handleZipUploadFile}
            zipProcessing={zipProcessing}
          />
          <Sdl3dMediaSourceModal
            open={showMediaSourceModal}
            onClose={() => setShowMediaSourceModal(false)}
            productGid={loaderData.selectedProduct.id}
            productConfigId={loaderData.config.id}
            frameCount={loaderData.config.frameCount}
            storageId={selectedStorageId || undefined}
            latestCapture={loaderData.latestCapture}
            onCompleted={() => revalidator.revalidate()}
            onOpenShopifyFilesBrowser={() => setShowSequenceBrowser(true)}
          />
          {/* Slice 9 hotspot UX rework — full-screen hotspots editor.
              Preset modals (PresetBrowserModal, PresetApplyDedupModal)
              and the inline Save-as-Preset dialog stay where they are
              and stack on top of this one when invoked from the toolbar
              inside it. */}
          <Sdl3dHotspotsModal
            open={showHotspotsModal}
            onClose={() => setShowHotspotsModal(false)}
            productLabel={loaderData.selectedProduct.title}
            viewerType={viewerType}
            selectedHotspotId={selectedHotspotId}
            onSelectHotspot={setSelectedHotspotId}
            iconResolvedUrls={{ ...optimisticIconUrls, ...loaderData.iconResolvedUrls }}
            onOpenIconBrowser={handleOpenIconBrowser}
            onOpenMediaImageBrowser={handleOpenMediaImageBrowser}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onApplyPreset={() => setShowPresetBrowser(true)}
            onSaveAsPreset3d={handleSaveHotspotsAsPreset}
            onSaveAsPreset360={handleSave360HotspotsAsPreset}
            hotspots3d={hotspots}
            onChangeHotspots3d={setHotspots}
            hotspots360={hotspots360}
            onChangeHotspots360={setHotspots360}
            frameCount={loaderData.config.frameCount}
            currentFrame={currentFrame360}
          />
        </>
      )}
      <ProductBrowserModal
        open={showProductBrowser}
        onClose={() => setShowProductBrowser(false)}
        q={loaderData.q}
        productGid={loaderData.productGid}
        products={loaderData.products}
        confirmDiscardChanges={confirmDiscardChanges}
      />

      {/* ── Preset Browser Modal ── */}
      <PresetBrowserModal
        open={showPresetBrowser}
        onClose={() => setShowPresetBrowser(false)}
        onApply={handleApplyPresets}
      />

      {/* ── Preset Apply Dedup Picker (Slice 8) — opens after the
          merchant picks preset(s) in PresetBrowserModal. Per-hotspot
          checkbox + duplicate detection. Only one of the two
          (3D / 360) is non-null at a time, gated by viewerType. ── */}
      {dedup3dCandidates ? (
        <PresetApplyDedupModal<EditableHotspot>
          open={true}
          onClose={() => setDedup3dCandidates(null)}
          candidates={dedup3dCandidates}
          existing={hotspots.map((h) => ({ title: h.title, body: h.body }))}
          onConfirm={handleConfirmDedup3d}
        />
      ) : null}
      {dedup360Candidates ? (
        <PresetApplyDedupModal<Hotspot360>
          open={true}
          onClose={() => setDedup360Candidates(null)}
          candidates={dedup360Candidates}
          existing={hotspots360.map((h) => ({ title: h.title, body: h.body }))}
          onConfirm={handleConfirmDedup360}
        />
      ) : null}

      {/* Save Hotspots as Preset — Polaris Modal (Slice 5C PR #5g). The
          fetcher form sits inside Modal.Section so we still get free
          XHR submission via actionFetcher.Form, but Polaris owns the
          shell + focus trap + escape. */}
      <Modal
        open={showPresetSaveDialog}
        onClose={() => setShowPresetSaveDialog(false)}
        title="Save Hotspots as Preset"
        size="small"
        primaryAction={{
          content: "Save Preset",
          disabled: !presetSaveName.trim(),
          onAction: () => {
            const fd = new FormData();
            fd.set("fetcherMode", "1");
            fd.set("intent", "saveAsPreset");
            fd.set("presetName", presetSaveName);
            fd.set("hotspotsJson", JSON.stringify(presetSaveHotspots3d));
            if (presetSaveHotspots360.length > 0) {
              fd.set("hotspotsJson360", JSON.stringify(presetSaveHotspots360));
            }
            actionFetcher.submit(fd, { method: "post", action: "/api/sdl3d/presets" });
            setShowPresetSaveDialog(false);
            setToastMessage("Saving preset...");
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setShowPresetSaveDialog(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p" tone="subdued" variant="bodySm">
              {presetSaveHotspots3d.length + presetSaveHotspots360.length} hotspot
              {presetSaveHotspots3d.length + presetSaveHotspots360.length === 1 ? "" : "s"} will be saved.
            </Text>
            <TextField
              label="Preset name"
              value={presetSaveName}
              onChange={setPresetSaveName}
              placeholder="My hotspot preset"
              // Modal opens for naming — focus on mount. Intentional.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              autoComplete="off"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Slice 8 PR #2 — Delete-config confirmation. Destructive primary
          action with the product title spelled out so the merchant
          knows exactly what's going. */}
      <Modal
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Delete this config?"
        size="small"
        primaryAction={{
          content: "Delete config",
          destructive: true,
          loading: deleteConfigFetcher.state !== "idle",
          disabled: deleteConfigFetcher.state !== "idle",
          onAction: () => {
            if (!loaderData.selectedProduct) return;
            deleteConfigFetcher.submit(
              { intent: "deleteConfig", productGid: loaderData.selectedProduct.id },
              { method: "post", action: "/api/sdl3d/config" },
            );
          },
        }}
        secondaryActions={[
          {
            content: "Cancel",
            disabled: deleteConfigFetcher.state !== "idle",
            onAction: () => setShowDeleteConfirm(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">
              {`This permanently removes the 3D viewer config for `}
              <Text as="span" fontWeight="semibold">
                {loaderData.selectedProduct?.title ?? "this product"}
              </Text>
              {`, along with all hotspots and capture history.`}
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              The published metafields stay on the product so the storefront viewer keeps rendering until you clear them. You can recover the config later by pulling from metafield.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </div>
  );
}

/**
 * Maps a validation message to the inspector tab that owns the field. Returns
 * null for messages that don't have a single obvious home (rare — currently
 * everything maps). Slice 5C PR #5c.
 */
function categorizeValidationMessage(msg: string): RightTab | null {
  const lower = msg.toLowerCase();
  if (lower.includes("model file") || lower.includes("image frames") || lower.includes("frames are required")) {
    return "upload";
  }
  if (lower.startsWith("hotspot ") || /^hotspot \d/.test(lower)) {
    return "hotspots";
  }
  if (lower.includes("camera ") || lower.includes("polar angle") || lower.includes("background color") || lower.includes("viewer settings json")) {
    return "viewer";
  }
  return null;
}

function tabLabel(tab: RightTab): string {
  switch (tab) {
    case "upload":
      return "Media";
    case "viewer":
      return "Viewer";
    case "hotspots":
      return "Hotspots";
    case "advanced":
      return "Publish";
  }
}

/**
 * JSON download / edit / re-upload panel — PR #6. Polaris Collapsible
 * disclosure with Download + Re-upload Buttons and two TextField
 * multilines (one editable, one readonly). Replaces the bespoke
 * `<details className="sdl-collapsible">` + `.sdl-btn` + `.sdl-textarea`
 * + `.sdl-label` + `.sdl-json-grid` block.
 */
function JsonAdvancedPanel({
  viewerSettingsJson,
  onChangeViewerSettings,
  hotspotsJson,
  hotspotsLabel,
  onExport,
  onImport,
}: {
  viewerSettingsJson: string;
  onChangeViewerSettings: (next: string) => void;
  hotspotsJson: string;
  hotspotsLabel: string;
  onExport: () => void;
  onImport: () => void;
}) {
  const [open, setOpen] = useState(false);
  const id = "json-advanced-panel";
  return (
    <BlockStack gap="200">
      <button
        type="button"
        className="sdl-inspector-section__trigger"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            JSON download / edit / re-upload
          </Text>
          <Icon source={open ? ChevronUpIcon : ChevronDownIcon} tone="subdued" />
        </InlineStack>
      </button>
      <Collapsible id={id} open={open} transition={{ duration: "150ms", timingFunction: "ease-in-out" }}>
        <BlockStack gap="300">
          <InlineStack gap="200">
            <Button onClick={onExport}>Download JSON</Button>
            <Button onClick={onImport}>Re-upload JSON</Button>
          </InlineStack>
          <TextField
            label="Viewer settings JSON"
            value={viewerSettingsJson}
            onChange={onChangeViewerSettings}
            multiline={16}
            autoComplete="off"
          />
          <TextField
            label={hotspotsLabel}
            value={hotspotsJson}
            onChange={() => { /* readonly */ }}
            readOnly
            multiline={16}
            autoComplete="off"
          />
        </BlockStack>
      </Collapsible>
    </BlockStack>
  );
}

/**
 * Tiny LABEL/VALUE pair for the editor top bar — PR #6. Replaces the
 * bespoke `.sdl-topbar-field*` spans. Pure Polaris Text composition.
 */
function TopbarField({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
      <Text as="span" tone="subdued" variant="bodySm" fontWeight="semibold">
        {label}
      </Text>
      <Text as="span" variant="bodyMd" fontWeight="semibold">
        {value}
      </Text>
    </span>
  );
}

/**
 * Clickable file-picker card for the editor's Media inspector — PR #6.
 * Renders a section title, a clickable button row with a thumbnail +
 * name/meta + "Browse" affordance. Native `<button>` styled with
 * Polaris design tokens since Polaris ships no equivalent.
 */
function FileTriggerCard({
  title,
  name,
  meta,
  thumbUrl,
  fallbackEmoji,
  onClick,
}: {
  title: string;
  name: string;
  meta: string;
  thumbUrl: string | null;
  fallbackEmoji: string;
  onClick: () => void;
}) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="h4" variant="headingXs">
          {title}
        </Text>
        <button type="button" className="sdl-ft" onClick={onClick}>
          <span className="sdl-ft__thumb" aria-hidden>
            {thumbUrl ? (
              <img src={thumbUrl} alt="" />
            ) : (
              <span className="sdl-ft__emoji">{fallbackEmoji}</span>
            )}
          </span>
          <span className="sdl-ft__label">
            <span className="sdl-ft__name">{name}</span>
            <span className="sdl-ft__meta">{meta}</span>
          </span>
          <span className="sdl-ft__action">Browse</span>
        </button>
      </BlockStack>
    </Card>
  );
}

/**
 * One row of the right-column inspector. Renders a Polaris Card with a
 * clickable header that toggles its body via Collapsible. Slice 5C PR #5c.
 *
 * The chevron + button-as-header pattern is needed because Polaris doesn't
 * ship a built-in collapsible Card. `aria-controls`/`aria-expanded` are
 * wired so screen readers announce the section state correctly.
 */
function InspectorSection({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card padding="0">
      <button
        type="button"
        className="sdl-inspector-section__trigger"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
      >
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <Text as="h3" variant="headingSm">
            {title}
          </Text>
          <Icon source={open ? ChevronUpIcon : ChevronDownIcon} tone="subdued" />
        </InlineStack>
      </button>
      <Collapsible id={id} open={open} transition={{ duration: "150ms", timingFunction: "ease-in-out" }}>
        <Box paddingInline="400" paddingBlockEnd="400">
          {children}
        </Box>
      </Collapsible>
    </Card>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} — ${error.statusText || "Something went wrong"}`
    : error instanceof Error
      ? error.message
      : "An unexpected error occurred.";

  return (
    <div style={{ maxWidth: 600, margin: "60px auto", padding: 24 }}>
      <Card>
        <BlockStack gap="300">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              Editor error
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              {message}
            </Text>
          </BlockStack>
          <InlineStack gap="200" align="center">
            <Button variant="primary" url="/app/sdl3d/editor">
              Reload editor
            </Button>
            <Button url="/app">Back to dashboard</Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </div>
  );
}
