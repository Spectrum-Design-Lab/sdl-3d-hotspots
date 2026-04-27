import { useState, useEffect } from "react";
import { useLoaderData, useFetcher, useRouteError, isRouteErrorResponse } from "react-router";
import shopify from "../shopify.server";
import { getSdl3dDefinitions } from "../lib/sdl3d-metafields.server";
import { ensureShop } from "../lib/sdl3d-graphql.server";
import { apiVersion } from "../shopify.server";
import prisma from "../db.server";
import "../styles/editor.css";

// Action removed — mutations go through API routes:
//   /api/sdl3d/onboarding  (resetOnboarding)
//   /api/sdl3d/settings    (ensureMetafields)

export async function loader({ request }: { request: Request }) {
  const { admin, session } = await shopify.authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const definitions = await getSdl3dDefinitions(admin);

  const [configCount, presetCount, syncRunCount] = await Promise.all([
    prisma.productConfig.count({ where: { shopId: shop.id } }),
    prisma.preset.count({ where: { shopId: shop.id } }),
    prisma.syncRun.count({ where: { shopId: shop.id } }),
  ]);

  return {
    shop: session.shop,
    logoUrl: shop.logoUrl ?? "",
    darkMode: shop.darkMode ?? false,
    apiVersion: String(apiVersion),
    configCount,
    presetCount,
    syncRunCount,
    definitions: definitions.map((d) => ({
      id: d.id,
      namespace: d.namespace,
      key: d.key,
      name: d.name,
    })),
  };
}

