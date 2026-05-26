/**
 * Server-side + worker Sentry init. Importing this module triggers
 * `Sentry.init` at module-load time so the SDK is ready before any
 * request handler / job handler runs.
 *
 * Conditional on `SENTRY_DSN` being set — when unset, every helper here
 * is a no-op and the structured-logging fallback (plain console) still
 * runs. This keeps dev / first-boot / unconfigured environments from
 * crashing or emitting confusing warnings.
 *
 * Privacy: `sendDefaultPii: false` strips client IPs, request headers,
 * and cookies from event payloads. `beforeSend` additionally scrubs
 * known sensitive fields from extras (storage credentials, shopify
 * access tokens) before the event leaves the process.
 */
import * as Sentry from "@sentry/node";

const DSN = process.env.SENTRY_DSN;
const ENVIRONMENT = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";
const RELEASE = process.env.SENTRY_RELEASE; // optional — wire in CI later

let initialised = false;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: ENVIRONMENT,
    release: RELEASE,
    sendDefaultPii: false,
    // Keep performance tracing off by default — turn on per-deploy once
    // we know what traffic levels look like. Sampling errors at 100% is
    // the priority right now.
    tracesSampleRate: 0,
    beforeSend(event) {
      // Belt-and-braces scrub for fields that could leak merchant or
      // SDL credentials. The SDK normally redacts these but we make it
      // explicit here so a future contributor adding `extras` knows
      // the redaction list lives somewhere obvious.
      if (event.extra) {
        for (const key of Object.keys(event.extra)) {
          if (/token|secret|key|password|cookie|authorization/i.test(key)) {
            event.extra[key] = "[REDACTED]";
          }
        }
      }
      return event;
    },
  });
  initialised = true;
  console.log(`[sentry] initialised — environment=${ENVIRONMENT}`);
} else {
  console.log("[sentry] SENTRY_DSN not set — error reporting disabled (structured logs still active)");
}

/** Whether Sentry actually initialised. Use to gate helpers in tests etc. */
export function isSentryEnabled(): boolean {
  return initialised;
}

/**
 * Capture an exception with optional tags + extras. Safe to call even
 * when Sentry is disabled — falls back to console.error.
 *
 * `scope` is a free-form label ("server" / "worker" / "capture-pipeline")
 * surfaced as a Sentry tag so the dashboard can split events by source.
 */
export function captureException(
  err: unknown,
  options: {
    scope?: string;
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
  } = {},
): void {
  const { scope, tags, extra } = options;
  if (!initialised) {
    // Structured log fallback — keeps event shape consistent between
    // the no-Sentry and Sentry-enabled paths so a log scraper still
    // sees the same fields.
    console.error(
      JSON.stringify({
        evt: "error",
        scope: scope ?? "unknown",
        tags,
        extra,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }),
    );
    return;
  }
  Sentry.withScope((s) => {
    if (scope) s.setTag("source", scope);
    if (tags) {
      for (const [k, v] of Object.entries(tags)) s.setTag(k, v);
    }
    if (extra) {
      for (const [k, v] of Object.entries(extra)) s.setExtra(k, v);
    }
    Sentry.captureException(err);
  });
}

/** Flush pending events on shutdown. Call from SIGTERM handlers. */
export async function flushSentry(timeoutMs = 5000): Promise<void> {
  if (!initialised) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch (err) {
    console.error("[sentry] flush failed:", err);
  }
}
