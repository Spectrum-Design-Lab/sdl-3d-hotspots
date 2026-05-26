import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from "react-router";

/**
 * Root loader — surfaces a tiny env-var window object so the browser
 * can read settings the server already knows about (e.g. the Sentry
 * DSN) without baking them into the build. Only non-secret values
 * belong here; everything else stays server-side.
 */
export async function loader() {
  return {
    ENV: {
      SENTRY_DSN: process.env.SENTRY_DSN ?? "",
      SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "production",
    },
  };
}

export default function App() {
  const data = useLoaderData<typeof loader>();
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        {/*
          window.ENV — read by entry.client.tsx (Sentry DSN). Renders
          BEFORE <Scripts/> so the inline assignment runs before any
          hydration script that depends on it. JSON.stringify is safe
          here because the DSN comes from a server-controlled env var.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.ENV = ${JSON.stringify(data.ENV)};`,
          }}
        />
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
