import { useState } from "react";
import { useLoaderData, useFetcher, useRouteError, isRouteErrorResponse } from "react-router";
import shopify from "../shopify.server";
import prisma from "../db.server";
import { ensureShop } from "../lib/sdl3d-graphql.server";
import { STORAGE_PROVIDERS, type StorageProvider } from "../lib/storage-shared";
import "../styles/editor.css";

function parseSpaceUrl(input: string): { bucket?: string; endpoint?: string; region?: string } {
  const trimmed = input.trim();
  if (!trimmed) return {};
  try {
    const u = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    const parts = u.hostname.split(".");
    if (parts.length < 2) return {};
    const [bucket, ...rest] = parts;
    return {
      bucket,
      endpoint: rest.join("."),
      // First label of the endpoint is the region on DO Spaces / S3 path-style hosts.
      region: rest[0],
    };
  } catch {
    return {};
  }
}

function deriveSpaceUrl(bucket: string, endpoint: string): string {
  if (!bucket || !endpoint) return "";
  const host = endpoint.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return `https://${bucket}.${host}`;
}

type StorageActionData = { ok?: boolean; message?: string };

type LoaderData = {
  shop: string;
  darkMode: boolean;
  hasEncryptionKey: boolean;
  storage: {
    provider: StorageProvider | "";
    endpoint: string;
    region: string;
    bucket: string;
    publicBaseUrl: string;
    accessKeyMasked: string;
    secretKeyMasked: string;
    testedAt: string | null;
    updatedAt: string | null;
  };
};

export async function loader({ request }: { request: Request }) {
  const { session } = await shopify.authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const row = await prisma.shopStorage.findUnique({ where: { shopId: shop.id } });
  const hasEncryptionKey = Boolean(process.env.STORAGE_ENC_KEY);

  return {
    shop: session.shop,
    darkMode: shop.darkMode ?? false,
    hasEncryptionKey,
    storage: {
      provider: (row?.provider as StorageProvider | undefined) ?? "",
      endpoint: row?.endpoint ?? "",
      region: row?.region ?? "",
      bucket: row?.bucket ?? "",
      publicBaseUrl: row?.publicBaseUrl ?? "",
      accessKeyMasked: row ? "••••••••••••••••" : "",
      secretKeyMasked: row ? "••••••••••••••••••••••••" : "",
      testedAt: row?.testedAt ? row.testedAt.toISOString() : null,
      updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
    },
  } satisfies LoaderData;
}

