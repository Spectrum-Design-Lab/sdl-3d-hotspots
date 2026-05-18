/**
 * Storage settings page — Polaris migration (Slice 5C PR #2).
 *
 * Builds on the multi-provider data model that landed in Slice 5B and replaces
 * the bespoke card list + inline edit panel with Polaris primitives:
 *   - Page header with primaryAction for "Add provider"
 *   - ResourceList for the configured providers, one ResourceItem per row
 *   - Modal for add/edit (single Modal toggling between modes)
 *   - Modal for delete confirmation (replaces window.confirm)
 *   - Toast for save/test/delete/default-switch feedback
 *   - Badge tones for "Default" + "Tested OK / Not tested / Last failed"
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useLoaderData,
  useFetcher,
  useRouteError,
  isRouteErrorResponse,
} from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  EmptyState,
  Form as PolarisForm,
  FormLayout,
  Frame,
  InlineStack,
  Layout,
  Modal,
  Page,
  ResourceItem,
  ResourceList,
  Select,
  Text,
  TextField,
  Toast,
} from "@shopify/polaris";

import shopify from "../shopify.server";
import { ensureShop } from "../lib/sdl3d-graphql.server";
import { listStoragesForShop, type ShopStorageSummary } from "../lib/storage.server";
import { STORAGE_PROVIDERS, type StorageProvider } from "../lib/storage-shared";

type StorageActionData = {
  ok?: boolean;
  message?: string;
  storageId?: string;
  promotedStorageId?: string | null;
};

type LoaderData = {
  shop: string;
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
    hasEncryptionKey,
    storages,
  } satisfies LoaderData;
}

function parseSpaceUrl(input: string): { bucket?: string; endpoint?: string; region?: string } {
  const trimmed = input.trim();
  if (!trimmed) return {};
  try {
    const u = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    const parts = u.hostname.split(".");
    if (parts.length < 2) return {};
    const [bucket, ...rest] = parts;
    return { bucket, endpoint: rest.join("."), region: rest[0] };
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

type ModalState =
  | { mode: "closed" }
  | { mode: "add" }
  | { mode: "edit"; row: ShopStorageSummary };

export default function Sdl3dStorageRoute() {
  const data = useLoaderData<typeof loader>();
  const [modalState, setModalState] = useState<ModalState>({ mode: "closed" });
  const [deleteTarget, setDeleteTarget] = useState<ShopStorageSummary | null>(null);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);

  const configuredProviders = useMemo(
    () => new Set(data.storages.map((s) => s.provider)),
    [data.storages],
  );
  const availableProvidersForAdd = useMemo(
    () => STORAGE_PROVIDERS.filter((p) => !configuredProviders.has(p.value)),
    [configuredProviders],
  );
  const canAddMore = availableProvidersForAdd.some((p) => !p.comingSoon);

  const handleOpenAdd = useCallback(() => setModalState({ mode: "add" }), []);
  const handleOpenEdit = useCallback(
    (row: ShopStorageSummary) => setModalState({ mode: "edit", row }),
    [],
  );
  const handleCloseModal = useCallback(() => setModalState({ mode: "closed" }), []);

  return (
    <Frame>
      <Page
        title="Storage"
        subtitle="Connect one or more object-storage buckets. Captures upload to the bucket marked default."
        primaryAction={{
          content: "Add provider",
          onAction: handleOpenAdd,
          disabled: !canAddMore || !data.hasEncryptionKey,
          helpText: !canAddMore
            ? "All available providers are already configured."
            : !data.hasEncryptionKey
              ? "Set STORAGE_ENC_KEY first."
              : undefined,
        }}
      >
        <Layout>
          {!data.hasEncryptionKey ? (
            <Layout.Section>
              <Banner tone="critical" title="Encryption key missing">
                <BlockStack gap="200">
                  <Text as="p">
                    Set <code>STORAGE_ENC_KEY</code> in the deployment environment before saving credentials. Generate with{" "}
                    <code>openssl rand -hex 32</code>.
                  </Text>
                  <Text as="p" tone="subdued">
                    Once lost, encrypted credentials cannot be recovered — keep a copy in your secrets manager.
                  </Text>
                </BlockStack>
              </Banner>
            </Layout.Section>
          ) : null}

          <Layout.Section>
            <Card padding="0">
              {data.storages.length === 0 ? (
                <Box padding="500">
                  <EmptyState
                    heading="No storage configured yet"
                    action={{
                      content: "Add provider",
                      onAction: handleOpenAdd,
                      disabled: !data.hasEncryptionKey,
                    }}
                    image=""
                  >
                    <Text as="p">
                      Connect a DigitalOcean Spaces, AWS S3, Cloudflare R2, or Bunny.net bucket so the capture pipeline has somewhere to upload frames.
                    </Text>
                  </EmptyState>
                </Box>
              ) : (
                <ResourceList
                  resourceName={{ singular: "provider", plural: "providers" }}
                  items={data.storages}
                  renderItem={(row) => (
                    <StorageResourceRow
                      key={row.id}
                      row={row}
                      onEdit={() => handleOpenEdit(row)}
                      onDelete={() => setDeleteTarget(row)}
                      onSetDefault={() => undefined /* handled inside row via fetcher */}
                      onToast={setToast}
                    />
                  )}
                />
              )}
            </Card>
          </Layout.Section>
        </Layout>

        {modalState.mode !== "closed" ? (
          <StorageEditModal
            state={modalState}
            availableProvidersForAdd={availableProvidersForAdd}
            hasEncryptionKey={data.hasEncryptionKey}
            onClose={handleCloseModal}
            onToast={setToast}
          />
        ) : null}

        {deleteTarget ? (
          <StorageDeleteModal
            row={deleteTarget}
            onClose={() => setDeleteTarget(null)}
            onToast={setToast}
          />
        ) : null}
      </Page>

      {toast ? (
        <Toast
          content={toast.message}
          error={toast.error}
          onDismiss={() => setToast(null)}
          duration={4000}
        />
      ) : null}
    </Frame>
  );
}

