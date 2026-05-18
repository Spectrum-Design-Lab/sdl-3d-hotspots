import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import "@shopify/polaris/build/esm/styles.css";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/sdl3d/editor">Editor</s-link>
        <s-link href="/app/sdl3d/presets">Presets</s-link>
        <s-link href="/app/sdl3d/storage">Storage</s-link>
        <s-link href="/app/sdl3d/settings">Settings</s-link>
      </s-app-nav>
      {/* Note (Slice 5C PR #0 bisect, 2026-05-18): Firefox reports React
          #418 / #423 hydration errors after first paint, caused by AppBridge
          upgrading <s-app-nav> / <s-link> web components before React
          hydrates the embedded shell. Confirmed pre-existing — they fire
          identically with or without PolarisAppProvider in the tree, so
          Polaris is not the cause. React auto-recovers by client-rendering
          the root (#423), so the app works; we lose SSR for the shell only.
          Tracked as known tech debt for a future slice (likely revisited in
          PR #5 if editor first-paint latency becomes a complaint). */}
      <PolarisAppProvider i18n={enTranslations}>
        <Outlet />
      </PolarisAppProvider>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
