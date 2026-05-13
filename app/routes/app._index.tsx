import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, Link, useFetcher, useRouteError, isRouteErrorResponse } from "react-router";
import { useState, useMemo } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { adminGraphql } from "../lib/sdl3d-graphql.server";
import "../styles/dashboard.css";
import "../styles/onboarding.css";

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
  const titleMap = new Map(
    cachedProducts.map((p) => [p.shopifyProductGid, p.title]),
  );

  // Any config without a ProductCache row falls back to its raw GID, which
  // looks like "gid://shopify/Product/9099..." in the UI. That happens when
  // a draft was created via the captures CLI or auto-pulled from metafields
  // without the editor's product search ever populating the cache. Resolve
  // those titles on the fly via the Admin API and upsert into the cache so
  // subsequent loads skip this fetch.
  const unresolvedGids = productGids.filter((gid) => !titleMap.has(gid));
  if (unresolvedGids.length > 0) {
    try {
      const data = await adminGraphql<{
        nodes: Array<
          | { __typename: "Product"; id: string; title: string; handle: string; status: string }
          | { __typename: string; id: string }
          | null
        >;
      }>(
        admin,
        `query ResolveHomeProductTitles($ids: [ID!]!) {
          nodes(ids: $ids) {
            __typename
            ... on Product { id title handle status }
          }
        }`,
        { ids: unresolvedGids },
      );
      const fresh: Array<{
        shopifyProductGid: string;
        title: string;
        handle: string | null;
        status: string | null;
      }> = [];
      for (const node of data.nodes) {
        if (node && node.__typename === "Product" && "title" in node) {
          titleMap.set(node.id, node.title);
          fresh.push({
            shopifyProductGid: node.id,
            title: node.title,
            handle: node.handle ?? null,
            status: node.status ?? null,
          });
        }
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
              update: { title: p.title, handle: p.handle, status: p.status },
              create: { shopId: shop.id, ...p },
            }),
          ),
        );
      }
    } catch (err) {
      // Soft-fail — falling back to the GID is ugly but not broken, and we
      // don't want a transient Shopify hiccup to break the dashboard.
      console.warn("[home] product-title resolve failed; leaving GIDs in place:", err);
    }
  }

  const enrichedConfigs = configs.map((c) => ({
    id: c.id,
    shopifyProductGid: c.shopifyProductGid,
    productTitle: titleMap.get(c.shopifyProductGid) ?? c.shopifyProductGid,
    status: c.status,
    enabled: c.enabled,
    sourceMode: c.sourceMode,
    hasModel: Boolean(c.modelFileShopifyGid),
    hotspotCount: c._count.hotspots,
    updatedAt: c.updatedAt.toISOString(),
  }));

  return {
    needsOnboarding: false,
    configs: enrichedConfigs,
    syncRuns,
    totalConfigs,
    publishedCount,
    enabledCount,
  };
};

// Action removed — onboarding mutations go through /api/sdl3d/onboarding

/* ───────────────────── component ───────────────────── */

type StatusFilter = "all" | "PUBLISHED" | "DRAFT";

export default function DashboardPage() {
  const data = useLoaderData<typeof loader>();

  if (data.needsOnboarding) {
    return <OnboardingWizard />;
  }

  return <Dashboard data={data} />;
}

/* ───────────────────── onboarding wizard ───────────────────── */

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
    subtitle: "Upload a GLB file for a 3D model, or a set of product photos for a 360\u00b0 turntable.",
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

