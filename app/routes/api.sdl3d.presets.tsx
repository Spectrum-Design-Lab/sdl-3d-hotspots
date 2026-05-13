/**
 * API route for preset operations:
 *   create, delete, rename, saveAsPreset (from editor), list (GET)
 *
 * Presets now store hotspot collections only (no viewer settings).
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { withAdminAuth } from "../lib/admin-auth.server";
import prisma from "../db.server";

/* ───── helpers ───── */

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function error(message: string, status = 400) {
  return json({ ok: false, message }, status);
}

function ok(message: string, extra?: Record<string, unknown>) {
  return json({ ok: true, message, ...extra });
}

/* ───── loader (GET — list presets) ───── */

export async function loader({ request }: LoaderFunctionArgs) {
  return withAdminAuth(request, async ({ shop }) => {
    const presets = await prisma.preset.findMany({
      where: { shopId: shop.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        hotspotsJson: true,
        hotspotsJson360: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return json({
      ok: true,
      presets: presets.map((p) => {
        let hotspotCount = 0;
        try {
          const arr = JSON.parse(p.hotspotsJson);
          if (Array.isArray(arr)) hotspotCount = arr.length;
        } catch { /* ignore */ }
        let hotspot360Count = 0;
        if (p.hotspotsJson360) {
          try {
            const arr = JSON.parse(p.hotspotsJson360);
            if (Array.isArray(arr)) hotspot360Count = arr.length;
          } catch { /* ignore */ }
        }
        return {
          ...p,
          hotspotCount,
          hotspot360Count,
        };
      }),
    });
  });
}

/* ───── action ───── */

export async function action({ request }: ActionFunctionArgs) {
  return withAdminAuth(request, async ({ shop }) => {
    const formData = await request.formData();
    const intent = String(formData.get("intent") || "");

    switch (intent) {
      case "create":
      case "saveAsPreset":
        return handleCreate(shop, formData);
      case "delete":
        return handleDelete(shop, formData);
      case "rename":
        return handleRename(shop, formData);
      default:
        return error("Unknown preset intent.");
    }
  });
}

/* ───── handlers ───── */

async function handleCreate(shop: { id: string }, formData: FormData) {
  const name = String(formData.get("presetName") || formData.get("name") || "").trim();
  if (!name) return error("Preset name is required.");

  const hotspotsJson = String(formData.get("hotspotsJson") || "[]");
  const hotspotsJson360 = String(formData.get("hotspotsJson360") || "") || null;

  const existing = await prisma.preset.findUnique({
    where: { shopId_name: { shopId: shop.id, name } },
  });

  if (existing) {
    await prisma.preset.update({
      where: { id: existing.id },
      data: {
        hotspotsJson,
        hotspotsJson360,
      },
    });
    return ok(`Preset "${name}" updated.`);
  }

  await prisma.preset.create({
    data: {
      shopId: shop.id,
      name,
      viewerSettingsJson: "{}",
      hotspotsJson,
      hotspotsJson360,
    },
  });
  return ok(`Preset "${name}" saved.`);
}

async function handleDelete(shop: { id: string }, formData: FormData) {
  const presetId = String(formData.get("presetId") || "");
  if (!presetId) return error("Missing preset ID.");
  await prisma.preset.deleteMany({
    where: { id: presetId, shopId: shop.id },
  });
  return ok("Preset deleted.");
}

async function handleRename(shop: { id: string }, formData: FormData) {
  const presetId = String(formData.get("presetId") || "");
  const newName = String(formData.get("newName") || "").trim();
  if (!presetId) return error("Missing preset ID.");
  if (!newName) return error("Name is required.");
  await prisma.preset.updateMany({
    where: { id: presetId, shopId: shop.id },
    data: { name: newName },
  });
  return ok("Preset renamed.");
}
