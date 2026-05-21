/**
 * API route for settings operations:
 *   ensureMetafields (create/verify metafield definitions)
 *   saveLogo (update shop logo URL)
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { withAdminAuth } from "../lib/admin-auth.server";
import { ensureSdl3dMetafieldDefinitions } from "../lib/sdl3d-metafields.server";
import prisma from "../db.server";

export function loader(_args: LoaderFunctionArgs) {
  return new Response("Method not allowed", { status: 405 });
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function action({ request }: ActionFunctionArgs) {
  return withAdminAuth(request, async ({ admin, shop }) => {
    const formData = await request.formData();
    const intent = String(formData.get("intent") || "ensureMetafields");

    if (intent === "ensureMetafields") {
      const results = await ensureSdl3dMetafieldDefinitions(admin);
      return json({ ok: true, results });
    }

    if (intent === "saveDarkMode") {
      const darkMode = formData.get("darkMode") === "true";
      await prisma.shop.update({
        where: { id: shop.id },
        data: { darkMode },
      });
      return json({ ok: true, darkMode });
    }

    if (intent === "saveLogo") {
      const logoUrl = String(formData.get("logoUrl") || "").trim() || null;
      await prisma.shop.update({
        where: { id: shop.id },
        data: { logoUrl },
      });
      return json({ ok: true, logoUrl });
    }

    // Slice 8 viewer-settings PR #3 — shop-level default BG colour.
    // Empty string clears the override and the publish-time resolver
    // falls back to the hardcoded #0b1020. Validated against the same
    // CSS-color regex as the per-product override.
    if (intent === "saveDefaultViewerBackgroundColor") {
      const raw = String(formData.get("color") || "").trim();
      if (raw && !/^(#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|(rgb|rgba|hsl|hsla)\([^)]+\))$/i.test(raw)) {
        return json({ ok: false, message: "Use a CSS colour like #0b1020 or rgb(...)." }, 400);
      }
      const next = raw || null;
      await prisma.shop.update({
        where: { id: shop.id },
        data: { defaultViewerBackgroundColor: next },
      });
      return json({ ok: true, defaultViewerBackgroundColor: next });
    }

    return json({ ok: false, message: "Unknown settings intent." }, 400);
  });
}
