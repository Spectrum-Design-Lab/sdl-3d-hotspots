/**
 * Storage settings page — list of configured providers with inline add/edit
 * (Slice 5B). Captures upload to the row marked `isDefault`. Single-row
 * merchants see the same flow as before (the migration leaves the existing
 * row as the default), just rendered as a list of one.
 */
import { useEffect, useMemo, useState } from "react";
import {
  useLoaderData,
  useFetcher,
  useRouteError,
  isRouteErrorResponse,
} from "react-router";
import shopify from "../shopify.server";
import { ensureShop } from "../lib/sdl3d-graphql.server";
import { listStoragesForShop, type ShopStorageSummary } from "../lib/storage.server";
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

function providerLabel(value: StorageProvider): string {
  return STORAGE_PROVIDERS.find((p) => p.value === value)?.label ?? value;
}

type StorageActionData = { ok?: boolean; message?: string; storageId?: string };

type LoaderData = {
  shop: string;
  darkMode: boolean;
  hasEncryptionKey: boolean;
  storages: ShopStorageSummary[];
};

export async function loader({ request }: { request: Request }) {
  const { session } = await shopify.authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const storages = await listStoragesForShop(shop.id);
  const hasEncryptionKey = Boolean(process.env.STORAGE_ENC_KEY);

  return {
    shop: session.shop,
    darkMode: shop.darkMode ?? false,
    hasEncryptionKey,
    storages,
  } satisfies LoaderData;
}

// `null` = no panel open. `"new"` = Add panel open. otherwise = edit a row by id.
type OpenPanel = null | "new" | string;