function StorageResourceRow({
  row,
  onEdit,
  onDelete,
  onToast,
}: {
  row: ShopStorageSummary;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  onToast: (t: { message: string; error?: boolean }) => void;
}) {
  const defaultFetcher = useFetcher<StorageActionData>();
  const isSettingDefault = defaultFetcher.state !== "idle";

  useEffect(() => {
    if (defaultFetcher.state === "idle" && defaultFetcher.data) {
      if (defaultFetcher.data.ok) {
        onToast({ message: `${providerLabel(row.provider)} is now the default.` });
      } else if (defaultFetcher.data.message) {
        onToast({ message: defaultFetcher.data.message, error: true });
      }
    }
  }, [defaultFetcher.state, defaultFetcher.data, onToast, row.provider]);

  const handleSetDefault = useCallback(() => {
    const fd = new FormData();
    fd.set("intent", "setDefault");
    fd.set("storageId", row.id);
    defaultFetcher.submit(fd, { method: "post", action: "/api/sdl3d/storage" });
  }, [defaultFetcher, row.id]);

  const testedAtLabel = row.testedAt ? new Date(row.testedAt).toLocaleString() : null;
  const testStatus: { tone: "success" | "warning" | "info"; label: string } = row.testedAt
    ? { tone: "success", label: "Tested" }
    : { tone: "warning", label: "Not tested" };

  return (
    <ResourceItem
      id={row.id}
      onClick={onEdit}
      accessibilityLabel={`Edit ${providerLabel(row.provider)}`}
    >
      <BlockStack gap="200">
        <InlineStack gap="300" blockAlign="center" wrap={false}>
          <Text as="h3" variant="headingSm">
            {providerLabel(row.provider)}
          </Text>
          {row.isDefault ? <Badge tone="success">Default</Badge> : null}
          <Badge tone={testStatus.tone}>{testStatus.label}</Badge>
        </InlineStack>
        <Text as="p" tone="subdued">
          <code>{row.bucket}</code> @ <code>{row.endpoint}</code>
          {row.region ? <> · region <code>{row.region}</code></> : null}
        </Text>
        {testedAtLabel ? (
          <Text as="p" tone="subdued" variant="bodySm">
            <span suppressHydrationWarning>Last tested: {testedAtLabel}</span>
          </Text>
        ) : null}
        <InlineStack gap="200">
          {!row.isDefault ? (
            <Button
              size="slim"
              onClick={handleSetDefault}
              loading={isSettingDefault}
              disabled={isSettingDefault}
            >
              Set as default
            </Button>
          ) : null}
          <Button size="slim" onClick={onEdit}>
            Edit
          </Button>
          <Button size="slim" tone="critical" onClick={onDelete}>
            Delete
          </Button>
        </InlineStack>
      </BlockStack>
    </ResourceItem>
  );
}

