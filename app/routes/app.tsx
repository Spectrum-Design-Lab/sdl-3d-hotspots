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
      {/* BISECT (not for permanent merge): PolarisAppProvider temporarily
          removed to test whether it's contributing to the lingering #418 /
          #423 hydration errors. CSS import + Polaris dep stay so the
          stylesheet still loads. If errors clear without this wrapper, the
          fix is to render PolarisAppProvider client-only (useEffect + state)
          on the next commit. If errors persist, they're pre-existing
          AppBridge SSR mismatch and we accept them as a known issue. */}
      <Outlet />
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