export default function Sdl3dSettingsRoute() {
  const loaderData = useLoaderData<typeof loader>();
  const onboardingFetcher = useFetcher<{ ok?: boolean; resetOnboarding?: boolean }>();
  const metafieldFetcher = useFetcher<{ ok?: boolean; results?: Array<{ key: string; status: string; message?: string }> }>();

  const logoFetcher = useFetcher<{ ok?: boolean; logoUrl?: string | null }>();
  const darkModeFetcher = useFetcher<{ ok?: boolean; darkMode?: boolean }>();
  const [logoInput, setLogoInput] = useState(loaderData.logoUrl);
  const [darkMode, setDarkMode] = useState(loaderData.darkMode);

  useEffect(() => {
    if (logoFetcher.data?.ok && logoFetcher.data.logoUrl !== undefined) {
      setLogoInput(logoFetcher.data.logoUrl ?? "");
    }
  }, [logoFetcher.data]);

  const onboardingData = onboardingFetcher.data;
  const metafieldData = metafieldFetcher.data;

  return (
    <div className="sdl-editor" data-theme={darkMode ? "dark" : "light"}>
      <div className="sdl-editor__inner" style={{ maxWidth: 800, margin: "0 auto", padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Settings</h1>
          <p className="sdl-text-muted" style={{ margin: "4px 0 0" }}>
            App configuration, metafield setup, and debug information.
          </p>
        </div>

        <section className="sdl-card">
          <div className="sdl-card__header">
            <div>
              <div className="sdl-card__title">App info</div>
              <div className="sdl-card__subtitle">Current app and environment details.</div>
            </div>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <div className="sdl-subtle-card">
              <strong>Shop:</strong> {loaderData.shop}
            </div>
            <div className="sdl-subtle-card">
              <strong>Shopify API version:</strong> {loaderData.apiVersion}
            </div>
            <div className="sdl-subtle-card">
              <strong>Product configs:</strong> {loaderData.configCount}
            </div>
            <div className="sdl-subtle-card">
              <strong>Presets:</strong> {loaderData.presetCount}
            </div>
            <div className="sdl-subtle-card">
              <strong>Sync runs:</strong> {loaderData.syncRunCount}
            </div>
          </div>
        </section>

        <section className="sdl-card">
          <div className="sdl-card__header">
            <div>
              <div className="sdl-card__title">Company logo</div>
              <div className="sdl-card__subtitle">
                Used as the loading poster while 3D models load. Paste any public image URL.
              </div>
            </div>
          </div>
          <logoFetcher.Form method="post" action="/api/sdl3d/settings">
            <input type="hidden" name="intent" value="saveLogo" />
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <label className="sdl-label">Logo URL</label>
                <input
                  type="url"
                  name="logoUrl"
                  className="sdl-input"
                  value={logoInput}
                  onChange={(e) => setLogoInput(e.target.value)}
                  placeholder="https://cdn.shopify.com/…/logo.png"
                  style={{ width: "100%" }}
                />
              </div>
              <button type="submit" className="sdl-btn sdl-btn--primary" disabled={logoFetcher.state !== "idle"}>
                {logoFetcher.state !== "idle" ? "Saving…" : "Save"}
              </button>
            </div>
            {logoInput ? (
              <div style={{ marginTop: 12 }}>
                <img
                  src={logoInput}
                  alt="Logo preview"
                  style={{ maxHeight: 60, maxWidth: 200, borderRadius: 8, background: "#f1f5f9", padding: 4 }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>
            ) : null}
          </logoFetcher.Form>
          {logoFetcher.data?.ok ? (
            <div className="sdl-subtle-card" style={{ marginTop: 12 }}>Logo saved.</div>
          ) : null}
        </section>

        <section className="sdl-card">
          <div className="sdl-card__header">
            <div>
              <div className="sdl-card__title">Appearance</div>
              <div className="sdl-card__subtitle">Choose your preferred color theme for the app.</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              className={`sdl-btn ${darkMode ? "sdl-btn--primary" : "sdl-btn--secondary"}`}
              onClick={() => {
                const next = !darkMode;
                setDarkMode(next);
                const fd = new FormData();
                fd.set("intent", "saveDarkMode");
                fd.set("darkMode", String(next));
                darkModeFetcher.submit(fd, { method: "post", action: "/api/sdl3d/settings" });
              }}
            >
              {darkMode ? "Switch to Light mode" : "Switch to Dark mode"}
            </button>
            <span className="sdl-text-muted" style={{ fontSize: 13 }}>
              Currently: <strong>{darkMode ? "Dark" : "Light"}</strong>
            </span>
            {darkModeFetcher.state !== "idle" && (
              <span className="sdl-text-muted" style={{ fontSize: 12 }}>Saving...</span>
            )}
          </div>
        </section>

        <section className="sdl-card">
          <div className="sdl-card__header">
            <div>
              <div className="sdl-card__title">Onboarding</div>
              <div className="sdl-card__subtitle">
                Walk through the getting-started guide again.
              </div>
            </div>
          </div>
          <onboardingFetcher.Form method="post" action="/api/sdl3d/onboarding">
            <input type="hidden" name="intent" value="resetOnboarding" />
            <button type="submit" className="sdl-btn sdl-btn--secondary" disabled={onboardingFetcher.state !== "idle"}>
              {onboardingFetcher.state !== "idle" ? "Resetting…" : "Restart onboarding wizard"}
            </button>
          </onboardingFetcher.Form>
          {onboardingData?.resetOnboarding ? (
            <div className="sdl-subtle-card" style={{ marginTop: 12 }}>
              Onboarding reset. <a href="/app" style={{ color: "#2563eb" }}>Go to Home</a> to start the wizard.
            </div>
          ) : null}
        </section>

        <section className="sdl-card">
          <div className="sdl-card__header">
            <div>
              <div className="sdl-card__title">Metafield definitions</div>
              <div className="sdl-card__subtitle">
                SDL 3D uses product metafields under the <code>sdl_3d</code> namespace. Run setup to create or verify definitions.
              </div>
            </div>
          </div>

          <metafieldFetcher.Form method="post" action="/api/sdl3d/settings">
            <input type="hidden" name="intent" value="ensureMetafields" />
            <button type="submit" className="sdl-btn sdl-btn--primary sdl-mb-3" disabled={metafieldFetcher.state !== "idle"}>
              {metafieldFetcher.state !== "idle" ? "Running setup…" : "Create / verify metafield definitions"}
            </button>
          </metafieldFetcher.Form>

          {metafieldData?.results?.length ? (
            <div className="sdl-mb-3">
              <div className="sdl-label" style={{ marginBottom: 8 }}>Setup results</div>
              <div style={{ display: "grid", gap: 6 }}>
                {metafieldData.results.map((r) => (
                  <div key={r.key} className="sdl-subtle-card">
                    <strong>{r.key}</strong>
                    <span className={`sdl-badge sdl-badge--${r.status === "created" || r.status === "exists" ? "success" : "warning"}`} style={{ marginLeft: 8 }}>
                      {r.status}
                    </span>
                    {r.message ? <span className="sdl-text-muted" style={{ marginLeft: 8 }}>{r.message}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <div className="sdl-label" style={{ marginBottom: 8 }}>Current definitions ({loaderData.definitions.length})</div>
            {loaderData.definitions.length > 0 ? (
              <div style={{ display: "grid", gap: 6 }}>
                {loaderData.definitions.map((d) => (
                  <div key={d.id} className="sdl-subtle-card">
                    <code style={{ fontSize: 13 }}>{d.namespace}.{d.key}</code>
                    <span className="sdl-text-muted" style={{ marginLeft: 8 }}>{d.name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="sdl-text-muted">
                No SDL 3D metafield definitions found. Run setup above to create them.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} — ${error.statusText || "Something went wrong"}`
    : error instanceof Error ? error.message : "An unexpected error occurred.";

  return (
    <div className="sdl-editor" data-theme="light">
      <div style={{ maxWidth: 600, margin: "60px auto", padding: 24, textAlign: "center" }}>
        <h2>Settings error</h2>
        <p>{message}</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <a href="/app/sdl3d/settings" className="sdl-btn sdl-btn--primary">Reload</a>
          <a href="/app" className="sdl-btn">Dashboard</a>
        </div>
      </div>
    </div>
  );
}