function StorageEditModal({
  state,
  availableProvidersForAdd,
  hasEncryptionKey,
  onClose,
  onToast,
}: {
  state: { mode: "add" } | { mode: "edit"; row: ShopStorageSummary };
  availableProvidersForAdd: ReadonlyArray<{
    value: StorageProvider;
    label: string;
    comingSoon?: boolean;
  }>;
  hasEncryptionKey: boolean;
  onClose: () => void;
  onToast: (t: { message: string; error?: boolean }) => void;
}) {
  const saveFetcher = useFetcher<StorageActionData>();
  const testFetcher = useFetcher<StorageActionData>();
  const isEdit = state.mode === "edit";
  const row = isEdit ? state.row : null;

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

  // Polaris Select wants string options; build them from STORAGE_PROVIDERS.
  const providerOptions = useMemo(() => {
    const all = isEdit ? STORAGE_PROVIDERS : availableProvidersForAdd;
    return [
      { label: "Select a provider…", value: "", disabled: true },
      ...all.map((p) => ({
        label: p.label,
        value: p.value,
        disabled: p.comingSoon,
      })),
    ];
  }, [isEdit, availableProvidersForAdd]);

  // Close on successful save.
  useEffect(() => {
    if (saveFetcher.state === "idle" && saveFetcher.data?.ok) {
      onToast({
        message: isEdit
          ? "Storage credentials updated."
          : "Storage provider added.",
      });
      onClose();
    } else if (saveFetcher.state === "idle" && saveFetcher.data?.message && !saveFetcher.data.ok) {
      onToast({ message: saveFetcher.data.message, error: true });
    }
  }, [saveFetcher.state, saveFetcher.data, isEdit, onClose, onToast]);

  // Surface test connection feedback as toast (don't close modal).
  useEffect(() => {
    if (testFetcher.state === "idle" && testFetcher.data) {
      if (testFetcher.data.ok) {
        onToast({ message: "Connection successful — bucket reachable." });
      } else if (testFetcher.data.message) {
        onToast({ message: testFetcher.data.message, error: true });
      }
    }
  }, [testFetcher.state, testFetcher.data, onToast]);

  const onSpaceUrlChange = useCallback((next: string) => {
    setSpaceUrl(next);
    const parsed = parseSpaceUrl(next);
    if (parsed.bucket !== undefined) setBucket(parsed.bucket);
    if (parsed.endpoint !== undefined) setEndpoint(parsed.endpoint);
    if (parsed.region !== undefined) setRegion(parsed.region);
  }, []);
  const onBucketChange = useCallback(
    (next: string) => {
      setBucket(next);
      setSpaceUrl(deriveSpaceUrl(next, endpoint));
    },
    [endpoint],
  );
  const onEndpointChange = useCallback(
    (next: string) => {
      setEndpoint(next);
      setSpaceUrl(deriveSpaceUrl(bucket, next));
    },
    [bucket],
  );

  const isSaving = saveFetcher.state !== "idle";
  const isTesting = testFetcher.state !== "idle";
  const hasSavedCreds = isEdit;
  const canTest = hasSavedCreds || Boolean(provider && endpoint && bucket && accessKey && secretKey);
  const canSubmit = hasSavedCreds
    ? Boolean(provider && endpoint && bucket)
    : Boolean(provider && endpoint && bucket && accessKey && secretKey);

  const handleSubmit = useCallback(() => {
    const fd = new FormData();
    fd.set("intent", "saveCredentials");
    if (isEdit && row) fd.set("storageId", row.id);
    fd.set("provider", provider);
    fd.set("endpoint", endpoint);
    fd.set("region", region);
    fd.set("bucket", bucket);
    fd.set("publicBaseUrl", publicBaseUrl);
    if (accessKey) fd.set("accessKey", accessKey);
    if (secretKey) fd.set("secretKey", secretKey);
    saveFetcher.submit(fd, { method: "post", action: "/api/sdl3d/storage" });
  }, [isEdit, row, provider, endpoint, region, bucket, publicBaseUrl, accessKey, secretKey, saveFetcher]);

  const handleTest = useCallback(() => {
    const fd = new FormData();
    fd.set("intent", "testConnection");
    if (isEdit && row) fd.set("storageId", row.id);
    if (provider) fd.set("provider", provider);
    if (endpoint) fd.set("endpoint", endpoint);
    if (region) fd.set("region", region);
    if (bucket) fd.set("bucket", bucket);
    if (publicBaseUrl) fd.set("publicBaseUrl", publicBaseUrl);
    if (accessKey) fd.set("accessKey", accessKey);
    if (secretKey) fd.set("secretKey", secretKey);
    testFetcher.submit(fd, { method: "post", action: "/api/sdl3d/storage" });
  }, [isEdit, row, provider, endpoint, region, bucket, publicBaseUrl, accessKey, secretKey, testFetcher]);

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Edit ${providerLabel(row!.provider)}` : "Add storage provider"}
      primaryAction={{
        content: isEdit ? "Update credentials" : "Save credentials",
        onAction: handleSubmit,
        loading: isSaving,
        disabled: !canSubmit || !hasEncryptionKey,
      }}
      secondaryActions={[
        {
          content: "Test connection",
          onAction: handleTest,
          loading: isTesting,
          disabled: !canTest,
        },
        {
          content: "Cancel",
          onAction: onClose,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text as="p" tone="subdued">
            Stored encrypted (AES-256-GCM) in your app database. Never sent to Spectrum Design Lab.
          </Text>
          <PolarisForm onSubmit={handleSubmit}>
            <FormLayout>
              <Select
                label="Provider"
                options={providerOptions}
                value={provider}
                onChange={(value) => setProvider(value as StorageProvider | "")}
                disabled={isEdit}
                helpText={
                  isEdit
                    ? "Provider can't change on edit — delete and re-add to change."
                    : undefined
                }
              />

              <TextField
                label="Space URL"
                type="url"
                autoComplete="off"
                value={spaceUrl}
                onChange={onSpaceUrlChange}
                placeholder="https://my-bucket.fra1.digitaloceanspaces.com"
                helpText="Paste the full URL DigitalOcean shows for your Space. Endpoint, region, and bucket fill in automatically — edit individual fields to fine-tune."
              />

              <FormLayout.Group>
                <TextField
                  label="Endpoint"
                  autoComplete="off"
                  value={endpoint}
                  onChange={onEndpointChange}
                  placeholder="fra1.digitaloceanspaces.com"
                  requiredIndicator
                />
                <TextField
                  label="Region"
                  autoComplete="off"
                  value={region}
                  onChange={setRegion}
                  placeholder="fra1"
                />
              </FormLayout.Group>

              <TextField
                label="Bucket"
                autoComplete="off"
                value={bucket}
                onChange={onBucketChange}
                placeholder="my-merchant-assets"
                requiredIndicator
              />

              <FormLayout.Group>
                <TextField
                  label="Access key ID"
                  autoComplete="off"
                  value={accessKey}
                  onChange={setAccessKey}
                  placeholder={isEdit ? "••••••••••••••••" : "AKIA…"}
                  requiredIndicator={!hasSavedCreds}
                />
                <TextField
                  label="Secret access key"
                  type="password"
                  autoComplete="off"
                  value={secretKey}
                  onChange={setSecretKey}
                  placeholder={isEdit ? "••••••••••••••••••••••••" : "•••••"}
                  requiredIndicator={!hasSavedCreds}
                />
              </FormLayout.Group>
              {hasSavedCreds ? (
                <Text as="p" tone="subdued" variant="bodySm">
                  Leave the key fields blank to keep the existing credentials and only update the other fields.
                </Text>
              ) : null}

              <TextField
                label="Public base URL (optional)"
                autoComplete="off"
                value={publicBaseUrl}
                onChange={setPublicBaseUrl}
                placeholder="https://cdn.example.com"
                helpText="CDN domain in front of the bucket for storefront URLs. Leave blank if frames are served directly from the bucket."
              />
            </FormLayout>
          </PolarisForm>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

function StorageDeleteModal({
  row,
  onClose,
  onToast,
}: {
  row: ShopStorageSummary;
  onClose: () => void;
  onToast: (t: { message: string; error?: boolean }) => void;
}) {
  const deleteFetcher = useFetcher<StorageActionData>();
  const isDeleting = deleteFetcher.state !== "idle";

  useEffect(() => {
    if (deleteFetcher.state === "idle" && deleteFetcher.data) {
      if (deleteFetcher.data.ok) {
        onToast({
          message: deleteFetcher.data.promotedStorageId
            ? `${providerLabel(row.provider)} deleted; another provider promoted to default.`
            : `${providerLabel(row.provider)} deleted.`,
        });
        onClose();
      } else if (deleteFetcher.data.message) {
        onToast({ message: deleteFetcher.data.message, error: true });
      }
    }
  }, [deleteFetcher.state, deleteFetcher.data, row.provider, onClose, onToast]);

  const handleDelete = useCallback(() => {
    const fd = new FormData();
    fd.set("intent", "deleteStorage");
    fd.set("storageId", row.id);
    deleteFetcher.submit(fd, { method: "post", action: "/api/sdl3d/storage" });
  }, [deleteFetcher, row.id]);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Delete ${providerLabel(row.provider)}?`}
      primaryAction={{
        content: "Delete",
        destructive: true,
        onAction: handleDelete,
        loading: isDeleting,
      }}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="200">
          {row.isDefault ? (
            <Banner tone="warning">
              This is the default provider. Deleting it will promote another configured provider to default automatically.
            </Banner>
          ) : null}
          <Text as="p">
            Existing captures stamped against this row will keep their reference, but new uploads will need a different provider.
          </Text>
          <Text as="p" tone="subdued" variant="bodySm">
            Bucket and its contents are not touched — the merchant remains in control of their object storage.
          </Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
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
    <Frame>
      <Page title="Storage error">
        <Layout>
          <Layout.Section>
            <Banner tone="critical" title="Storage page failed to load">
              <Text as="p">{message}</Text>
            </Banner>
          </Layout.Section>
          <Layout.Section>
            <InlineStack gap="200">
              <Button url="/app/sdl3d/storage" variant="primary">
                Reload
              </Button>
              <Button url="/app">Dashboard</Button>
            </InlineStack>
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}
