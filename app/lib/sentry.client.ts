/**
 * Browser Sentry init. Called from `entry.client.tsx` before React
 * Router hydrates so unhandled errors during the first render are
 * captured.
 *
 * The DSN can't come from `process.env` (no Node in the browser) — the
 * server-side root loader serialises it into `window.ENV.SENTRY_DSN`
 * via a script tag; we read it from there. When the DSN is missing,
 * everything no-ops so a misconfigured deploy still boots.
 */
import * as Sentry from "@sentry/react";

declare global {
  interface Window {
    ENV?: {
      SENTRY_DSN?: string;
      SENTRY_ENVIRONMENT?: string;
    };
  }
}

let initialised = false;

export function initSentryClient(): void {
  if (initialised) return;
  if (typeof window === "undefined") return;
  const dsn = window.ENV?.SENTRY_DSN;
  if (!dsn) {
    // Quiet no-op — server-side log already announces "SENTRY_DSN not
    // set" so we don't need to double up in the browser console.
    return;
  }
  Sentry.init({
    dsn,
    environment: window.ENV?.SENTRY_ENVIRONMENT ?? "production",
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // Browser errors only carry the URL + stack — we don't add any
    // merchant data here. If we ever pass extras via Sentry.captureMessage
    // helper, mirror the redaction list from sentry.server.ts.
  });
  initialised = true;
}

export function isSentryEnabled(): boolean {
  return initialised;
}