function OnboardingWizard() {
  const fetcher = useFetcher();
  const [step, setStep] = useState(0);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const handleNext = () => {
    if (isLast) {
      fetcher.submit({ intent: "completeOnboarding" }, { method: "post", action: "/api/sdl3d/onboarding" });
    } else {
      setStep(step + 1);
    }
  };

  const handleSkip = () => {
    fetcher.submit({ intent: "skipOnboarding" }, { method: "post", action: "/api/sdl3d/onboarding" });
  };

  return (
    <div className="sdl-onboard">
      <div className="sdl-onboard__card">
        {/* Progress dots */}
        <div className="sdl-onboard__progress">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`sdl-onboard__dot ${i === step ? "sdl-onboard__dot--active" : ""} ${i < step ? "sdl-onboard__dot--done" : ""}`}
              onClick={() => setStep(i)}
              aria-label={`Step ${i + 1}: ${s.title}`}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="sdl-onboard__content">
          <div className="sdl-onboard__icon">{getStepIcon(step)}</div>
          <h1 className="sdl-onboard__title">{current.title}</h1>
          <p className="sdl-onboard__subtitle">{current.subtitle}</p>

          {step === 0 && (
            <div className="sdl-onboard__features">
              <div className="sdl-onboard__feature">
                <span className="sdl-onboard__feature-icon">&#x2B22;</span>
                <div>
                  <strong>3D Model Viewer</strong>
                  <span>Interactive GLB models with full camera controls</span>
                </div>
              </div>
              <div className="sdl-onboard__feature">
                <span className="sdl-onboard__feature-icon">&#x21BB;</span>
                <div>
                  <strong>360° Image Viewer</strong>
                  <span>Turntable photography with drag-to-rotate</span>
                </div>
              </div>
              <div className="sdl-onboard__feature">
                <span className="sdl-onboard__feature-icon">&#x2316;</span>
                <div>
                  <strong>Interactive Hotspots</strong>
                  <span>Click-to-place annotations with focus animations</span>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="sdl-onboard__tip">
              The editor sidebar lets you search all products. Select one to start configuring its 3D experience.
            </div>
          )}

          {step === 2 && (
            <div className="sdl-onboard__tip">
              <strong>GLB files</strong> are the standard for web 3D models. For 360° viewers, upload 24-72 product photos captured from a rotating turntable. You can also select images already in your Shopify files.
            </div>
          )}

          {step === 3 && (
            <div className="sdl-onboard__tip">
              Use <strong>Edit mode</strong> in the preview to click-to-place hotspots on the model surface. Drag to reposition. Each hotspot can have a title, description, and optional CTA button.
            </div>
          )}

          {step === 4 && (
            <div className="sdl-onboard__tip">
              Publishing writes your configuration to product metafields. Add the <strong>SDL 3D Viewer</strong> block to your theme to display it on product pages. The viewer works with any Online Store 2.0 theme.
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="sdl-onboard__actions">
          {step > 0 ? (
            <button
              type="button"
              className="sdl-onboard__btn sdl-onboard__btn--back"
              onClick={() => setStep(step - 1)}
            >
              Back
            </button>
          ) : (
            <button
              type="button"
              className="sdl-onboard__btn sdl-onboard__btn--skip"
              onClick={handleSkip}
            >
              Skip
            </button>
          )}
          <button
            type="button"
            className="sdl-onboard__btn sdl-onboard__btn--next"
            onClick={handleNext}
            disabled={fetcher.state !== "idle"}
          >
            {isLast ? "Get started" : "Next"}
          </button>
        </div>

        {/* Step counter */}
        <div className="sdl-onboard__counter">
          {step + 1} / {STEPS.length}
        </div>
      </div>
    </div>
  );
}

function getStepIcon(step: number): string {
  const icons = [
    "\uD83D\uDDBC\uFE0F",
    "\uD83D\uDD0D",
    "\uD83D\uDCE6",
    "\uD83D\uDCCC",
    "\uD83D\uDE80",
  ];
  return icons[step] ?? "";
}

/* ───────────────────── dashboard ───────────────────── */

function Dashboard({ data }: { data: { configs: any[]; syncRuns: any[]; totalConfigs: number; publishedCount: number; enabledCount: number } }) {
  const { configs, syncRuns, totalConfigs, publishedCount, enabledCount } = data;

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const filteredConfigs = useMemo(() => {
    let result = configs;
    if (statusFilter !== "all") {
      result = result.filter((c: any) => c.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((c: any) => c.productTitle.toLowerCase().includes(q));
    }
    return result;
  }, [configs, statusFilter, search]);

  return (
    <div className="sdl-dash">
      <div className="sdl-dash__inner">
        {/* Header */}
        <div className="sdl-dash__header">
          <div>
            <div className="sdl-dash__title">SDL 3D Hotspots</div>
            <div className="sdl-dash__subtitle">
              Manage 3D product viewers and interactive hotspots.
            </div>
          </div>
          <Link to="/app/sdl3d/editor" style={{ textDecoration: "none" }}>
            <button type="button" className="sdl-filter-btn sdl-filter-btn--active">
              Open Editor
            </button>
          </Link>
        </div>

        {/* Stats */}
        <div className="sdl-dash__stats">
          <div className="sdl-stat">
            <div className="sdl-stat__value">{totalConfigs}</div>
            <div className="sdl-stat__label">Products configured</div>
          </div>
          <div className="sdl-stat">
            <div className="sdl-stat__value">{publishedCount}</div>
            <div className="sdl-stat__label">Published</div>
          </div>
          <div className="sdl-stat">
            <div className="sdl-stat__value">{enabledCount}</div>
            <div className="sdl-stat__label">Enabled on storefront</div>
          </div>
          <div className="sdl-stat">
            <div className="sdl-stat__value">{syncRuns.length}</div>
            <div className="sdl-stat__label">Recent syncs</div>
          </div>
        </div>

        {/* Filters */}
        <div className="sdl-dash__filters">
          <input
            type="text"
            className="sdl-dash__search"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {(["all", "PUBLISHED", "DRAFT"] as StatusFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`sdl-filter-btn ${statusFilter === f ? "sdl-filter-btn--active" : ""}`}
              onClick={() => setStatusFilter(f)}
            >
              {f === "all" ? "All" : f === "PUBLISHED" ? "Published" : "Drafts"}
            </button>
          ))}
        </div>

        {/* Grid: Products + Sidebar */}
        <div className="sdl-dash__grid">
          {/* Product list */}
          <div>
            {filteredConfigs.length === 0 ? (
              configs.length === 0 ? (
                <div className="sdl-dash__empty">
                  <div className="sdl-dash__empty-title">No products configured yet</div>
                  <div>
                    Open the <Link to="/app/sdl3d/editor">Editor</Link> to attach a 3D viewer to your first product.
                  </div>
                </div>
              ) : (
                <div className="sdl-dash__empty">
                  <div className="sdl-dash__empty-title">No matches</div>
                  <div>Try a different search or filter.</div>
                </div>
              )
            ) : (
              <div className="sdl-product-cards">
                {filteredConfigs.map((config: any) => (
                  <Link
                    key={config.id}
                    to={`/app/sdl3d/editor?product=${encodeURIComponent(config.shopifyProductGid)}`}
                    className="sdl-product-card"
                  >
                    <div
                      className={`sdl-product-card__icon ${config.hasModel ? "sdl-product-card__icon--model" : "sdl-product-card__icon--empty"}`}
                    >
                      {config.hasModel ? "3D" : "--"}
                    </div>
                    <div className="sdl-product-card__info">
                      <div className="sdl-product-card__title">{config.productTitle}</div>
                      <div className="sdl-product-card__meta">
                        <span>
                          {config.hotspotCount} hotspot{config.hotspotCount !== 1 ? "s" : ""}
                        </span>
                        <span>{config.sourceMode} mode</span>
                        <span>
                          {new Date(config.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <div className="sdl-product-card__badges">
                      <span
                        className={`sdl-dash-badge ${config.status === "PUBLISHED" ? "sdl-dash-badge--published" : "sdl-dash-badge--draft"}`}
                      >
                        {config.status}
                      </span>
                      <span
                        className={`sdl-dash-badge ${config.enabled ? "sdl-dash-badge--enabled" : "sdl-dash-badge--disabled"}`}
                      >
                        {config.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <aside className="sdl-dash__aside">
            {/* Sync Activity */}
            <div className="sdl-dash-panel">
              <div className="sdl-dash-panel__title">Recent Sync Activity</div>
              {syncRuns.length === 0 ? (
                <div style={{ fontSize: 13, color: "#64748b" }}>No sync activity yet.</div>
              ) : (
                <div className="sdl-sync-list">
                  {syncRuns.map((run: any) => (
                    <div key={run.id} className="sdl-sync-item">
                      <div className="sdl-sync-item__row">
                        <span
                          className={`sdl-dash-badge ${
                            run.status === "SUCCESS"
                              ? "sdl-dash-badge--published"
                              : run.status === "ERROR"
                                ? "sdl-dash-badge--draft"
                                : "sdl-dash-badge--disabled"
                          }`}
                        >
                          {run.status}
                        </span>
                        <span style={{ fontSize: 12, color: "#64748b" }}>{run.direction}</span>
                      </div>
                      {run.message ? (
                        <div className="sdl-sync-item__message">{run.message}</div>
                      ) : null}
                      <div className="sdl-sync-item__time">
                        {new Date(run.createdAt).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div className="sdl-dash-panel">
              <div className="sdl-dash-panel__title">Quick Actions</div>
              <div className="sdl-quick-actions">
                <Link to="/app/sdl3d/editor" className="sdl-quick-action">
                  Open Editor
                </Link>
                <Link to="/app/sdl3d/setup" className="sdl-quick-action">
                  Metafield Setup
                </Link>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
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
    <div style={{ maxWidth: 600, margin: "60px auto", padding: 24, textAlign: "center" }}>
      <h2>Dashboard error</h2>
      <p>{message}</p>
      <a href="/app" style={{ color: "#2563eb" }}>Reload dashboard</a>
    </div>
  );
}
