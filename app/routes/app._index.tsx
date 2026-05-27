/**
 * Dashboard / Home — Polaris migration (Slice 5C PR #4).
 *
 * Mid-complexity surface with five distinct regions per the plan:
 *   - Page header with "Open Editor" primaryAction (replaces the hero card)
 *   - InlineGrid of four stat Cards
 *   - Filters component (search + status filter)
 *   - ResourceList of product configs with status Badges
 *   - Sidebar (Layout.Section variant="oneThird") for Recent Sync Activity
 *     + Quick Actions
 *
 * Plus: onboarding wizard rewritten as a single Polaris Modal stepping
 * through the existing 5 steps with a ProgressBar. Polaris handles
 * aria-modal, focus-trap, and return-focus out of the box.
 */
import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useFetcher, useNavigate, useRouteError, isRouteErrorResponse } from "react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  ChoiceList,
  EmptyState,
  Filters,
  Frame,
  InlineGrid,
  InlineStack,
  Layout,
  Modal,
  Page,
  ProgressBar,
  ResourceItem,
  ResourceList,
  Text,
  Thumbnail,
  Toast,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { adminGraphql } from "../lib/sdl3d-graphql.server";

/* ───────────────────── loader ───────────────────── */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  if (!shop || !shop.onboardingComplete) {
    return {
      needsOnboarding: true,
      configs: [],
      syncRuns: [],
      totalConfigs: 0,
      publishedCount: 0,
      enabledCount: 0,
      availableStorages: [],
      defaultStorageId: null,
      deadLetterCaptures: [],
    };
  }

  const [configs, syncRuns, totalConfigs, publishedCount, enabledCount, allStorages, deadLetterCaptures] = await Promise.all([
    prisma.productConfig.findMany({
      where: { shopId: shop.id },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: {
        _count: { select: { hotspots: true } },
        // Slice 8 storage column — per-product preferred storage (if set)
        // + the most recent successful capture (its storage = what the
        // product's frames actually live on right now). The display logic
        // resolves the effective storage from these in `enrichedConfigs`.
        preferredStorage: { select: { id: true, bucket: true, provider: true } },
        captures: {
          where: { status: "SUCCESS" },
          orderBy: { completedAt: "desc" },
          take: 1,
          select: {
            storage: { select: { id: true, bucket: true, provider: true } },
          },
        },
      },
    }),
    prisma.syncRun.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.productConfig.count({ where: { shopId: shop.id } }),
    prisma.productConfig.count({ where: { shopId: shop.id, status: "PUBLISHED" } }),
    prisma.productConfig.count({ where: { shopId: shop.id, enabled: true } }),
    prisma.shopStorage.findMany({
      where: { shopId: shop.id },
      orderBy: [{ isDefault: "desc" }, { provider: "asc" }],
      select: { id: true, bucket: true, provider: true, isDefault: true },
    }),
    // Failed/cancelled captures — moved here from Settings 2026-05-27 so
    // errors live where merchants actually look. Hidden when empty; up
    // to 20 most recent so the dashboard never grows unbounded.
    prisma.capture.findMany({
      where: {
        productConfig: { shopId: shop.id },
        status: { in: ["FAILED", "CANCELLED"] },
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: {
        productConfig: { select: { shopifyProductGid: true } },
      },
    }),
  ]);

  const defaultStorage = allStorages.find((s) => s.isDefault) ?? null;

  const productGids = configs.map((c) => c.shopifyProductGid);
  const cachedProducts = await prisma.productCache.findMany({
    where: { shopId: shop.id, shopifyProductGid: { in: productGids } },
  });
  type CachedEntry = {
    title: string;
    imageUrl: string | null;
    imageAlt: string | null;
  };
  const cacheMap = new Map<string, CachedEntry>(
    cachedProducts.map((p) => [
      p.shopifyProductGid,
      { title: p.title, imageUrl: p.imageUrl, imageAlt: p.imageAlt },
    ]),
  );
  // GIDs we know to be deleted/missing on Shopify — we won't keep retrying
  // their resolve every page load. Populated below from the resolve response.
  const missingGids = new Set<string>();

  // Resolve from Shopify when either (a) we've never cached this GID, or
  // (b) we cached the title but the image data is pre-5C-fix (null). Caching
  // image data means subsequent loads skip this fetch entirely.
  //
  // Filter out malformed GIDs first — Shopify's GraphQL rejects the whole
  // batch if any single id is invalid (e.g. test rows with placeholder
  // ids like "<real-id>"), and one bad row would otherwise leave every other
  // product unresolved.
  const VALID_PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;
  for (const gid of productGids) {
    if (!VALID_PRODUCT_GID.test(gid)) missingGids.add(gid);
  }
  const needsResolve = productGids.filter((gid) => {
    if (!VALID_PRODUCT_GID.test(gid)) return false;
    const cached = cacheMap.get(gid);
    return !cached || cached.imageUrl === null;
  });
  if (needsResolve.length > 0) {
    try {
      const data = await adminGraphql<{
        nodes: Array<
          | {
              __typename: "Product";
              id: string;
              title: string;
              handle: string;
              status: string;
              featuredImage: { url: string; altText: string | null } | null;
            }
          | { __typename: string; id: string }
          | null
        >;
      }>(
        admin,
        `query ResolveHomeProducts($ids: [ID!]!) {
          nodes(ids: $ids) {
            __typename
            ... on Product {
              id
              title
              handle
              status
              featuredImage { url altText }
            }
          }
        }`,
        { ids: needsResolve },
      );
      const fresh: Array<{
        shopifyProductGid: string;
        title: string;
        handle: string | null;
        status: string | null;
        imageUrl: string | null;
        imageAlt: string | null;
      }> = [];
      const resolvedIds = new Set<string>();
      for (const node of data.nodes) {
        if (node && node.__typename === "Product" && "title" in node) {
          resolvedIds.add(node.id);
          const imageUrl = node.featuredImage?.url ?? null;
          const imageAlt = node.featuredImage?.altText ?? null;
          cacheMap.set(node.id, { title: node.title, imageUrl, imageAlt });
          fresh.push({
            shopifyProductGid: node.id,
            title: node.title,
            handle: node.handle ?? null,
            status: node.status ?? null,
            imageUrl,
            imageAlt,
          });
        }
      }
      // Track any IDs we asked for that came back null — those products were
      // deleted on Shopify but still have ProductConfigs in our DB.
      for (const gid of needsResolve) {
        if (!resolvedIds.has(gid)) missingGids.add(gid);
      }
      if (fresh.length > 0) {
        await Promise.all(
          fresh.map((p) =>
            prisma.productCache.upsert({
              where: {
                shopId_shopifyProductGid: {
                  shopId: shop.id,
                  shopifyProductGid: p.shopifyProductGid,
                },
              },
              update: {
                title: p.title,
                handle: p.handle,
                status: p.status,
                imageUrl: p.imageUrl,
                imageAlt: p.imageAlt,
              },
              create: { shopId: shop.id, ...p },
            }),
          ),
        );
      }
    } catch (err) {
      console.warn("[home] product resolve failed; falling back to short IDs:", err);
    }
  }

  // Pretty fallback for products that have never been resolved OR were
  // deleted on Shopify: extract the numeric portion from the GID so we show
  // "Product 9099..." instead of the full "gid://shopify/Product/9099...".
  const shortId = (gid: string) => {
    const tail = gid.split("/").pop() ?? gid;
    return `Product ${tail}`;
  };

  const enrichedConfigs = configs.map((c) => {
    const cached = cacheMap.get(c.shopifyProductGid);
    const isMissing = missingGids.has(c.shopifyProductGid) && !cached;
    // Effective storage resolution (Slice 8 dashboard polish):
    //   preferredStorage (per-product override, set via dashboard Modal)
    //   → most recent SUCCESS capture's storage (what frames live on now)
    //   → shop's default storage (fallback for new captures)
    //   → null (no storage configured yet — Settings → Storage prompts)
    const lastCaptureStorage = c.captures[0]?.storage ?? null;
    const effective = c.preferredStorage ?? lastCaptureStorage ?? defaultStorage;
    return {
      id: c.id,
      shopifyProductGid: c.shopifyProductGid,
      productTitle: cached?.title ?? shortId(c.shopifyProductGid),
      productImageUrl: cached?.imageUrl ?? null,
      productImageAlt: cached?.imageAlt ?? null,
      productMissing: isMissing,
      status: c.status,
      enabled: c.enabled,
      sourceMode: c.sourceMode,
      hasModel: Boolean(c.modelFileShopifyGid),
      hotspotCount: c._count.hotspots,
      updatedAt: c.updatedAt.toISOString(),
      preferredStorageId: c.preferredStorageId,
      effectiveStorage: effective
        ? { id: effective.id, bucket: effective.bucket, provider: effective.provider }
        : null,
      effectiveStorageSource: c.preferredStorage
        ? ("override" as const)
        : lastCaptureStorage
          ? ("lastCapture" as const)
          : defaultStorage
            ? ("default" as const)
            : ("none" as const),
    };
  });

  return {
    needsOnboarding: false,
    configs: enrichedConfigs,
    syncRuns: syncRuns.map((r) => ({
      id: r.id,
      status: r.status,
      direction: r.direction,
      message: r.message,
      createdAt: r.createdAt.toISOString(),
    })),
    totalConfigs,
    publishedCount,
    enabledCount,
    availableStorages: allStorages,
    defaultStorageId: defaultStorage?.id ?? null,
    deadLetterCaptures: deadLetterCaptures.map((c) => ({
      id: c.id,
      status: c.status as "FAILED" | "CANCELLED",
      productGid: c.productConfig.shopifyProductGid,
      errorMessage: c.errorMessage,
      attempts: c.attempts,
      updatedAt: c.updatedAt.toISOString(),
    })),
  };
};

