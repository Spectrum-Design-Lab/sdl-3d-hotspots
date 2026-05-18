import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
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
      {/* Slice 5C PR #5d (2026-05-18): swapped the raw `<s-app-nav>` /
          `<s-link>` web components for `<NavMenu>` + plain `<a>` children.
          The React wrapper owns its DOM, so AppBridge's custom-element
          upgrade no longer races React 18 hydration — closes the
          long-standing Firefox `#418` / `#423` errors documented in
          feedback_appbridge_hydration.md. `rel="home"` marks the dashboard
          route as the embedded app's root for AppBridge breadcrumb logic. */}
      <NavMenu>
        <a href="/app" rel="home">Home</a>
        <a href="/app/sdl3d/editor">Editor</a>
        <a href="/app/sdl3d/presets">Presets</a>
        <a href="/app/sdl3d/storage">Storage</a>
        <a href="/app/sdl3d/settings">Settings</a>
      </NavMenu>
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
