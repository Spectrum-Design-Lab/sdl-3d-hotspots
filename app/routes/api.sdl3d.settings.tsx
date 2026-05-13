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

    return json({ ok: false, message: "Unknown settings intent." }, 400);
  });
}
