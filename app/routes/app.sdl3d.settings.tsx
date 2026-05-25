/**
 * Settings page — first Polaris migration target (Slice 5C PR #1).
 *
 * Lands the Polaris primitives the rest of 5C reuses: Page / Layout / Card /
 * TextField / Button / Form / Toast / Frame / DescriptionList / ChoiceList /
 * ResourceList / Badge.
 *
 * UX upgrades over the previous hand-rolled version:
 * 1. App info section becomes a DescriptionList (denser, matches Shopify
 *    admin's own settings-summary pattern).
 * 2. Appearance toggle becomes a ChoiceList (Light/Dark) with a live status
 *    summary. "System" option deferred until darkModeChoice column lands.
 * 3. Metafield definitions list becomes a ResourceList with Badge tones for
 *    status, replacing the stacked-pill cards.
 * 4. Save / setup feedback moves from inline divs to Polaris Toast for
 *    non-blocking, dismissible confirmations.
 */
import { useCallback, useEffect, useState } from "react";
import {
  useLoaderData,
  useFetcher,
  useRouteError,
  isRouteErrorResponse,
} from "react-router";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  ChoiceList,
  DescriptionList,
  EmptyState,
  Form as PolarisForm,
  FormLayout,
  Frame,
  InlineStack,
  Layout,
  List,
  Modal,
  Page,
  ResourceItem,
  ResourceList,
  Text,
  TextField,
  Toast,
} from "@shopify/polaris";