export default function Sdl3dStorageRoute() {
  const data = useLoaderData<typeof loader>();
  const [openPanel, setOpenPanel] = useState<OpenPanel>(() =>
    data.storages.length === 0 ? "new" : null,
  );

  // Auto-open Add panel on first visit (no rows yet) — but also collapse the
  // panel once the merchant saves their first row.
  useEffect(() => {
    if (data.storages.length === 0 && openPanel !== "new") setOpenPanel("new");
  }, [data.storages.length, openPanel]);

  const configuredProviders = useMemo(
    () => new Set(data.storages.map((s) => s.provider)),
    [data.storages],
  );
  const availableProvidersForAdd = useMemo(
    () => STORAGE_PROVIDERS.filter((p) => !configuredProviders.has(p.value)),
    [configuredProviders],
  );
  const canAddMore = availableProvidersForAdd.some((p) => !p.comingSoon);

  return (
    <div className="sdl-editor sdl-editor--page" data-theme={data.darkMode ? "dark" : "light"}>
      <div className="sdl-editor__inner" style={{ maxWidth: 760 }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Storage</h1>
          <p className="sdl-text-muted" style={{ margin: "4px 0 0" }}>
            Connect one or more object-storage buckets. Captures upload to the bucket marked <strong>default</strong>.
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

        <div style={{ display: "grid", gap: 12 }}>
          {data.storages.map((row) =>
            openPanel === row.id ? (
              <StorageEditPanel
                key={row.id}
                row={row}
                onClose={() => setOpenPanel(null)}
                hasEncryptionKey={data.hasEncryptionKey}
              />
            ) : (
              <StorageRowCard
                key={row.id}
                row={row}
                onEdit={() => setOpenPanel(row.id)}
              />
            ),
          )}

          {openPanel === "new" ? (
            <StorageEditPanel
              row={null}
              availableProviders={availableProvidersForAdd}
              onClose={() => setOpenPanel(null)}
              hasEncryptionKey={data.hasEncryptionKey}
            />
          ) : (
            <button
              type="button"
              className="sdl-btn"
              disabled={!canAddMore || !data.hasEncryptionKey}
              onClick={() => setOpenPanel("new")}
              title={
                !canAddMore
                  ? "All available providers are already configured."
                  : !data.hasEncryptionKey
                    ? "Set STORAGE_ENC_KEY first."
                    : undefined
              }
              style={{ justifySelf: "start" }}
            >
              + Add provider
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StorageRowCard({
  row,
  onEdit,
}: {
  row: ShopStorageSummary;
  onEdit: () => void;
}) {
  const defaultFetcher = useFetcher<StorageActionData>();
  const deleteFetcher = useFetcher<StorageActionData>();

  const isBusy = defaultFetcher.state !== "idle" || deleteFetcher.state !== "idle";

  const testedAtLabel = row.testedAt ? new Date(row.testedAt).toLocaleString() : null;

  const handleDelete = () => {
    const confirmMsg = row.isDefault
      ? "Delete this provider? It is currently the default — another provider (if any) will be promoted automatically."
      : "Delete this provider? Existing captures stamped against this row will keep their reference, but new uploads will need a different provider.";
    if (!window.confirm(confirmMsg)) return;
    const fd = new FormData();
    fd.set("intent", "deleteStorage");
    fd.set("storageId", row.id);
    deleteFetcher.submit(fd, { method: "post", action: "/api/sdl3d/storage" });
  };

  const handleSetDefault = () => {
    const fd = new FormData();
    fd.set("intent", "setDefault");
    fd.set("storageId", row.id);
    defaultFetcher.submit(fd, { method: "post", action: "/api/sdl3d/storage" });
  };

  return (
    <section className="sdl-card">
      <div className="sdl-card__header">
        <div>
          <div className="sdl-card__title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {providerLabel(row.provider)}
            {row.isDefault ? (
              <span
                className="sdl-subtle-card"
                style={{
                  padding: "2px 8px",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  borderColor: "#10b981",
                  color: "#10b981",
                }}
              >
                Default
              </span>
            ) : null}
          </div>
          <div className="sdl-card__subtitle">
            <code>{row.bucket}</code> @ <code>{row.endpoint}</code>
            {row.region ? <> · region <code>{row.region}</code></> : null}
          </div>
          {testedAtLabel ? (
            <div
              className="sdl-text-muted"
              style={{ fontSize: 12, marginTop: 4 }}
              suppressHydrationWarning
            >
              Last tested: {testedAtLabel}
            </div>
          ) : (
            <div className="sdl-text-muted" style={{ fontSize: 12, marginTop: 4 }}>
              Not yet tested
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!row.isDefault ? (
            <button
              type="button"
              className="sdl-btn"
              disabled={isBusy}
              onClick={handleSetDefault}
            >
              {defaultFetcher.state !== "idle" ? "Setting…" : "Set as default"}
            </button>
          ) : null}
          <button type="button" className="sdl-btn" disabled={isBusy} onClick={onEdit}>
            Edit
          </button>
          <button
            type="button"
            className="sdl-btn"
            disabled={isBusy}
            onClick={handleDelete}
            style={{ color: "#dc2626" }}
          >
            {deleteFetcher.state !== "idle" ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>

      {defaultFetcher.data?.message && !defaultFetcher.data.ok ? (
        <div className="sdl-subtle-card" style={{ borderColor: "#dc2626", marginTop: 12 }}>
          {defaultFetcher.data.message}
        </div>
      ) : null}
      {deleteFetcher.data?.message && !deleteFetcher.data.ok ? (
        <div className="sdl-subtle-card" style={{ borderColor: "#dc2626", marginTop: 12 }}>
          {deleteFetcher.data.message}
        </div>
      ) : null}
    </section>
  );
}

function StorageEditPanel({
  row,
  availableProviders,
  onClose,
  hasEncryptionKey,
}: {
  row: ShopStorageSummary | null;
  availableProviders?: ReadonlyArray<{ value: StorageProvider; label: string; comingSoon?: boolean }>;
  onClose: () => void;
  hasEncryptionKey: boolean;
}) {
  const isEdit = row !== null;
  const saveFetcher = useFetcher<StorageActionData>();
  const testFetcher = useFetcher<StorageActionData>();

  const [provider, setProvider] = useState<StorageProvider | "">(row?.provider ?? "");
  const [endpoint, setEndpoint] = useState(row?.endpoint ?? "");
  const [region, setRegion] = useState(row?.region ?? "");
  const [bucket, setBucket] = useState(row?.bucket ?? "");
  const [spaceUrl, setSpaceUrl] = useState(() =>
    deriveSpaceUrl(row?.bucket ?? "", row?.endpoint ?? ""),
  );
  const [publicBaseUrl, setPublicBaseUrl] = useState(row?.publicBaseUrl ?? "");
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");

  // Close the panel as soon as a save succeeds — the loader has already
  // revalidated by then so the new/updated row appears in the list.
  useEffect(() => {
    if (saveFetcher.state === "idle" && saveFetcher.data?.ok) {
      onClose();
    }
  }, [saveFetcher.state, saveFetcher.data, onClose]);

  const onSpaceUrlChange = (next: string) => {
    setSpaceUrl(next);
    const parsed = parseSpaceUrl(next);
    if (parsed.bucket !== undefined) setBucket(parsed.bucket);
    if (parsed.endpoint !== undefined) setEndpoint(parsed.endpoint);
    if (parsed.region !== undefined) setRegion(parsed.region);
  };
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
  const hasSavedCreds = isEdit;
  const canTest = hasSavedCreds || Boolean(provider && endpoint && bucket && accessKey && secretKey);
  const canSubmit = hasSavedCreds
    ? Boolean(provider && endpoint && bucket)
    : Boolean(provider && endpoint && bucket && accessKey && secretKey);

  return (
    <section className="sdl-card">
      <div className="sdl-card__header">
        <div>
          <div className="sdl-card__title">
            {isEdit ? `Edit ${providerLabel(row!.provider)}` : "Add provider"}
          </div>
          <div className="sdl-card__subtitle">
            Stored encrypted (AES-256-GCM) in your app database. Never sent to Spectrum Design Lab.
          </div>
        </div>
        <button type="button" className="sdl-btn" onClick={onClose}>
          Cancel
        </button>
      </div>

      <saveFetcher.Form method="post" action="/api/sdl3d/storage">
        <input type="hidden" name="intent" value="saveCredentials" />
        {isEdit ? <input type="hidden" name="storageId" value={row!.id} /> : null}

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
              disabled={isEdit}
            >
              <option value="" disabled>Select a provider…</option>
              {(isEdit ? STORAGE_PROVIDERS : availableProviders ?? STORAGE_PROVIDERS).map((p) => (
                <option key={p.value} value={p.value} disabled={p.comingSoon}>
                  {p.label}
                </option>
              ))}
            </select>
            {isEdit ? (
              <div className="sdl-text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                Provider can't change on edit — delete and re-add to change.
              </div>
            ) : null}
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
                placeholder={isEdit ? "••••••••••••••••" : "AKIA…"}
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
                placeholder={isEdit ? "••••••••••••••••••••••••" : "•••••"}
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
              disabled={!canSubmit || isSaving || !hasEncryptionKey}
            >
              {isSaving ? "Saving…" : isEdit ? "Update credentials" : "Save credentials"}
            </button>

            <button
              type="button"
              className="sdl-btn"
              disabled={!canTest || isTesting}
              onClick={() => {
                const fd = new FormData();
                fd.set("intent", "testConnection");
                if (isEdit) fd.set("storageId", row!.id);
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
          </div>

          {saveFetcher.data?.message && !saveFetcher.data.ok ? (
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