/* ───────────────────── component dispatch ───────────────────── */

export default function DashboardPage() {
  const data = useLoaderData<typeof loader>();

  if (data.needsOnboarding) {
    return <OnboardingModal />;
  }

  return <Dashboard data={data} />;
}

/* ───────────────────── onboarding ───────────────────── */

const STEPS = [
  {
    id: "welcome",
    title: "Welcome to SDL 3D Hotspots",
    subtitle: "Add interactive 3D viewers with clickable hotspots to your products.",
  },
  {
    id: "pick-product",
    title: "Start with a product",
    subtitle: "Open the editor and search for any product in your store.",
  },
  {
    id: "upload-model",
    title: "Add a 3D model or images",
    subtitle: "Upload a GLB file for a 3D model, or a set of product photos for a 360° turntable.",
  },
  {
    id: "add-hotspot",
    title: "Place interactive hotspots",
    subtitle: "Click anywhere on your model to add a hotspot. Add titles, descriptions, and call-to-action links.",
  },
  {
    id: "publish",
    title: "Publish to your storefront",
    subtitle: "Hit publish to sync your config to Shopify metafields. The theme block renders it automatically.",
  },
] as const;

function OnboardingModal() {
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const isBusy = fetcher.state !== "idle";

  // Slice 9 PR #2 — once "Open editor to upload" fires we need to wait for
  // the completeOnboarding mutation to succeed (the dashboard's loader
  // checks `Shop.onboardingComplete`; navigating before the row updates
  // would just re-render the wizard). The fetcher resolves to
  // `data.ok === true` on success — we navigate inside the effect below.
  const [pendingUploadNav, setPendingUploadNav] = useState(false);
  useEffect(() => {
    if (!pendingUploadNav) return;
    if (fetcher.state !== "idle") return;
    const data = fetcher.data as { ok?: boolean } | undefined;
    if (data && data.ok) {
      navigate("/app/sdl3d/editor?openMediaUpload=1");
      setPendingUploadNav(false);
    }
  }, [pendingUploadNav, fetcher.state, fetcher.data, navigate]);

  const handleNext = useCallback(() => {
    if (isLast) {
      fetcher.submit(
        { intent: "completeOnboarding" },
        { method: "post", action: "/api/sdl3d/onboarding" },
      );
    } else {
      setStep((s) => s + 1);
    }
  }, [fetcher, isLast]);

  const handleBack = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  const handleSkip = useCallback(() => {
    fetcher.submit(
      { intent: "skipOnboarding" },
      { method: "post", action: "/api/sdl3d/onboarding" },
    );
  }, [fetcher]);

  // Slice 9 PR #2 — deep-link from the wizard's upload step into the
  // editor with the media-source modal pre-opened. Completes onboarding
  // first so the dashboard loader doesn't bounce the merchant back to
  // the wizard.
  const handleOpenEditorUpload = useCallback(() => {
    setPendingUploadNav(true);
    fetcher.submit(
      { intent: "completeOnboarding" },
      { method: "post", action: "/api/sdl3d/onboarding" },
    );
  }, [fetcher]);

  const isUploadStep = current.id === "upload-model";

  const secondaryActions = [
    step > 0
      ? { content: "Back", onAction: handleBack, disabled: isBusy }
      : { content: "Skip", onAction: handleSkip, disabled: isBusy },
    ...(isUploadStep
      ? [
          {
            content: "Open editor to upload",
            onAction: handleOpenEditorUpload,
            disabled: isBusy,
            loading: pendingUploadNav && isBusy,
          },
        ]
      : []),
  ];

  const progressPct = Math.round(((step + 1) / STEPS.length) * 100);

  return (
    <Frame>
      {/* Modal renders as an overlay; the page beneath stays empty during
          onboarding since the merchant has no configs yet. */}
      <Page title="SDL 3D Hotspots">
        <Layout>
          <Layout.Section>
            <Card>
              <Text as="p" tone="subdued">
                Setting up your shop…
              </Text>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>

      <Modal
        open
        onClose={handleSkip}
        title={current.title}
        primaryAction={{
          content: isLast ? "Get started" : "Next",
          onAction: handleNext,
          loading: isBusy && isLast,
          disabled: isBusy,
        }}
        secondaryActions={secondaryActions}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <ProgressBar progress={progressPct} size="small" />
            <Text as="p" variant="bodySm" tone="subdued">
              Step {step + 1} of {STEPS.length}
            </Text>

            <Text as="p" variant="bodyMd">
              {current.subtitle}
            </Text>

            {step === 0 ? <OnboardingFeatureGrid /> : null}

            {step === 1 ? (
              <Banner tone="info">
                The editor sidebar lets you search all products. Select one to start configuring its 3D experience.
              </Banner>
            ) : null}

            {step === 2 ? (
              <Banner tone="info">
                <BlockStack gap="100">
                  <Text as="p">
                    <strong>GLB files</strong> are the standard for web 3D models.
                  </Text>
                  <Text as="p">
                    For 360° viewers, upload 24–72 product photos captured from a rotating turntable. You can also select images already in your Shopify files.
                  </Text>
                </BlockStack>
              </Banner>
            ) : null}

            {step === 3 ? (
              <Banner tone="info">
                Use <strong>Edit mode</strong> in the preview to click-to-place hotspots on the model surface. Drag to reposition. Each hotspot can have a title, description, and optional CTA button.
              </Banner>
            ) : null}

            {step === 4 ? (
              <Banner tone="info">
                Publishing writes your configuration to product metafields. Add the <strong>SDL 3D Viewer</strong> block to your theme to display it on product pages. Works with any Online Store 2.0 theme.
              </Banner>
            ) : null}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Frame>
  );
}