import shopify from "../shopify.server";
import { getSdl3dDefinitions } from "../lib/sdl3d-metafields.server";
import { ensureShop } from "../lib/sdl3d-graphql.server";
import { apiVersion } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: { request: Request }) {
  const { admin, session } = await shopify.authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const definitions = await getSdl3dDefinitions(admin);

  const [configCount, presetCount, syncRunCount, publishedCount, deadLetterCaptures] = await Promise.all([
    prisma.productConfig.count({ where: { shopId: shop.id } }),
    prisma.preset.count({ where: { shopId: shop.id } }),
    prisma.syncRun.count({ where: { shopId: shop.id } }),
    prisma.productConfig.count({ where: { shopId: shop.id, status: "PUBLISHED" } }),
    // Slice 9 PR #3 — dead-letter list. FAILED and CANCELLED captures are
    // terminal states the merchant can act on (reprocess or delete).
    // Scoped to the shop via productConfig.shopId; ordered newest first so
    // the most recent failure is easiest to triage.
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

  return {
    shop: session.shop,
    logoUrl: shop.logoUrl ?? "",
    darkMode: shop.darkMode ?? false,
    defaultViewerBackgroundColor: shop.defaultViewerBackgroundColor ?? "",
    apiVersion: String(apiVersion),
    configCount,
    presetCount,
    syncRunCount,
    publishedCount,
    deadLetterCaptures: deadLetterCaptures.map((c) => ({
      id: c.id,
      status: c.status as "FAILED" | "CANCELLED",
      productGid: c.productConfig.shopifyProductGid,
      errorMessage: c.errorMessage,
      attempts: c.attempts,
      updatedAt: c.updatedAt.toISOString(),
    })),
    definitions: definitions.map((d) => ({
      id: d.id,
      namespace: d.namespace,
      key: d.key,
      name: d.name,
    })),
  };
}

type MetafieldResult = {
  key: string;
  status: string;
  message?: string;
};

type ActionData<T = Record<string, unknown>> = {
  ok?: boolean;
  message?: string;
} & T;

export default function Sdl3dSettingsRoute() {
  const data = useLoaderData<typeof loader>();

  const logoFetcher = useFetcher<ActionData<{ logoUrl?: string | null }>>();
  const darkModeFetcher = useFetcher<ActionData<{ darkMode?: boolean }>>();
  const metafieldFetcher = useFetcher<ActionData<{ results?: MetafieldResult[] }>>();
  const onboardingFetcher = useFetcher<ActionData<{ resetOnboarding?: boolean }>>();
  const bgColorFetcher = useFetcher<ActionData<{ defaultViewerBackgroundColor?: string | null }>>();
  const republishFetcher = useFetcher<ActionData<{
    total?: number;
    successful?: number;
    failed?: number;
    errors?: Array<{ productGid: string; message: string }>;
  }>>();
  // Slice 9 PR #3 — dead-letter actions (reprocess uses existing retry
  // intent; delete uses new deleteCapture intent). Separate fetcher so
  // toast feedback doesn't collide with the other settings fetchers.
  const captureOpsFetcher = useFetcher<ActionData<{ deleted?: boolean }>>();

  const [logoInput, setLogoInput] = useState(data.logoUrl);
  const [republishModalOpen, setRepublishModalOpen] = useState(false);
  const [bgColorInput, setBgColorInput] = useState(data.defaultViewerBackgroundColor);
  const [themeChoice, setThemeChoice] = useState<("light" | "dark")[]>(
    data.darkMode ? ["dark"] : ["light"],
  );
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(
    null,
  );

  // Reflect loader-revalidated values back into local state when the user saves.
  useEffect(() => {
    if (
      logoFetcher.state === "idle" &&
      logoFetcher.data?.ok &&
      logoFetcher.data.logoUrl !== undefined
    ) {
      setLogoInput(logoFetcher.data.logoUrl ?? "");
      setToast({ message: "Logo saved." });
    } else if (logoFetcher.state === "idle" && logoFetcher.data?.message && !logoFetcher.data.ok) {
      setToast({ message: logoFetcher.data.message, error: true });
    }
  }, [logoFetcher.state, logoFetcher.data]);

  useEffect(() => {
    if (
      darkModeFetcher.state === "idle" &&
      darkModeFetcher.data?.ok &&
      darkModeFetcher.data.darkMode !== undefined
    ) {
      setToast({
        message: darkModeFetcher.data.darkMode ? "Switched to Dark mode." : "Switched to Light mode.",
      });
    }
  }, [darkModeFetcher.state, darkModeFetcher.data]);

  useEffect(() => {
    if (metafieldFetcher.state === "idle" && metafieldFetcher.data?.ok) {
      setToast({ message: "Metafield setup complete." });
    }
  }, [metafieldFetcher.state, metafieldFetcher.data]);

  useEffect(() => {
    if (onboardingFetcher.state === "idle" && onboardingFetcher.data?.resetOnboarding) {
      setToast({ message: "Onboarding wizard reset. Visit Home to restart." });
    }
  }, [onboardingFetcher.state, onboardingFetcher.data]);

  useEffect(() => {
    if (
      bgColorFetcher.state === "idle" &&
      bgColorFetcher.data?.ok &&
      bgColorFetcher.data.defaultViewerBackgroundColor !== undefined
    ) {
      setBgColorInput(bgColorFetcher.data.defaultViewerBackgroundColor ?? "");
      setToast({ message: "Default background colour saved." });
    } else if (bgColorFetcher.state === "idle" && bgColorFetcher.data?.message && !bgColorFetcher.data.ok) {
      setToast({ message: bgColorFetcher.data.message, error: true });
    }
  }, [bgColorFetcher.state, bgColorFetcher.data]);

  // Slice 8 finisher — bulk republish. Closes the staleness footgun
  // from the shop-default BG publish-time resolver. Errors don't open
  // a toast (the modal stays open to show per-product detail); success
  // closes the modal and toasts the count.
  useEffect(() => {
    if (republishFetcher.state !== "idle" || !republishFetcher.data) return;
    const result = republishFetcher.data;
    if (result.ok && result.failed === 0) {
      setRepublishModalOpen(false);
      setToast({ message: result.message ?? "Republish complete." });
    } else if (result.ok === false && result.message && !result.errors?.length) {
      // Top-level failure (no per-product detail) — surface as toast.
      setRepublishModalOpen(false);
      setToast({ message: result.message, error: true });
    }
    // Partial failure with per-product errors: leave the modal open so
    // the merchant sees which products failed.
  }, [republishFetcher.state, republishFetcher.data]);

  useEffect(() => {
    if (captureOpsFetcher.state !== "idle" || !captureOpsFetcher.data) return;
    const result = captureOpsFetcher.data;
    if (result.ok && result.deleted) {
      setToast({ message: "Capture removed." });
    } else if (result.ok) {
      setToast({ message: "Capture re-queued. The worker will pick it up." });
    } else if (result.message) {
      setToast({ message: result.message, error: true });
    }
  }, [captureOpsFetcher.state, captureOpsFetcher.data]);

  const handleReprocessCapture = useCallback(
    (captureId: string) => {
      const fd = new FormData();
      fd.set("intent", "retry");
      fd.set("captureId", captureId);
      captureOpsFetcher.submit(fd, { method: "post", action: "/api/sdl3d/captures" });
    },
    [captureOpsFetcher],
  );

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

  const handleLogoSubmit = useCallback(() => {
    const fd = new FormData();
    fd.set("intent", "saveLogo");
    fd.set("logoUrl", logoInput);
    logoFetcher.submit(fd, { method: "post", action: "/api/sdl3d/settings" });
  }, [logoFetcher, logoInput]);

  const handleBgColorSubmit = useCallback(() => {
    const fd = new FormData();
    fd.set("intent", "saveDefaultViewerBackgroundColor");
    fd.set("color", bgColorInput);
    bgColorFetcher.submit(fd, { method: "post", action: "/api/sdl3d/settings" });
  }, [bgColorFetcher, bgColorInput]);

  const handleThemeChange = useCallback(
    (selected: string[]) => {
      const next = selected[0] === "dark" ? "dark" : "light";
      setThemeChoice([next]);
      const fd = new FormData();
      fd.set("intent", "saveDarkMode");
      fd.set("darkMode", String(next === "dark"));
      darkModeFetcher.submit(fd, { method: "post", action: "/api/sdl3d/settings" });
    },
    [darkModeFetcher],
  );

  const handleMetafieldSetup = useCallback(() => {
    const fd = new FormData();
    fd.set("intent", "ensureMetafields");
    metafieldFetcher.submit(fd, { method: "post", action: "/api/sdl3d/settings" });
  }, [metafieldFetcher]);

  const handleResetOnboarding = useCallback(() => {
    const fd = new FormData();
    fd.set("intent", "resetOnboarding");
    onboardingFetcher.submit(fd, { method: "post", action: "/api/sdl3d/onboarding" });
  }, [onboardingFetcher]);

  const handleRepublishAll = useCallback(() => {
    const fd = new FormData();
    fd.set("intent", "republishAll");
    republishFetcher.submit(fd, { method: "post", action: "/api/sdl3d/config" });
  }, [republishFetcher]);

  const isSavingLogo = logoFetcher.state !== "idle";
  const isSavingTheme = darkModeFetcher.state !== "idle";
  const isRunningSetup = metafieldFetcher.state !== "idle";
  const isResettingOnboarding = onboardingFetcher.state !== "idle";
  const isRepublishing = republishFetcher.state !== "idle";
  const republishResult = republishFetcher.data;

  const metafieldResults = metafieldFetcher.data?.results ?? [];

  return (
    <Frame>
      <Page
        title="Settings"
        subtitle="App configuration, metafield setup, and debug information."
      >
        <Layout>
          {/* App info — DescriptionList replaces the five stacked subtle cards. */}
          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">App info</Text>
                <Text as="p" tone="subdued">
                  Current app and environment details.
                </Text>
                <DescriptionList
                  items={[
                    { term: "Shop", description: data.shop },
                    { term: "Shopify API version", description: data.apiVersion },
                    { term: "Product configs", description: String(data.configCount) },
                    { term: "Presets", description: String(data.presetCount) },
                    { term: "Sync runs", description: String(data.syncRunCount) },
                  ]}
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Company logo. URL input only for now — DropZone w/ Shopify staged
              upload is a deferred follow-up to avoid metafield-storage bloat. */}
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Company logo</Text>
                <Text as="p" tone="subdued">
                  Used as the loading poster while 3D models load. Paste any public image URL.
                </Text>
                <PolarisForm onSubmit={handleLogoSubmit}>
                  <FormLayout>
                    <TextField
                      label="Logo URL"
                      labelHidden
                      type="url"
                      value={logoInput}
                      onChange={setLogoInput}
                      placeholder="https://cdn.shopify.com/…/logo.png"
                      autoComplete="off"
                    />
                    <InlineStack gap="300" align="start" blockAlign="center">
                      <Button
                        submit
                        variant="primary"
                        loading={isSavingLogo}
                        disabled={isSavingLogo}
                      >
                        Save
                      </Button>
                      {logoInput ? (
                        <Box
                          padding="200"
                          background="bg-surface-secondary"
                          borderRadius="200"
                        >
                          <img
                            src={logoInput}
                            alt="Logo preview"
                            style={{ maxHeight: 40, maxWidth: 160, display: "block" }}
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        </Box>
                      ) : null}
                    </InlineStack>
                  </FormLayout>
                </PolarisForm>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Slice 8 viewer-settings PR #3 — shop-level default BG colour.
              Per-product override still lives in the editor's Viewer
              inspector; this is the fallback the publish-time resolver
              uses when the product hasn't set its own. */}
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Default viewer background</Text>
                <Text as="p" tone="subdued">
                  Applied to every product's storefront viewer unless that product overrides it in the editor. Leave blank to fall back to the built-in dark navy ({"#0b1020"}). Changes apply to new publishes; re-publish older products to refresh them.
                </Text>
                <InlineStack gap="200" blockAlign="end" wrap={false}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <TextField
                      label="Default background colour"
                      value={bgColorInput}
                      onChange={setBgColorInput}
                      placeholder="#0b1020"
                      autoComplete="off"
                    />
                  </div>
                  <input
                    type="color"
                    value={/^#[0-9a-f]{6}$/i.test(bgColorInput) ? bgColorInput : "#0b1020"}
                    onChange={(e) => setBgColorInput(e.target.value)}
                    aria-label="Default background colour swatch"
                    style={{
                      width: 36,
                      height: 36,
                      border: "1px solid var(--p-color-border)",
                      borderRadius: "var(--p-border-radius-200)",
                      padding: 2,
                      cursor: "pointer",
                      background: "transparent",
                    }}
                  />
                </InlineStack>
                <InlineStack gap="200">
                  <Button
                    variant="primary"
                    onClick={handleBgColorSubmit}
                    loading={bgColorFetcher.state !== "idle"}
                    disabled={bgColorFetcher.state !== "idle"}
                  >
                    Save
                  </Button>
                  {bgColorInput ? (
                    <Button
                      onClick={() => {
                        setBgColorInput("");
                        const fd = new FormData();
                        fd.set("intent", "saveDefaultViewerBackgroundColor");
                        fd.set("color", "");
                        bgColorFetcher.submit(fd, { method: "post", action: "/api/sdl3d/settings" });
                      }}
                      disabled={bgColorFetcher.state !== "idle"}
                    >
                      Clear
                    </Button>
                  ) : null}
                </InlineStack>

                {/* Slice 8 finisher — bulk republish. Re-runs the
                    publish path for every PUBLISHED product so the
                    shop-default BG (and any other publish-time
                    resolution like custom-icon GIDs) propagates to
                    already-published metafields. Disabled when there
                    are no published products. */}
                <Box paddingBlockStart="200" borderBlockStartWidth="025" borderColor="border">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Already-published products keep the colour they had at publish time. Use this to refresh every published product to the current default in one pass.
                    </Text>
                    <InlineStack gap="200" blockAlign="center">
                      <Button
                        onClick={() => setRepublishModalOpen(true)}
                        disabled={data.publishedCount === 0 || isRepublishing}
                      >
                        Republish all published products
                      </Button>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {data.publishedCount === 0
                          ? "No published products yet."
                          : `${data.publishedCount} published product${data.publishedCount === 1 ? "" : "s"}.`}
                      </Text>
                    </InlineStack>
                  </BlockStack>
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Appearance — ChoiceList replaces the bespoke toggle button.
              Light/Dark only for now; System is a follow-up requiring a new
              darkModeChoice column. */}
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Appearance</Text>
                <Text as="p" tone="subdued">
                  Choose the color theme for the app interface.
                </Text>
                <ChoiceList
                  title="Theme"
                  titleHidden
                  choices={[
                    { label: "Light", value: "light" },
                    { label: "Dark", value: "dark" },
                  ]}
                  selected={themeChoice}
                  onChange={handleThemeChange}
                  disabled={isSavingTheme}
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Onboarding — keeps the existing reset flow, just Polaris button. */}
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Onboarding</Text>
                <Text as="p" tone="subdued">
                  Walk through the getting-started guide again.
                </Text>
                <InlineStack>
                  <Button
                    onClick={handleResetOnboarding}
                    loading={isResettingOnboarding}
                    disabled={isResettingOnboarding}
                  >
                    Restart onboarding wizard
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Slice 9 PR #3 — dead-letter captures. Shows the 20 most recent
              FAILED or CANCELLED captures with reprocess + delete actions.
              The list is hidden entirely when empty so the settings page
              stays uncluttered for healthy shops. */}
          {data.deadLetterCaptures.length > 0 ? (
            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Failed captures</Text>
                  <Text as="p" tone="subdued">
                    Captures that errored out or were cancelled. Reprocess to
                    re-run the pipeline, or delete to clear the row.
                  </Text>
                  <ResourceList
                    resourceName={{ singular: "capture", plural: "captures" }}
                    items={data.deadLetterCaptures}
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
            </Layout.Section>
          ) : null}

          {/* Metafield definitions — ResourceList with status Badges. */}
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Metafield definitions</Text>
                <Text as="p" tone="subdued">
                  SDL 3D uses product metafields under the <code>sdl_3d</code> namespace. Run setup to create or verify definitions.
                </Text>
                <InlineStack>
                  <Button
                    variant="primary"
                    onClick={handleMetafieldSetup}
                    loading={isRunningSetup}
                    disabled={isRunningSetup}
                  >
                    Create / verify metafield definitions
                  </Button>
                </InlineStack>

                {metafieldResults.length > 0 ? (
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">
                      Setup results
                    </Text>
                    <ResourceList
                      resourceName={{ singular: "result", plural: "results" }}
                      items={metafieldResults}
                      renderItem={(item) => (
                        <ResourceItem
                          id={item.key}
                          onClick={() => undefined}
                          accessibilityLabel={`${item.key}: ${item.status}`}
                        >
                          <InlineStack gap="200" blockAlign="center" wrap={false}>
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              <code>{item.key}</code>
                            </Text>
                            <Badge tone={badgeToneForStatus(item.status)}>
                              {item.status}
                            </Badge>
                            {item.message ? (
                              <Text as="span" tone="subdued">
                                {item.message}
                              </Text>
                            ) : null}
                          </InlineStack>
                        </ResourceItem>
                      )}
                    />
                  </BlockStack>
                ) : null}

                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    Current definitions ({data.definitions.length})
                  </Text>
                  {data.definitions.length > 0 ? (
                    <ResourceList
                      resourceName={{ singular: "definition", plural: "definitions" }}
                      items={data.definitions}
                      renderItem={(def) => (
                        <ResourceItem
                          id={def.id}
                          onClick={() => undefined}
                          accessibilityLabel={`${def.namespace}.${def.key}`}
                        >
                          <InlineStack gap="200" blockAlign="center" wrap={false}>
                            <Text as="span" variant="bodyMd">
                              <code>{def.namespace}.{def.key}</code>
                            </Text>
                            <Text as="span" tone="subdued">
                              {def.name}
                            </Text>
                          </InlineStack>
                        </ResourceItem>
                      )}
                    />
                  ) : (
                    <EmptyState
                      heading="No definitions found yet"
                      action={{
                        content: "Run setup",
                        onAction: handleMetafieldSetup,
                        loading: isRunningSetup,
                      }}
                      image=""
                    >
                      <Text as="p">
                        SDL 3D metafield definitions haven't been created in this shop yet. Run setup above to create them.
                      </Text>
                    </EmptyState>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>

      {toast ? (
        <Toast
          content={toast.message}
          error={toast.error}
          onDismiss={() => setToast(null)}
          duration={3500}
        />
      ) : null}

      <Modal
        open={republishModalOpen}
        onClose={() => {
          if (isRepublishing) return;
          setRepublishModalOpen(false);
        }}
        title="Republish all published products"
        primaryAction={{
          content: republishResult?.errors?.length ? "Close" : "Republish",
          onAction: republishResult?.errors?.length
            ? () => setRepublishModalOpen(false)
            : handleRepublishAll,
          loading: isRepublishing,
          disabled: isRepublishing,
        }}
        secondaryActions={
          republishResult?.errors?.length
            ? undefined
            : [
                {
                  content: "Cancel",
                  onAction: () => setRepublishModalOpen(false),
                  disabled: isRepublishing,
                },
              ]
        }
      >
        <Modal.Section>
          {republishResult?.errors?.length ? (
            <BlockStack gap="300">
              <Text as="p">
                Republished {republishResult.successful} of {republishResult.total} products. {republishResult.failed} failed:
              </Text>
              <List type="bullet">
                {republishResult.errors.map((e) => (
                  <List.Item key={e.productGid}>
                    <Text as="span" variant="bodySm" fontWeight="medium">
                      {e.productGid.replace("gid://shopify/Product/", "Product ")}
                    </Text>
                    {" — "}
                    <Text as="span" variant="bodySm" tone="critical">
                      {e.message}
                    </Text>
                  </List.Item>
                ))}
              </List>
              <Text as="p" variant="bodySm" tone="subdued">
                Successful products were republished with the current shop defaults. You can re-open the failed products' editors and publish them individually to retry.
              </Text>
            </BlockStack>
          ) : (
            <BlockStack gap="300">
              <Text as="p">
                This will re-run the publish path for {data.publishedCount} published product{data.publishedCount === 1 ? "" : "s"}, refreshing the shop-default background colour and any other publish-time values (custom icons, hotspot media URLs) on already-published storefronts.
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Storefront viewers see the updated values on next page load. No data is lost — this only writes the resolved values to product metafields.
              </Text>
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>
    </Frame>
  );
}

function badgeToneForStatus(
  status: string,
): "success" | "info" | "warning" | "critical" {
  if (status === "created" || status === "exists") return "success";
  if (status === "updated") return "info";
  if (status === "error" || status === "failed") return "critical";
  return "warning";
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
      <Page title="Settings error">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="p">{message}</Text>
                <InlineStack gap="200">
                  <Button url="/app/sdl3d/settings" variant="primary">
                    Reload
                  </Button>
                  <Button url="/app">Dashboard</Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}
