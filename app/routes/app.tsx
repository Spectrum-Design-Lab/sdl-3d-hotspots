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
      {/* AppBridge upgrades <s-app-nav> and <s-link> into shadow-DOM web components
          before React hydrates the page, which produces a DOM mismatch React surfaces
          as minified errors #418 (hydration failed) and #423 (recovered by client-
          rendering the whole root). suppressHydrationWarning on each web component
          tells React to skip hydration checks for that element specifically — the
          element's lightDOM children still hydrate normally, only the upgrade-
          induced mismatch is suppressed. */}
      <s-app-nav suppressHydrationWarning>
        <s-link href="/app" suppressHydrationWarning>Home</s-link>
        <s-link href="/app/sdl3d/editor" suppressHydrationWarning>Editor</s-link>
        <s-link href="/app/sdl3d/presets" suppressHydrationWarning>Presets</s-link>
        <s-link href="/app/sdl3d/storage" suppressHydrationWarning>Storage</s-link>
        <s-link href="/app/sdl3d/settings" suppressHydrationWarning>Settings</s-link>
      </s-app-nav>
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