function OnboardingFeatureGrid() {
  return (
    <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
      <FeatureCard
        title="3D Model Viewer"
        body="Interactive GLB models with full camera controls."
      />
      <FeatureCard
        title="360° Image Viewer"
        body="Turntable photography with drag-to-rotate."
      />
      <FeatureCard
        title="Interactive Hotspots"
        body="Click-to-place annotations with focus animations."
      />
    </InlineGrid>
  );
}

function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <Card padding="300">
      <BlockStack gap="100">
        <Text as="h3" variant="headingSm">
          {title}
        </Text>
        <Text as="p" tone="subdued" variant="bodySm">
          {body}
        </Text>
      </BlockStack>
    </Card>
  );
}

/* ───────────────────── dashboard ───────────────────── */

type StatusFilter = "all" | "PUBLISHED" | "DRAFT";

type DashStorageRef = {
  id: string;
  bucket: string;
  provider: string;
};

type DashStorageSummary = DashStorageRef & {
  isDefault: boolean;
};

type DashConfig = {
  id: string;
  shopifyProductGid: string;
  productTitle: string;
  productImageUrl: string | null;
  productImageAlt: string | null;
  productMissing: boolean;
  status: string;
  enabled: boolean;
  sourceMode: string;
  hasModel: boolean;
  hotspotCount: number;
  updatedAt: string;
  preferredStorageId: string | null;
  effectiveStorage: DashStorageRef | null;
  effectiveStorageSource: "override" | "lastCapture" | "default" | "none";
};

