import type { LoaderFunctionArgs } from "react-router";

const startedAt = Date.now();

export async function loader(_args: LoaderFunctionArgs) {
  return new Response(
    JSON.stringify({
      status: "ok",
      version: process.env.APP_VERSION ?? "dev",
      commit: process.env.GIT_COMMIT ?? null,
      deployment: process.env.DEPLOYMENT_NAME ?? null,
      uptime: Math.round((Date.now() - startedAt) / 1000),
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
}
