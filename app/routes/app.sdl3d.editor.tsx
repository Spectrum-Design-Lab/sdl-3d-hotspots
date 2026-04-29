import { Link, useBlocker, useFetcher, useLoaderData, useRevalidator, useRouteError, isRouteErrorResponse } from "react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../styles/editor.css";

import prisma from "../db.server";
import shopify from "../shopify.server";
import { adminGraphql, ensureShop } from "../lib/sdl3d-graphql.server";

import { defaultViewerSettings, safeJsonParse, isValidConfigExport, viewerTypeDbToWire, normalizeViewerTypeToDb, type ViewerType, type ImageSequenceFrame, type Hotspot360, type ConfigExport } from "../lib/sdl3d-shared";
import { validateDraftForPublish } from "../lib/sdl3d-validation";
import {
  listShopifyFiles,
  resolveSelectedAssetUrls,
} from "../lib/sdl3d-files.server";
import { resolveImageSequenceUrls } from "../lib/sdl3d-image-sequence.server";
import { hasSyncableSdl3dMetafields, pullMetafieldsToDraft } from "../lib/sdl3d-sync.server";
import { notify } from "../lib/notify.server";

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
import { Sdl3dEditorSidebar } from "../components/Sdl3dEditorSidebar";
import { StorefrontPreview } from "../components/StorefrontPreview";
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
    configuredProducts,
    modelFileResult,
    posterFileResult,
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
          include: { hotspots: { orderBy: { sortOrder: "asc" } } },
        })
      : Promise.resolve(null),

    // Configured products for "copy from" (DB)
    prisma.productConfig.findMany({
      where: { shopId: shop.id },
      select: { shopifyProductGid: true, viewerType: true, status: true },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),

    // File lists (GraphQL)
    listShopifyFiles(admin, "MODEL3D"),
    listShopifyFiles(admin, "IMAGE"),
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
          include: { hotspots: { orderBy: { sortOrder: "asc" } } },
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

  // ── Phase 2: queries that depend on Phase 1 results ──
  const viewerType = (config?.viewerType || "MODEL_3D") as "MODEL_3D" | "IMAGE_360";

  const [cachedTitles, resolvedAssets, imageSequenceFrames] = await Promise.all([
    // Resolve product titles for copy-from list (DB — needs configuredProducts)
    prisma.productCache.findMany({
      where: {
        shopId: shop.id,
        shopifyProductGid: { in: configuredProducts.map((c) => c.shopifyProductGid) },
      },
      select: { shopifyProductGid: true, title: true },
    }),

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

  const titleMap = new Map(cachedTitles.map((c) => [c.shopifyProductGid, c.title]));
  const copyableProducts = configuredProducts
    .filter((c) => c.shopifyProductGid !== productGid)
    .map((c) => ({
      gid: c.shopifyProductGid,
      title: titleMap.get(c.shopifyProductGid) || c.shopifyProductGid.replace("gid://shopify/Product/", "Product #"),
      viewerType: c.viewerType || "MODEL_3D",
      status: c.status,
    }));

  const productFeaturedImageUrl = selectedProduct?.featuredMedia?.preview?.image?.url ?? null;

  return {
    shop: session.shop,
    darkMode: shop.darkMode ?? false,
    shopLogoUrl: shop.logoUrl ?? null,
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
    copyableProducts,
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
  const [mainTab, setMainTab] = useState<"edit" | "preview">("edit");
  const [previewBg, setPreviewBg] = useState<string | null>(null);
  const isDarkMode = loaderData.darkMode;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [toastMessage, setToastMessage] = useState(loaderData.flash || "");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saveStatusNow, setSaveStatusNow] = useState(Date.now());

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
  const [showPresetBrowser, setShowPresetBrowser] = useState(false);
  const [showPresetSaveDialog, setShowPresetSaveDialog] = useState(false);
  const [presetSaveHotspots3d, setPresetSaveHotspots3d] = useState<EditableHotspot[]>([]);
  const [presetSaveHotspots360, setPresetSaveHotspots360] = useState<Hotspot360[]>([]);
  const [presetSaveName, setPresetSaveName] = useState("");

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

  // Handle actionFetcher (publish/pull) responses
  useEffect(() => {
    if (actionFetcher.state !== "idle" || !actionFetcher.data) return;
    if (actionFetcher.data.message) {
      setToastMessage(actionFetcher.data.message);
    }
    if (actionFetcher.data.reload) {
      revalidator.revalidate();
    }
  }, [actionFetcher.state, actionFetcher.data, revalidator]);

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

  const submitPull = useCallback(() => {
    if (!loaderData.selectedProduct) return;
    if (isDirty) {
      const proceed = window.confirm(
        "Pulling from Shopify will overwrite your unsaved changes. Continue?",
      );
      if (!proceed) return;
    }
    const fd = new FormData();
    fd.set("intent", "pull");
    fd.set("fetcherMode", "1");
    fd.set("productGid", loaderData.productGid);
    fd.set("q", loaderData.q);
    actionFetcher.submit(fd, { method: "post", action: "/api/sdl3d/config" });
  }, [loaderData, actionFetcher, isDirty]);

  const submitCopyConfig = useCallback((sourceGid: string) => {
    if (!loaderData.selectedProduct) return;
    const fd = new FormData();
    fd.set("intent", "copyConfig");
    fd.set("fetcherMode", "1");
    fd.set("productGid", loaderData.productGid);
    fd.set("q", loaderData.q);
    fd.set("sourceProductGid", sourceGid);
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
        setRightTab("hotspots");
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
        setRightTab("hotspots");
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
  const handlePreviewHotspotSelect = useCallback((id: string | null) => {
    setSelectedHotspotId(id);
    if (id) {
      setRightTab("hotspots");
    }
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

  const handleApplyPresets = useCallback((appliedPresets: PresetSummary[]) => {
    let added = 0;
    const fc = loaderData.config.frameCount || 0;

    if (viewerType === "IMAGE_360") {
      // Applying to 360 mode: use 360 hotspots directly, convert 3D hotspots
      let new360: Hotspot360[] = [];
      for (const preset of appliedPresets) {
        // First try native 360 hotspots
        if (preset.hotspotsJson360) {
          try {
            const parsed = JSON.parse(preset.hotspotsJson360);
            if (Array.isArray(parsed) && parsed.length > 0) {
              new360 = new360.concat(parsed.map((h: Partial<Hotspot360>) => ({
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
              })));
              continue;
            }
          } catch { /* fall through to 3D conversion */ }
        }
        // Convert 3D hotspots to 360 format (shared fields carry over, position defaults)
        try {
          const parsed = JSON.parse(preset.hotspotsJson);
          if (Array.isArray(parsed)) {
            new360 = new360.concat(parsed.map((h: Record<string, unknown>) => ({
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
            })));
          }
        } catch { /* ignore */ }
      }
      if (new360.length > 0) {
        added = new360.length;
        const merged = [...hotspots360, ...new360].map((h, i) => ({ ...h, sortOrder: i + 1 }));
        setHotspots360(merged);
      }
    } else {
      // Applying to 3D mode: use 3D hotspots directly, convert 360 hotspots
      let new3d: EditableHotspot[] = [];
      for (const preset of appliedPresets) {
        // First try native 3D hotspots
        try {
          const parsed = JSON.parse(preset.hotspotsJson);
          if (Array.isArray(parsed) && parsed.length > 0) {
            new3d = new3d.concat(parsed.map((h: Partial<EditableHotspot>) => ({
              id: makeId(),
              sortOrder: 0,
              visible: Boolean(h.visible ?? true),
              title: String(h.title ?? "Hotspot"),
              body: String(h.body ?? ""),
              icon: h.icon ?? "plus",
              style: String(h.style ?? "card"),
              color: h.color ?? "#3b82f6",
              position: String(h.position ?? "0m 0m 0m"),
              normal: h.normal ?? null,
              focusTarget: h.focusTarget ?? null,
              focusOrbit: h.focusOrbit ?? null,
              ctaLabel: h.ctaLabel ?? null,
              ctaUrl: h.ctaUrl ?? null,
            })));
            continue;
          }
        } catch { /* fall through to 360 conversion */ }
        // Convert 360 hotspots to 3D format (shared fields carry over, position defaults)
        if (preset.hotspotsJson360) {
          try {
            const parsed = JSON.parse(preset.hotspotsJson360);
            if (Array.isArray(parsed)) {
              new3d = new3d.concat(parsed.map((h: Record<string, unknown>) => ({
                id: makeId(),
                sortOrder: 0,
                visible: Boolean(h.visible ?? true),
                title: String(h.title ?? "Hotspot"),
                body: String(h.body ?? ""),
                icon: "plus",
                style: String(h.style ?? "card"),
                color: (h.color as string) ?? "#3b82f6",
                position: "0m 0m 0m",
                normal: null,
                focusTarget: null,
                focusOrbit: null,
                ctaLabel: (h.ctaLabel as string) ?? null,
                ctaUrl: (h.ctaUrl as string) ?? null,
              })));
            }
          } catch { /* ignore */ }
        }
      }
      if (new3d.length > 0) {
        added = new3d.length;
        const merged = [...hotspots, ...new3d];
        setHotspots(normalizeSortOrder(merged));
      }
    }

    if (added > 0) {
      setToastMessage(`Applied ${added} hotspot${added === 1 ? "" : "s"} from ${appliedPresets.length} preset${appliedPresets.length === 1 ? "" : "s"}.`);
    }
  }, [hotspots, hotspots360, viewerType, loaderData.config.frameCount]);

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
            setToastMessage("Invalid config file. Expected SDL 3D Hotspots export format.");
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

  return (
    <div className="sdl-editor" data-theme={isDarkMode ? "dark" : "light"}>
      <div className="sdl-editor__inner">
        {toastMessage ? (
          <div className={`sdl-toast ${toastTone === "success" ? "sdl-toast--success" : "sdl-toast--error"}`}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.8 }}>
                {toastTone === "success" ? "Done" : "Issue"}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{toastMessage}</div>
            </div>
            <button
              type="button"
              onClick={() => setToastMessage("")}
              className="sdl-btn sdl-btn--ghost sdl-btn--sm"
              style={{ padding: 0, lineHeight: 1 }}
            >
              ✕
            </button>
          </div>
        ) : null}

        <nav className="sdl-breadcrumb">
          <Link to="/app">Dashboard</Link>
          <span className="sdl-breadcrumb__sep">/</span>
          {loaderData.selectedProduct ? (
            <>
              <span className="sdl-breadcrumb__current">{loaderData.selectedProduct.title}</span>
              <span className="sdl-breadcrumb__sep">/</span>
              <span className="sdl-breadcrumb__current">Editor</span>
            </>
          ) : (
            <span className="sdl-breadcrumb__current">Editor</span>
          )}
        </nav>

        <div className={`sdl-editor__grid ${sidebarCollapsed ? "sdl-editor__grid--collapsed" : ""}`}>
          <aside className={`sdl-editor__sidebar ${sidebarCollapsed ? "sdl-editor__sidebar--collapsed" : ""}`}>
            <button
              type="button"
              className="sdl-sidebar-toggle"
              onClick={() => setSidebarCollapsed((c) => !c)}
              title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            >
              {sidebarCollapsed ? "▶" : "◀"}
            </button>
            {!sidebarCollapsed && (
              <Sdl3dEditorSidebar
                loaderData={loaderData}
                validation={validation}
                readyTone={readyTone}
                enabled={enabled}
                viewerType={viewerType}
                hotspotsJson={hotspotsJson}
                hotspotsJson360={hotspotsJson360Memo}
                viewerSettingsJson={viewerSettingsJson}
                copyableProducts={loaderData.copyableProducts}
                onEnabledChange={setEnabled}
                onCopyConfig={submitCopyConfig}
                confirmDiscardChanges={confirmDiscardChanges}
                onOpenProductBrowser={() => setShowProductBrowser(true)}
              />
            )}
          </aside>

          <main className="sdl-main-panel">
            {loaderData.selectedProduct ? (
              <>
                <div className="sdl-main-tabs">
                  <button
                    type="button"
                    className={`sdl-main-tab ${mainTab === "edit" ? "sdl-main-tab--active" : ""}`}
                    onClick={() => setMainTab("edit")}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={`sdl-main-tab ${mainTab === "preview" ? "sdl-main-tab--active" : ""}`}
                    onClick={() => setMainTab("preview")}
                  >
                    Preview
                  </button>
                </div>

                {mainTab === "edit" ? (
                  <>
                    <section className="sdl-card">
                      <div className="sdl-card__header">
                        <div>
                          <div className="sdl-card__title">
                            {viewerType === "IMAGE_360" ? "360° Image Viewer" : "3D Model Viewer"}
                          </div>
                          <div className="sdl-card__subtitle">
                            {viewerType === "IMAGE_360"
                              ? "Drag to rotate through frames. Click to place hotspots."
                              : "Place hotspots, capture camera values, and review the live result."}
                          </div>
                        </div>
                        <div className="sdl-viewer-type-toggle">
                          <button
                            type="button"
                            className={`sdl-viewer-type-btn ${viewerType === "MODEL_3D" ? "sdl-viewer-type-btn--active" : ""}`}
                            onClick={() => setViewerType("MODEL_3D")}
                          >
                            3D Model
                          </button>
                          <button
                            type="button"
                            className={`sdl-viewer-type-btn ${viewerType === "IMAGE_360" ? "sdl-viewer-type-btn--active" : ""}`}
                            onClick={() => setViewerType("IMAGE_360")}
                          >
                            360° Images
                          </button>
                        </div>
                      </div>

                      {viewerType === "IMAGE_360" ? (
                        <Sdl3dImageSequencePreview
                          frames={loaderData.imageSequenceFrames}
                          hotspots={hotspots360}
                          selectedHotspotId={selectedHotspotId}
                          viewerSettingsJson={viewerSettingsJson}
                          onSelectHotspot={handlePreviewHotspotSelect}
                          onPlaceHotspot={(frame, x, y) => {
                            if (selectedHotspotId) {
                              // Update keyframe on selected hotspot
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
                    </section>

                    <section className="sdl-card">
                      <div className="sdl-card__header">
                        <div>
                          <div className="sdl-card__title">Advanced JSON</div>
                          <div className="sdl-card__subtitle">Developer fallback for direct JSON editing.</div>
                        </div>
                      </div>
                      <details>
                        <summary className="sdl-summary">Open JSON editor</summary>
                        <div className="sdl-json-grid">
                          <div>
                            <label className="sdl-label">Viewer settings JSON</label>
                            <textarea
                              className="sdl-textarea"
                              value={viewerSettingsJson}
                              onChange={(e) => setViewerSettingsJson(e.target.value)}
                              rows={16}
                            />
                          </div>
                          <div>
                            <label className="sdl-label">
                              {viewerType === "IMAGE_360" ? "360° Hotspots JSON" : "Hotspots JSON"}
                            </label>
                            <textarea
                              className="sdl-textarea sdl-textarea--readonly"
                              value={viewerType === "IMAGE_360" ? hotspotsJson360Memo : hotspotsJson}
                              readOnly
                              rows={16}
                            />
                          </div>
                        </div>
                      </details>
                    </section>
                  </>
                ) : (
                  <section className="sdl-card">
                    <div className="sdl-card__header">
                      <div>
                        <div className="sdl-card__title">Storefront preview</div>
                        <div className="sdl-card__subtitle">See exactly what your customers will see. Updates live as you edit.</div>
                      </div>
                      <div className="sdl-preview-controls">
                        <label className="sdl-preview-controls__bg">
                          <span className="sdl-text-muted" style={{ fontSize: 11, fontWeight: 700 }}>BG</span>
                          <input
                            type="color"
                            value={previewBg || "#ffffff"}
                            onChange={(e) => setPreviewBg(e.target.value)}
                            className="sdl-preview-controls__color-input"
                          />
                          {previewBg ? (
                            <button
                              type="button"
                              className="sdl-btn sdl-btn--ghost sdl-btn--sm"
                              onClick={() => setPreviewBg(null)}
                              style={{ padding: "2px 6px", fontSize: 11 }}
                            >
                              Reset
                            </button>
                          ) : null}
                        </label>
                      </div>
                    </div>
                    <StorefrontPreview
                      modelSourceUrl={loaderData.resolvedAssets.modelSourceUrl}
                      posterUrl={loaderData.resolvedAssets.posterUrl}
                      viewerSettingsJson={viewerSettingsJson}
                      hotspots={hotspots}
                      enabled={enabled}
                      backgroundOverride={previewBg}
                    />
                  </section>
                )}
              </>
            ) : (
              <section className="sdl-card">
                <div className="sdl-card__header">
                  <div>
                    <div className="sdl-card__title">Start by choosing a product</div>
                    <div className="sdl-card__subtitle">The live preview will appear here once a product is selected.</div>
                  </div>
                </div>
                <div className="sdl-empty-state">
                  Search for a product on the left, then open it to configure the
                  model, poster, viewer settings, and hotspots.
                </div>
              </section>
            )}
          </main>

          <aside className="sdl-editor__inspector">
            {loaderData.selectedProduct ? (
              <section className="sdl-card">
                <div className="sdl-card__header">
                  <div>
                    <div className="sdl-card__title">Inspector</div>
                    <div className="sdl-card__subtitle">Assets, viewer controls, and hotspot editing.</div>
                  </div>
                </div>
                <div className="sdl-inspector-tabs">
                  <button
                    type="button"
                    className={`sdl-tab ${rightTab === "upload" ? "sdl-tab--active" : ""}`}
                    onClick={() => setRightTab("upload")}
                  >
                    Assets
                  </button>
                  <button
                    type="button"
                    className={`sdl-tab ${rightTab === "viewer" ? "sdl-tab--active" : ""}`}
                    onClick={() => setRightTab("viewer")}
                  >
                    Viewer
                  </button>
                  <button
                    type="button"
                    className={`sdl-tab ${rightTab === "hotspots" ? "sdl-tab--active" : ""}`}
                    onClick={() => setRightTab("hotspots")}
                  >
                    Hotspots
                  </button>
                  <button
                    type="button"
                    className={`sdl-tab ${rightTab === "advanced" ? "sdl-tab--active" : ""}`}
                    onClick={() => setRightTab("advanced")}
                  >
                    Advanced
                  </button>
                </div>

                {rightTab === "upload" ? (
                  <div className="sdl-inspector-content">
                    {viewerType === "MODEL_3D" ? (
                      <>
                        <div className="sdl-subtle-card">
                          <div className="sdl-file-section__title">Model file</div>
                          <button
                            type="button"
                            className="sdl-file-trigger"
                            onClick={() => setShowModelBrowser(true)}
                          >
                            <div className="sdl-file-trigger__thumb">
                              {selectedModelFile?.previewUrl ? (
                                <img src={selectedModelFile.previewUrl} alt="" />
                              ) : (
                                <span style={{ fontSize: 18, opacity: 0.4 }}>&#128230;</span>
                              )}
                            </div>
                            <div className="sdl-file-trigger__label">
                              {selectedModelFile ? (
                                <>
                                  <div className="sdl-file-trigger__name">{selectedModelFile.name}</div>
                                  <div className="sdl-file-trigger__meta">{selectedModelFile.typeName} &middot; {selectedModelFile.fileStatus}</div>
                                </>
                              ) : (
                                <>
                                  <div className="sdl-file-trigger__name">No model selected</div>
                                  <div className="sdl-file-trigger__meta">Click to browse or upload</div>
                                </>
                              )}
                            </div>
                            <div className="sdl-file-trigger__action">Browse</div>
                          </button>
                        </div>

                        <div className="sdl-subtle-card">
                          <div className="sdl-file-section__title">Poster file</div>
                          <button
                            type="button"
                            className="sdl-file-trigger"
                            onClick={() => setShowPosterBrowser(true)}
                          >
                            <div className="sdl-file-trigger__thumb">
                              {selectedPosterFile?.previewUrl ? (
                                <img src={selectedPosterFile.previewUrl} alt="" />
                              ) : loaderData.productFeaturedImageUrl ? (
                                <img src={loaderData.productFeaturedImageUrl} alt="" />
                              ) : (
                                <span style={{ fontSize: 18, opacity: 0.4 }}>&#128444;</span>
                              )}
                            </div>
                            <div className="sdl-file-trigger__label">
                              {selectedPosterFile ? (
                                <>
                                  <div className="sdl-file-trigger__name">{selectedPosterFile.name}</div>
                                  <div className="sdl-file-trigger__meta">{selectedPosterFile.typeName} &middot; {selectedPosterFile.fileStatus}</div>
                                </>
                              ) : (
                                <>
                                  <div className="sdl-file-trigger__name">No poster selected</div>
                                  <div className="sdl-file-trigger__meta">{loaderData.productFeaturedImageUrl ? "Using product image as fallback" : "Click to browse or upload"}</div>
                                </>
                              )}
                            </div>
                            <div className="sdl-file-trigger__action">Browse</div>
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="sdl-subtle-card">
                          <div className="sdl-file-section__title">360° Image Sequence</div>
                          <button
                            type="button"
                            className="sdl-file-trigger"
                            onClick={() => setShowSequenceBrowser(true)}
                          >
                            <div className="sdl-file-trigger__thumb">
                              <span style={{ fontSize: 18, opacity: 0.4 }}>&#128247;</span>
                            </div>
                            <div className="sdl-file-trigger__label">
                              <div className="sdl-file-trigger__name">
                                {loaderData.config.frameCount > 0
                                  ? `${loaderData.config.frameCount} frames uploaded`
                                  : "No frames uploaded"}
                              </div>
                              <div className="sdl-file-trigger__meta">Click to browse, upload images, or upload ZIP</div>
                            </div>
                            <div className="sdl-file-trigger__action">Browse</div>
                          </button>
                        </div>

                        <div className="sdl-subtle-card">
                          <div className="sdl-file-section__title">Poster file</div>
                          <button
                            type="button"
                            className="sdl-file-trigger"
                            onClick={() => setShowPosterBrowser(true)}
                          >
                            <div className="sdl-file-trigger__thumb">
                              {selectedPosterFile?.previewUrl ? (
                                <img src={selectedPosterFile.previewUrl} alt="" />
                              ) : loaderData.productFeaturedImageUrl ? (
                                <img src={loaderData.productFeaturedImageUrl} alt="" />
                              ) : (
                                <span style={{ fontSize: 18, opacity: 0.4 }}>&#128444;</span>
                              )}
                            </div>
                            <div className="sdl-file-trigger__label">
                              {selectedPosterFile ? (
                                <>
                                  <div className="sdl-file-trigger__name">{selectedPosterFile.name}</div>
                                  <div className="sdl-file-trigger__meta">{selectedPosterFile.typeName} &middot; {selectedPosterFile.fileStatus}</div>
                                </>
                              ) : (
                                <>
                                  <div className="sdl-file-trigger__name">No poster selected</div>
                                  <div className="sdl-file-trigger__meta">{loaderData.productFeaturedImageUrl ? "Using product image as fallback" : "Click to browse or upload"}</div>
                                </>
                              )}
                            </div>
                            <div className="sdl-file-trigger__action">Browse</div>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : null}

                {rightTab === "viewer" ? (
                  <Sdl3dViewerSettingsEditor
                    valueJson={viewerSettingsJson}
                    onChangeJson={setViewerSettingsJson}
                  />
                ) : null}

                {rightTab === "advanced" ? (
                  <>
                  <Sdl3dViewerSettingsEditor
                    valueJson={viewerSettingsJson}
                    onChangeJson={setViewerSettingsJson}
                    advanced
                  />
                  <details className="sdl-collapsible" style={{ marginTop: 12 }}>
                    <summary>Import / Export JSON</summary>
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button type="button" onClick={handleImportConfig} className="sdl-btn sdl-btn--sm" style={{ flex: 1 }}>
                        Import JSON
                      </button>
                      <button type="button" onClick={handleExportConfig} className="sdl-btn sdl-btn--sm" style={{ flex: 1 }}>
                        Export JSON
                      </button>
                    </div>
                  </details>
                  </>
                ) : null}

                {rightTab === "hotspots" ? (
                  <>
                  <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                    <button
                      type="button"
                      className="sdl-btn sdl-btn--sm"
                      disabled={!canUndo}
                      onClick={handleUndo}
                      title="Undo (Ctrl+Z)"
                    >
                      Undo
                    </button>
                    <button
                      type="button"
                      className="sdl-btn sdl-btn--sm"
                      disabled={!canRedo}
                      onClick={handleRedo}
                      title="Redo (Ctrl+Shift+Z)"
                    >
                      Redo
                    </button>
                  </div>
                  {viewerType === "IMAGE_360" ? (
                    <Sdl3dHotspot360Editor
                      hotspots={hotspots360}
                      selectedHotspotId={selectedHotspotId}
                      frameCount={loaderData.config.frameCount}
                      currentFrame={currentFrame360}
                      onChange={setHotspots360}
                      onSelectHotspot={handlePreviewHotspotSelect}
                      onSaveAsPreset={handleSave360HotspotsAsPreset}
                      onApplyPreset={() => setShowPresetBrowser(true)}
                    />
                  ) : (
                    <Sdl3dHotspotEditor
                      hotspots={hotspots}
                      selectedHotspotId={selectedHotspotId}
                      onChange={setHotspots}
                      onSelectHotspot={handlePreviewHotspotSelect}
                      onSaveAsPreset={handleSaveHotspotsAsPreset}
                      onApplyPreset={() => setShowPresetBrowser(true)}
                    />
                  )}
                  </>
                ) : null}
              </section>
            ) : (
              <section className="sdl-card">
                <div className="sdl-card__header">
                  <div>
                    <div className="sdl-card__title">Editor panel</div>
                    <div className="sdl-card__subtitle">Tabs appear here once a product is selected.</div>
                  </div>
                </div>
                <div className="sdl-empty-state">
                  Upload controls, viewer settings, and hotspots will appear here.
                </div>
              </section>
            )}
          </aside>
        </div>

        {loaderData.selectedProduct ? (
          <>
          <div className="sdl-action-bar">
            <div className="sdl-action-bar__left">
              <span className={`sdl-badge sdl-badge--${saveFetcher.state !== "idle" ? "info" : isDirty ? "warning" : "success"}`}>
                {saveFetcher.state !== "idle"
                  ? "Saving…"
                  : isDirty
                    ? "Unsaved changes"
                    : "Saved"}
              </span>
              {!isDirty && lastSavedAt ? (
                <span className="sdl-text-muted" style={{ fontSize: 12 }}>
                  {formatSavedAgo(lastSavedAt, saveStatusNow)}
                </span>
              ) : null}
              {publishDisabled ? (
                <span className="sdl-text-muted" style={{ fontSize: 12 }}>
                  {isDirty
                    ? "Save changes before publishing."
                    : "Fix validation errors before publishing."}
                </span>
              ) : null}
            </div>
            <div className="sdl-action-bar__right">
              <button
                type="button"
                onClick={submitPull}
                className="sdl-btn sdl-btn--ghost sdl-btn--sm"
                disabled={isActionBusy}
                title="Overwrite this draft with the latest values from Shopify metafields."
              >
                {isActionBusy && actionFetcher.formData?.get("intent") === "pull" ? "Pulling…" : "Pull from Shopify"}
              </button>
              <button type="button" onClick={forceSave} className="sdl-btn sdl-btn--primary sdl-btn--sm" disabled={!isDirty || saveFetcher.state !== "idle"}>
                {saveFetcher.state !== "idle" ? "Saving\u2026" : "Save draft"}
              </button>
              <button
                type="button"
                onClick={submitPublish}
                className="sdl-btn sdl-btn--success sdl-btn--sm"
                disabled={publishDisabled || isActionBusy}
              >
                {isActionBusy && actionFetcher.formData?.get("intent") === "publish" ? "Publishing…" : "Publish"}
              </button>
            </div>
          </div>
          </>
        ) : null}
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

      {/* ── Save Hotspots as Preset Dialog ── */}
      {showPresetSaveDialog && (() => {
        const saveCount = presetSaveHotspots3d.length + presetSaveHotspots360.length;
        return (
        <div className="sdl-modal-overlay" onClick={() => setShowPresetSaveDialog(false)}>
          <div className="sdl-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="sdl-modal__header">
              <div>
                <div className="sdl-modal__title">Save Hotspots as Preset</div>
                <div className="sdl-modal__subtitle">
                  {saveCount} hotspot{saveCount === 1 ? "" : "s"} will be saved.
                </div>
              </div>
              <button type="button" className="sdl-modal__close" onClick={() => setShowPresetSaveDialog(false)}>
                &times;
              </button>
            </div>
            <div className="sdl-modal__body" style={{ padding: 16 }}>
              <actionFetcher.Form
                method="post"
                action="/api/sdl3d/presets"
                onSubmit={() => {
                  setShowPresetSaveDialog(false);
                  setToastMessage("Saving preset...");
                }}
              >
                <input type="hidden" name="fetcherMode" value="1" />
                <input type="hidden" name="intent" value="saveAsPreset" />
                <input type="hidden" name="hotspotsJson" value={JSON.stringify(presetSaveHotspots3d)} />
                {presetSaveHotspots360.length > 0 && (
                  <input type="hidden" name="hotspotsJson360" value={JSON.stringify(presetSaveHotspots360)} />
                )}
                <div className="sdl-hotspot-field">
                  <label>Preset name</label>
                  <input
                    className="sdl-input"
                    name="presetName"
                    value={presetSaveName}
                    onChange={(e) => setPresetSaveName(e.target.value)}
                    placeholder="My hotspot preset"
                    autoFocus
                  />
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                  <button type="button" className="sdl-btn sdl-btn--sm" onClick={() => setShowPresetSaveDialog(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="sdl-btn sdl-btn--primary sdl-btn--sm" disabled={!presetSaveName.trim()}>
                    Save Preset
                  </button>
                </div>
              </actionFetcher.Form>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
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
    <div className="sdl-editor" data-theme="light">
      <div style={{ maxWidth: 600, margin: "60px auto", padding: 24, textAlign: "center" }}>
        <div className="sdl-card">
          <div className="sdl-card__header">
            <div>
              <div className="sdl-card__title">Editor error</div>
              <div className="sdl-card__subtitle">{message}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <a href="/app/sdl3d/editor" className="sdl-btn sdl-btn--primary">Reload editor</a>
            <a href="/app" className="sdl-btn">Back to dashboard</a>
          </div>
        </div>
      </div>
    </div>
  );
}