type DashSyncRun = {
  id: string;
  status: string;
  direction: string;
  message: string | null;
  createdAt: string;
};

type DashDeadLetterCapture = {
  id: string;
  status: "FAILED" | "CANCELLED";
  productGid: string;
  errorMessage: string | null;
  attempts: number;
  updatedAt: string;
};

type DashData = {
  configs: DashConfig[];
  syncRuns: DashSyncRun[];
  totalConfigs: number;
  publishedCount: number;
  enabledCount: number;
  availableStorages: DashStorageSummary[];
  defaultStorageId: string | null;
  deadLetterCaptures: DashDeadLetterCapture[];
};

function Dashboard({ data }: { data: DashData }) {
  const { configs, syncRuns, totalConfigs, publishedCount, enabledCount, deadLetterCaptures } = data;

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const deleteOneFetcher = useFetcher<{
    ok: boolean;
    message?: string;
    productGid?: string;
    wasPublished?: boolean;
  }>();
  const deleteBulkFetcher = useFetcher<{
    ok: boolean;
    message?: string;
    deletedCount?: number;
  }>();
  const setStorageFetcher = useFetcher<{
    ok: boolean;
    message?: string;
    productGid?: string;
    preferredStorageId?: string | null;
  }>();
  // Capture lifecycle ops (reprocess + delete failed/cancelled captures).
  // Moved here from Settings 2026-05-27 — see "Failed captures" card below.
  const captureOpsFetcher = useFetcher<{
    ok: boolean;
    message?: string;
    deleted?: boolean;
    deletedCount?: number;
  }>();
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  // Slice 8 — storage override Modal. Held against the active config so
  // closing/reopening starts the dropdown from the persisted preference.
  const [storageModalConfig, setStorageModalConfig] = useState<DashConfig | null>(null);
  const [storageModalChoice, setStorageModalChoice] = useState<string>("");
  const [toast, setToast] = useState<{ message: string; isError?: boolean } | null>(null);

  // Look up titles for the "Removed X" toast — fetcher only returns the GID.
  const titleByGid = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of configs) m.set(c.shopifyProductGid, c.productTitle);
    return m;
  }, [configs]);

  const orphanedCount = useMemo(
    () => configs.filter((c) => c.productMissing).length,
    [configs],
  );

  const handleReprocessCapture = useCallback(
    (captureId: string) => {
      const fd = new FormData();
      fd.set("intent", "retry");
      fd.set("captureId", captureId);
      captureOpsFetcher.submit(fd, { method: "post", action: "/api/sdl3d/captures" });
    },
    [captureOpsFetcher],
  );

  const handleBulkDeleteFailedCaptures = useCallback(() => {
    if (typeof window !== "undefined" && !window.confirm(
      `Delete all ${deadLetterCaptures.length} failed/cancelled captures? The DB rows go; processed-frame bucket objects (if any) stay.`,
    )) {
      return;
    }
    const fd = new FormData();
    fd.set("intent", "bulkDeleteFailedCaptures");
    captureOpsFetcher.submit(fd, { method: "post", action: "/api/sdl3d/captures" });
  }, [captureOpsFetcher, deadLetterCaptures.length]);

  const handleDeleteCapture = useCallback(
    (captureId: string) => {
      if (typeof window !== "undefined" && !window.confirm("Permanently delete this capture row? The processed frames in your bucket are not removed.")) {
        return;
      }
      const fd = new FormData();
      fd.set("intent", "deleteCapture");
      fd.set("captureId", captureId);
      captureOpsFetcher.submit(fd, { method: "post", action: "/api/sdl3d/captures" });
    },
    [captureOpsFetcher],
  );

  const isCaptureOpsBusy = captureOpsFetcher.state !== "idle";

  // Toast for capture ops results — mirrors the settings page behaviour
  // before the move. Bulk delete returns `deletedCount`; single delete
  // returns just `deleted: true`.
  useEffect(() => {
    if (captureOpsFetcher.state !== "idle" || !captureOpsFetcher.data) return;
    const result = captureOpsFetcher.data as {
      ok: boolean;
      message?: string;
      deleted?: boolean;
      deletedCount?: number;
    };
    if (result.ok && typeof result.deletedCount === "number") {
      setToast({
        message: `Cleared ${result.deletedCount} failed capture${result.deletedCount === 1 ? "" : "s"}.`,
      });
    } else if (result.ok && result.deleted) {
      setToast({ message: "Capture removed." });
    } else if (result.ok) {
      setToast({ message: "Capture re-queued. The worker will pick it up." });
    } else if (result.message) {
      setToast({ message: result.message, isError: true });
    }
  }, [captureOpsFetcher.state, captureOpsFetcher.data]);

  const handleRemove = useCallback(
    (config: DashConfig) => {
      deleteOneFetcher.submit(
        { intent: "deleteConfig", productGid: config.shopifyProductGid },
        { method: "post", action: "/api/sdl3d/config" },
      );
    },
    [deleteOneFetcher],
  );

  const handleBulkDelete = useCallback(() => {
    deleteBulkFetcher.submit(
      { intent: "deleteOrphanedConfigs" },
      { method: "post", action: "/api/sdl3d/config" },
    );
  }, [deleteBulkFetcher]);

  const handleOpenStorage = useCallback((config: DashConfig) => {
    setStorageModalConfig(config);
    // "" sentinel maps to "use shop default" on submit; otherwise the
    // existing preference shows pre-selected so the merchant sees what
    // they previously chose.
    setStorageModalChoice(config.preferredStorageId ?? "");
  }, []);

  const handleStorageSubmit = useCallback(() => {
    if (!storageModalConfig) return;
    setStorageFetcher.submit(
      {
        intent: "setPreferredStorage",
        productGid: storageModalConfig.shopifyProductGid,
        storageId: storageModalChoice, // "" clears the override
      },
      { method: "post", action: "/api/sdl3d/config" },
    );
  }, [setStorageFetcher, storageModalConfig, storageModalChoice]);

  const seenStorageRef = useRef<unknown>(null);
  useEffect(() => {
    if (setStorageFetcher.state !== "idle" || !setStorageFetcher.data) return;
    if (seenStorageRef.current === setStorageFetcher.data) return;
    seenStorageRef.current = setStorageFetcher.data;
    const res = setStorageFetcher.data;
    if (res.ok) {
      setStorageModalConfig(null);
      setToast({ message: res.message ?? "Storage preference saved." });
    } else if (res.message) {
      setToast({ message: res.message, isError: true });
    }
  }, [setStorageFetcher.state, setStorageFetcher.data]);

  // Surface fetcher results once per response (ref-guarded to avoid the
  // useRevalidator dep trap — see feedback_react_router_revalidator.md).
  const seenDeleteOneRef = useRef<unknown>(null);
  useEffect(() => {
    if (deleteOneFetcher.state !== "idle" || !deleteOneFetcher.data) return;
    if (seenDeleteOneRef.current === deleteOneFetcher.data) return;
    seenDeleteOneRef.current = deleteOneFetcher.data;
    const res = deleteOneFetcher.data;
    if (res.ok && res.productGid) {
      const title = titleByGid.get(res.productGid) ?? "config";
      const hint = res.wasPublished
        ? " Republish from metafield to restore."
        : "";
      setToast({ message: `Removed ${title}.${hint}` });
    } else if (!res.ok) {
      setToast({ message: res.message ?? "Remove failed.", isError: true });
    }
  }, [deleteOneFetcher.state, deleteOneFetcher.data, titleByGid]);

  const seenDeleteBulkRef = useRef<unknown>(null);
  useEffect(() => {
    if (deleteBulkFetcher.state !== "idle" || !deleteBulkFetcher.data) return;
    if (seenDeleteBulkRef.current === deleteBulkFetcher.data) return;
    seenDeleteBulkRef.current = deleteBulkFetcher.data;
    const res = deleteBulkFetcher.data;
    if (res.ok) {
      setBulkModalOpen(false);
      const count = res.deletedCount ?? 0;
      if (count === 0) {
        setToast({ message: "No orphaned configs found — they may have been un-deleted on Shopify." });
      } else if (orphanedCount && count < orphanedCount) {
        setToast({
          message: `Removed ${count} of ${orphanedCount} marked for deletion. Others may have been un-deleted on Shopify.`,
        });
      } else {
        setToast({ message: res.message ?? `Removed ${count} orphaned config${count === 1 ? "" : "s"}.` });
      }
    } else {
      setToast({ message: res.message ?? "Bulk delete failed.", isError: true });
    }
  }, [deleteBulkFetcher.state, deleteBulkFetcher.data, orphanedCount]);

  const isBulkBusy = deleteBulkFetcher.state !== "idle";

  const filteredConfigs = useMemo(() => {
    let result = configs;
    if (statusFilter !== "all") {
      result = result.filter((c) => c.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((c) => c.productTitle.toLowerCase().includes(q));
    }
    return result;
  }, [configs, statusFilter, search]);

  const appliedFilters = useMemo(() => {
    if (statusFilter === "all") return [];
    return [
      {
        key: "status",
        label: `Status: ${statusFilter === "PUBLISHED" ? "Published" : "Drafts"}`,
        onRemove: () => setStatusFilter("all"),
      },
    ];
  }, [statusFilter]);

  return (
    <Frame>
      <Page
        title="SDL 3D Hotspots"
        subtitle="Manage 3D product viewers and interactive hotspots."
        primaryAction={{
          content: "Open Editor",
          url: "/app/sdl3d/editor",
        }}
        secondaryActions={
          orphanedCount > 0
            ? [
                {
                  content: `Delete orphaned (${orphanedCount})`,
                  destructive: true,
                  onAction: () => setBulkModalOpen(true),
                },
              ]
            : undefined
        }
      >
        <Layout>
          {/* Stats */}
          <Layout.Section>
            <InlineGrid columns={{ xs: 2, md: 4 }} gap="300">
              <StatCard value={totalConfigs} label="Products configured" />
              <StatCard value={publishedCount} label="Published" />
              <StatCard value={enabledCount} label="Enabled on storefront" />
              <StatCard value={syncRuns.length} label="Recent syncs" />
            </InlineGrid>
          </Layout.Section>

          {/* Left rail — Recent Sync Activity + Failed captures.
              Placed BEFORE the products section so on desktop the
              rail sits on the LEFT (Polaris Layout uses CSS grid;
              section order = visual order). Quick Actions card was
              removed 2026-05-27 — the same destinations are one click
              away from the NavMenu. */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="300">
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Recent Sync Activity
                  </Text>
                  {syncRuns.length === 0 ? (
                    <Text as="p" tone="subdued" variant="bodySm">
                      No sync activity yet.
                    </Text>
                  ) : (
                    <BlockStack gap="200">
                      {syncRuns.map((run) => (
                        <SyncRunRow key={run.id} run={run} />
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>

              {/* Failed captures — moved here from Settings 2026-05-27.
                  Hidden entirely when empty so a healthy shop's
                  dashboard stays clean. Bulk-delete button added
                  2026-05-27 — same shop-scoped delete, in one shot. */}
              {deadLetterCaptures.length > 0 ? (
                <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingMd">
                        Failed captures
                      </Text>
                      <Button
                        size="slim"
                        tone="critical"
                        variant="plain"
                        onClick={handleBulkDeleteFailedCaptures}
                        disabled={isCaptureOpsBusy}
                      >
                        Delete all
                      </Button>
                    </InlineStack>
                    <Text as="p" tone="subdued" variant="bodySm">
                      Captures that errored or were cancelled. Reprocess to re-run, or delete to clear the row.
                    </Text>
                    <ResourceList
                      resourceName={{ singular: "capture", plural: "captures" }}
                      items={deadLetterCaptures}
                      renderItem={(capture) => {
                        const shortGid = capture.productGid.split("/").pop() ?? capture.productGid;
                        const subtitle =
                          capture.status === "CANCELLED"
                            ? "Cancelled by merchant"
                            : capture.errorMessage ?? "Capture failed";
                        return (
                          <ResourceItem
                            id={capture.id}
                            onClick={() => undefined}
                            accessibilityLabel={`Capture ${capture.id}`}
                          >
                            <BlockStack gap="100">
                              <InlineStack gap="200" blockAlign="center">
                                <Text as="span" variant="bodyMd" fontWeight="semibold">
                                  Product {shortGid}
                                </Text>
                                <Badge tone={capture.status === "FAILED" ? "critical" : "warning"}>
                                  {capture.status}
                                </Badge>
                                {capture.attempts > 1 ? (
                                  <Badge>{`${capture.attempts} attempts`}</Badge>
                                ) : null}
                              </InlineStack>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {subtitle}
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {new Date(capture.updatedAt).toLocaleString()}
                              </Text>
                              <InlineStack gap="200">
                                <Button
                                  size="slim"
                                  onClick={() => handleReprocessCapture(capture.id)}
                                  disabled={isCaptureOpsBusy}
                                >
                                  Reprocess
                                </Button>
                                <Button
                                  size="slim"
                                  tone="critical"
                                  variant="plain"
                                  onClick={() => handleDeleteCapture(capture.id)}
                                  disabled={isCaptureOpsBusy}
                                >
                                  Delete
                                </Button>
                              </InlineStack>
                            </BlockStack>
                          </ResourceItem>
                        );
                      }}
                    />
                  </BlockStack>
                </Card>
              ) : null}
            </BlockStack>
          </Layout.Section>

          {/* Products list. */}
          <Layout.Section>
            <Card padding="0">
              <Box padding="400" paddingBlockEnd="0">
                <Filters
                  queryValue={search}
                  queryPlaceholder="Search products by title…"
                  onQueryChange={setSearch}
                  onQueryClear={() => setSearch("")}
                  onClearAll={() => {
                    setSearch("");
                    setStatusFilter("all");
                  }}
                  appliedFilters={appliedFilters}
                  filters={[
                    {
                      key: "status",
                      label: "Status",
                      filter: (
                        <BlockStack gap="200">
                          {(["all", "PUBLISHED", "DRAFT"] as StatusFilter[]).map((f) => (
                            <Button
                              key={f}
                              variant={statusFilter === f ? "primary" : "tertiary"}
                              onClick={() => setStatusFilter(f)}
                              size="slim"
                            >
                              {f === "all" ? "All" : f === "PUBLISHED" ? "Published" : "Drafts"}
                            </Button>
                          ))}
                        </BlockStack>
                      ),
                      shortcut: true,
                    },
                  ]}
                />
              </Box>
              {filteredConfigs.length === 0 ? (
                <Box padding="600">
                  {configs.length === 0 ? (
                    <EmptyState
                      heading="No products configured yet"
                      action={{ content: "Open Editor", url: "/app/sdl3d/editor" }}
                      image=""
                    >
                      <Text as="p">
                        Open the Editor to attach a 3D viewer to your first product.
                      </Text>
                    </EmptyState>
                  ) : (
                    <EmptyState
                      heading="No matches"
                      action={{
                        content: "Clear filters",
                        onAction: () => {
                          setSearch("");
                          setStatusFilter("all");
                        },
                      }}
                      image=""
                    >
                      <Text as="p">Try a different search term or status filter.</Text>
                    </EmptyState>
                  )}
                </Box>
              ) : (
                <ResourceList
                  resourceName={{ singular: "product", plural: "products" }}
                  items={filteredConfigs}
                  renderItem={(config) => (
                    <ProductResourceRow
                      key={config.id}
                      config={config}
                      onRemove={handleRemove}
                      onSetStorage={handleOpenStorage}
                      storageAvailable={data.availableStorages.length > 0}
                    />
                  )}
                />
              )}
            </Card>
          </Layout.Section>

        </Layout>
      </Page>

      <Modal
        open={bulkModalOpen}
        onClose={() => (isBulkBusy ? undefined : setBulkModalOpen(false))}
        title={`Delete ${orphanedCount} orphaned config${orphanedCount === 1 ? "" : "s"}?`}
        primaryAction={{
          content: "Delete",
          destructive: true,
          loading: isBulkBusy,
          onAction: handleBulkDelete,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            disabled: isBulkBusy,
            onAction: () => setBulkModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">
              These products were deleted on Shopify but still have configs in
              this app. Their hotspots and capture history will be deleted.
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              Published metafields on Shopify aren't touched — if a config was
              published before its product was deleted, the metafield data
              still lives on Shopify.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Slice 8 — per-product storage override Modal. Lists every
          configured ShopStorage row + a "Use shop default" option.
          On submit, api.sdl3d.config.tsx setPreferredStorage stamps the
          choice on ProductConfig and api.sdl3d.captures.tsx reads it
          before falling back to ShopStorage.isDefault on the next upload. */}
      <Modal
        open={storageModalConfig !== null}
        onClose={() => (setStorageFetcher.state !== "idle" ? undefined : setStorageModalConfig(null))}
        title={
          storageModalConfig
            ? `Storage for "${storageModalConfig.productTitle}"`
            : "Storage"
        }
        primaryAction={{
          content: "Save",
          loading: setStorageFetcher.state !== "idle",
          onAction: handleStorageSubmit,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            disabled: setStorageFetcher.state !== "idle",
            onAction: () => setStorageModalConfig(null),
          },
        ]}
      >
        <Modal.Section>
          {storageModalConfig ? (
            <BlockStack gap="300">
              <Text as="p" tone="subdued" variant="bodySm">
                Where this product's captured frames upload to. The
                shop default applies unless you set a product-level
                override here.
              </Text>
              <ChoiceList
                title="Bucket"
                titleHidden
                allowMultiple={false}
                selected={[storageModalChoice]}
                onChange={(values) => setStorageModalChoice(values[0] ?? "")}
                choices={[
                  {
                    label: data.availableStorages.find((s) => s.isDefault)
                      ? `Use shop default (${data.availableStorages.find((s) => s.isDefault)?.bucket})`
                      : "Use shop default (none configured)",
                    value: "",
                  },
                  ...data.availableStorages.map((s) => ({
                    label: `${s.bucket} — ${s.provider}${s.isDefault ? " · default" : ""}`,
                    value: s.id,
                  })),
                ]}
              />
              {data.availableStorages.length === 0 ? (
                <Text as="p" tone="subdued" variant="bodySm">
                  No storage rows configured yet. Open Settings → Storage to connect a bucket.
                </Text>
              ) : null}
            </BlockStack>
          ) : null}
        </Modal.Section>
      </Modal>

      {toast ? (
        <Toast
          content={toast.message}
          error={toast.isError}
          onDismiss={() => setToast(null)}
          duration={toast.isError ? 6000 : 4000}
        />
      ) : null}
    </Frame>
  );
}

function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <Card padding="400">
      <BlockStack gap="100">
        <Text as="p" variant="heading2xl" fontWeight="bold">
          {value}
        </Text>
        <Text as="p" tone="subdued" variant="bodySm">
          {label}
        </Text>
      </BlockStack>
    </Card>
  );
}

function ProductResourceRow({
  config,
  onRemove,
  onSetStorage,
  storageAvailable,
}: {
  config: DashConfig;
  onRemove: (config: DashConfig) => void;
  onSetStorage: (config: DashConfig) => void;
  storageAvailable: boolean;
}) {
  const editorUrl = `/app/sdl3d/editor?product=${encodeURIComponent(config.shopifyProductGid)}`;

  const statusTone: "success" | "info" =
    config.status === "PUBLISHED" ? "success" : "info";
  const enabledTone: "success" | undefined = config.enabled ? "success" : undefined;

  // Polaris Thumbnail renders a placeholder image when source is empty —
  // perfect for products with no featured image or that have been deleted.
  const thumbnail = (
    <Thumbnail
      size="small"
      source={config.productImageUrl ?? ""}
      alt={config.productImageAlt ?? config.productTitle}
    />
  );

  // Slice 6 PR #1 Decision #6: Remove only shows for orphaned rows.
  // Slice 8 dashboard polish: live (non-orphan) rows get a "Storage"
  // shortcut that opens the override Modal. Both are gated separately
  // so an orphaned row can't get a Storage action — it has no product
  // to store frames for.
  const shortcutActions: { content: string; accessibilityLabel?: string; onAction: () => void }[] = [];
  if (config.productMissing) {
    shortcutActions.push({
      content: "Remove",
      accessibilityLabel: `Remove ${config.productTitle}`,
      onAction: () => onRemove(config),
    });
  } else if (storageAvailable) {
    shortcutActions.push({
      content: "Storage",
      accessibilityLabel: `Set storage for ${config.productTitle}`,
      onAction: () => onSetStorage(config),
    });
  }

  // Storage line copy varies on the resolution source so the merchant can
  // tell *why* this product points at a particular bucket without opening
  // the Modal.
  let storageLabel: string;
  if (!config.effectiveStorage) {
    storageLabel = "Storage: not configured";
  } else {
    const tag =
      config.effectiveStorageSource === "override"
        ? "(product override)"
        : config.effectiveStorageSource === "lastCapture"
          ? "(from last capture)"
          : "(shop default)";
    storageLabel = `Storage: ${config.effectiveStorage.bucket} ${tag}`;
  }

  return (
    <ResourceItem
      id={config.id}
      url={editorUrl}
      accessibilityLabel={`Open ${config.productTitle} in editor`}
      media={thumbnail}
      shortcutActions={shortcutActions.length ? shortcutActions : undefined}
    >
      <BlockStack gap="100">
        <InlineStack gap="200" blockAlign="center" wrap={false}>
          <Text as="h3" variant="bodyMd" fontWeight="semibold">
            {config.productTitle}
          </Text>
          {config.hasModel ? <Badge tone="info">3D</Badge> : null}
          <Badge tone={statusTone}>{config.status}</Badge>
          <Badge tone={enabledTone}>{config.enabled ? "Enabled" : "Disabled"}</Badge>
          {config.productMissing ? (
            <Badge tone="critical">Deleted on Shopify</Badge>
          ) : null}
        </InlineStack>
        <Text as="p" tone="subdued" variant="bodySm">
          {config.hotspotCount} hotspot{config.hotspotCount === 1 ? "" : "s"}
          {" · "}
          {config.sourceMode} mode
          {" · "}
          <span suppressHydrationWarning>
            {new Date(config.updatedAt).toLocaleDateString()}
          </span>
        </Text>
        {!config.productMissing ? (
          <Text as="p" tone="subdued" variant="bodySm">
            {storageLabel}
          </Text>
        ) : null}
      </BlockStack>
    </ResourceItem>
  );
}

function SyncRunRow({ run }: { run: DashSyncRun }) {
  const tone: "success" | "critical" | undefined =
    run.status === "SUCCESS"
      ? "success"
      : run.status === "ERROR"
        ? "critical"
        : undefined;

  return (
    <Box
      padding="200"
      background="bg-surface-secondary"
      borderRadius="200"
    >
      <BlockStack gap="100">
        <InlineStack gap="200" blockAlign="center" wrap={false}>
          <Badge tone={tone}>{run.status}</Badge>
          <Text as="span" tone="subdued" variant="bodySm">
            {run.direction}
          </Text>
        </InlineStack>
        {run.message ? (
          <Text as="p" variant="bodySm">
            {run.message}
          </Text>
        ) : null}
        <Text as="p" tone="subdued" variant="bodySm">
          <span suppressHydrationWarning>
            {new Date(run.createdAt).toLocaleString()}
          </span>
        </Text>
      </BlockStack>
    </Box>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} — ${error.statusText || "Something went wrong"}`
    : error instanceof Error
      ? error.message
      : "An unexpected error occurred.";

  return (
    <Frame>
      <Page title="Dashboard error">
        <Layout>
          <Layout.Section>
            <Banner tone="critical" title="Dashboard failed to load">
              <Text as="p">{message}</Text>
            </Banner>
          </Layout.Section>
          <Layout.Section>
            <Button url="/app" variant="primary">
              Reload dashboard
            </Button>
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}