export default function Sdl3dStorageRoute() {
  const data = useLoaderData<typeof loader>();
  const saveFetcher = useFetcher<StorageActionData>();
  const testFetcher = useFetcher<StorageActionData>();

  const [provider, setProvider] = useState<StorageProvider | "">(data.storage.provider);
  const [endpoint, setEndpoint] = useState(data.storage.endpoint);
  const [region, setRegion] = useState(data.storage.region);
  const [bucket, setBucket] = useState(data.storage.bucket);
  const [spaceUrl, setSpaceUrl] = useState(() =>
    deriveSpaceUrl(data.storage.bucket, data.storage.endpoint),
  );
  const [publicBaseUrl, setPublicBaseUrl] = useState(data.storage.publicBaseUrl);
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");

  // URL field → fills bucket / endpoint / region as it parses.
  const onSpaceUrlChange = (next: string) => {
    setSpaceUrl(next);
    const parsed = parseSpaceUrl(next);
    if (parsed.bucket !== undefined) setBucket(parsed.bucket);
    if (parsed.endpoint !== undefined) setEndpoint(parsed.endpoint);
    if (parsed.region !== undefined) setRegion(parsed.region);
  };

  // Editing any individual field rebuilds the URL so the two views stay in sync.
  const onBucketChange = (next: string) => {
    setBucket(next);
    setSpaceUrl(deriveSpaceUrl(next, endpoint));
  };
  const onEndpointChange = (next: string) => {
    setEndpoint(next);
    setSpaceUrl(deriveSpaceUrl(bucket, next));
  };

  const isSaving = saveFetcher.state !== "idle";
  const isTesting = testFetcher.state !== "idle";

  const hasSavedCreds = Boolean(data.storage.accessKeyMasked);
  const canTest = hasSavedCreds || Boolean(provider && endpoint && bucket && accessKey && secretKey);
  const canSubmit = hasSavedCreds
    ? Boolean(provider && endpoint && bucket)
    : Boolean(provider && endpoint && bucket && accessKey && secretKey);

  const testedAtLabel = data.storage.testedAt
    ? new Date(data.storage.testedAt).toLocaleString()
    : null;

  return (
    <div className="sdl-editor" data-theme={data.darkMode ? "dark" : "light"}>
      <div className="sdl-editor__inner" style={{ maxWidth: 760, margin: "0 auto", padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Storage</h1>
          <p className="sdl-text-muted" style={{ margin: "4px 0 0" }}>
            Connect your object storage bucket. The app uploads captures and serves frame URLs from here.
          </p>
        </div>

        {!data.hasEncryptionKey ? (
          <section className="sdl-card" style={{ borderColor: "#dc2626" }}>
            <div className="sdl-card__header">
              <div>
                <div className="sdl-card__title">Encryption key missing</div>
                <div className="sdl-card__subtitle">
                  Set <code>STORAGE_ENC_KEY</code> in the deployment environment before saving credentials. Generate with{" "}
                  <code>openssl rand -hex 32</code>. Once lost, encrypted credentials cannot be recovered — keep a copy in your secrets manager.
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <section className="sdl-card">
          <div className="sdl-card__header">
            <div>
              <div className="sdl-card__title">Bucket credentials</div>
              <div className="sdl-card__subtitle">
                Stored encrypted (AES-256-GCM) in your app database. Never sent to Spectrum Design Lab.
              </div>
            </div>
          </div>

          <saveFetcher.Form method="post" action="/api/sdl3d/storage">
            <input type="hidden" name="intent" value="saveCredentials" />

            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <label className="sdl-label" htmlFor="storage-provider">Provider</label>
                <select
                  id="storage-provider"
                  className="sdl-input"
                  name="provider"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as StorageProvider | "")}
                  required
                >
                  <option value="" disabled>Select a provider…</option>
                  {STORAGE_PROVIDERS.map((p) => (
                    <option key={p.value} value={p.value} disabled={p.comingSoon}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="sdl-label" htmlFor="storage-space-url">Space URL</label>
                <input
                  id="storage-space-url"
                  className="sdl-input"
                  type="url"
                  autoComplete="off"
                  placeholder="https://my-bucket.fra1.digitaloceanspaces.com"
                  value={spaceUrl}
                  onChange={(e) => onSpaceUrlChange(e.target.value)}
                />
                <div className="sdl-text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                  Paste the full URL DigitalOcean shows for your Space. The endpoint, region, and bucket below will fill in automatically. Edit any field below to fine-tune.
                </div>
              </div>

              <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label className="sdl-label" htmlFor="storage-endpoint">Endpoint</label>
                  <input
                    id="storage-endpoint"
                    className="sdl-input"
                    name="endpoint"
                    placeholder="fra1.digitaloceanspaces.com"
                    value={endpoint}
                    onChange={(e) => onEndpointChange(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="sdl-label" htmlFor="storage-region">Region</label>
                  <input
                    id="storage-region"
                    className="sdl-input"
                    name="region"
                    placeholder="fra1"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="sdl-label" htmlFor="storage-bucket">Bucket</label>
                <input
                  id="storage-bucket"
                  className="sdl-input"
                  name="bucket"
                  placeholder="my-merchant-assets"
                  value={bucket}
                  onChange={(e) => onBucketChange(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label className="sdl-label" htmlFor="storage-access-key">Access key ID</label>
                  <input
                    id="storage-access-key"
                    className="sdl-input"
                    name="accessKey"
                    autoComplete="off"
                    placeholder={data.storage.accessKeyMasked || "AKIA…"}
                    value={accessKey}
                    onChange={(e) => setAccessKey(e.target.value)}
                    required={!hasSavedCreds}
                  />
                </div>
                <div>
                  <label className="sdl-label" htmlFor="storage-secret-key">Secret access key</label>
                  <input
                    id="storage-secret-key"
                    className="sdl-input"
                    name="secretKey"
                    type="password"
                    autoComplete="off"
                    placeholder={data.storage.secretKeyMasked || "•••••"}
                    value={secretKey}
                    onChange={(e) => setSecretKey(e.target.value)}
                    required={!hasSavedCreds}
                  />
                </div>
              </div>
              {hasSavedCreds ? (
                <div className="sdl-text-muted" style={{ fontSize: 12, marginTop: -8 }}>
                  Leave the key fields blank to keep the existing credentials and only update the other fields.
                </div>
              ) : null}

              <div>
                <label className="sdl-label" htmlFor="storage-public-url">Public base URL (optional)</label>
                <input
                  id="storage-public-url"
                  className="sdl-input"
                  name="publicBaseUrl"
                  placeholder="https://cdn.example.com"
                  value={publicBaseUrl}
                  onChange={(e) => setPublicBaseUrl(e.target.value)}
                />
                <div className="sdl-text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                  CDN domain in front of the bucket, used to build storefront-facing URLs. Leave blank if frames are served directly from the bucket.
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  type="submit"
                  className="sdl-btn sdl-btn--primary"
                  disabled={!canSubmit || isSaving || !data.hasEncryptionKey}
                >
                  {isSaving ? "Saving…" : hasSavedCreds ? "Update credentials" : "Save credentials"}
                </button>

                <button
                  type="button"
                  className="sdl-btn"
                  disabled={!canTest || isTesting}
                  onClick={() => {
                    const fd = new FormData();
                    fd.set("intent", "testConnection");
                    if (provider) fd.set("provider", provider);
                    if (endpoint) fd.set("endpoint", endpoint);
                    if (region) fd.set("region", region);
                    if (bucket) fd.set("bucket", bucket);
                    if (publicBaseUrl) fd.set("publicBaseUrl", publicBaseUrl);
                    if (accessKey) fd.set("accessKey", accessKey);
                    if (secretKey) fd.set("secretKey", secretKey);
                    testFetcher.submit(fd, { method: "post", action: "/api/sdl3d/storage" });
                  }}
                >
                  {isTesting ? "Testing…" : "Test connection"}
                </button>

                {testedAtLabel ? (
                  <span className="sdl-text-muted" style={{ fontSize: 12 }}>
                    Last tested: {testedAtLabel}
                  </span>
                ) : null}
              </div>

              {saveFetcher.data?.ok ? (
                <div className="sdl-subtle-card">Credentials saved.</div>
              ) : saveFetcher.data?.message ? (
                <div className="sdl-subtle-card" style={{ borderColor: "#dc2626" }}>
                  {saveFetcher.data.message}
                </div>
              ) : null}

              {testFetcher.data?.ok ? (
                <div className="sdl-subtle-card">Connection successful — bucket reachable.</div>
              ) : testFetcher.data?.message ? (
                <div className="sdl-subtle-card" style={{ borderColor: "#dc2626" }}>
                  {testFetcher.data.message}
                </div>
              ) : null}
            </div>
          </saveFetcher.Form>
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
        <h2>Storage error</h2>
        <p>{message}</p>
        <a href="/app/sdl3d/storage" className="sdl-btn sdl-btn--primary">Reload</a>
      </div>
    </div>
  );
}
