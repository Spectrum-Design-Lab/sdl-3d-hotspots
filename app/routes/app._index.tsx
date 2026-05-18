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
import { useLoaderData, useFetcher, useRouteError, isRouteErrorResponse } from "react-router";
import { useCallback, useMemo, useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
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
    };
  }

  const [configs, syncRuns, totalConfigs, publishedCount, enabledCount] = await Promise.all([
    prisma.productConfig.findMany({
      where: { shopId: shop.id },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: {
        _count: { select: { hotspots: true } },
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
  ]);

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
  const needsResolve = productGids.filter((gid) => {
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
  const [step, setStep] = useState(0);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const isBusy = fetcher.state !== "idle";

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

  const secondaryActions = [
    step > 0
      ? { content: "Back", onAction: handleBack, disabled: isBusy }
      : { content: "Skip", onAction: handleSkip, disabled: isBusy },
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
};

type DashSyncRun = {
  id: string;
  status: string;
  direction: string;
  message: string | null;
  createdAt: string;
};

type DashData = {
  configs: DashConfig[];
  syncRuns: DashSyncRun[];
  totalConfigs: number;
  publishedCount: number;
  enabledCount: number;
};

function Dashboard({ data }: { data: DashData }) {
  const { configs, syncRuns, totalConfigs, publishedCount, enabledCount } = data;

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

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

          {/* Products + Sidebar */}
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
                    <ProductResourceRow key={config.id} config={config} />
                  )}
                />
              )}
            </Card>
          </Layout.Section>

          {/* Sidebar */}
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

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Quick Actions
                  </Text>
                  <BlockStack gap="200">
                    <Button url="/app/sdl3d/editor" variant="primary" fullWidth>
                      Open Editor
                    </Button>
                    <Button url="/app/sdl3d/settings" fullWidth>
                      Metafield Setup
                    </Button>
                  </BlockStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </Page>
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

function ProductResourceRow({ config }: { config: DashConfig }) {
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

  return (
    <ResourceItem
      id={config.id}
      url={editorUrl}
      accessibilityLabel={`Open ${config.productTitle} in editor`}
      media={thumbnail}
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
