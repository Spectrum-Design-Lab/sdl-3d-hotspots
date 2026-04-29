/**
 * Send-one-message notifier for operational alerts. Mirrors the core-360
 * helper at `packages/core-360/src/notify.ts` so the hotspots app can fire
 * Slack/Discord/Teams alerts without depending on the platform package.
 *
 * Posts a `{text}` payload to `SDL_NOTIFY_WEBHOOK_URL`. Fail-open by design:
 * if the env var is unset or the POST fails, the caller's flow is never
 * broken — we just console-log so the failure-to-alert is still visible.
 */

export interface NotifyOptions {
  title: string;
  body?: string;
  level?: "info" | "warning" | "error";
}

const LEVEL_PREFIX: Record<NonNullable<NotifyOptions["level"]>, string> = {
  info: ":information_source:",
  warning: ":warning:",
  error: ":rotating_light:",
};

export async function notify(opts: NotifyOptions): Promise<void> {
  const prefix = LEVEL_PREFIX[opts.level ?? "info"];
  const head = `${prefix} *${opts.title}*`;
  const text = opts.body ? `${head}\n${opts.body}` : head;

  const webhookUrl = process.env.SDL_NOTIFY_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log(`[notify] (no webhook configured) ${text}`);
    return;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error(`[notify] webhook returned ${res.status}; alert not delivered. Original: ${text}`);
    }
  } catch (err) {
    console.error(`[notify] webhook POST failed: ${String(err)}. Original: ${text}`);
  }
}
