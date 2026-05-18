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

  const [logoInput, setLogoInput] = useState(data.logoUrl);
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

  const handleLogoSubmit = useCallback(() => {
    const fd = new FormData();
    fd.set("intent", "saveLogo");
    fd.set("logoUrl", logoInput);
    logoFetcher.submit(fd, { method: "post", action: "/api/sdl3d/settings" });
  }, [logoFetcher, logoInput]);

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

  const isSavingLogo = logoFetcher.state !== "idle";
  const isSavingTheme = darkModeFetcher.state !== "idle";
  const isRunningSetup = metafieldFetcher.state !== "idle";
  const isResettingOnboarding = onboardingFetcher.state !== "idle";

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
