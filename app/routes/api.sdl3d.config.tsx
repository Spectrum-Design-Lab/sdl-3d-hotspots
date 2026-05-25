/**
 * API route for product config operations:
 *   saveDraft, publish, setViewerType, deleteConfig, deleteOrphanedConfigs,
 *   republishAll
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

export function loader(_args: LoaderFunctionArgs) {
  return new Response("Method not allowed", { status: 405 });
}
import { withAdminAuth } from "../lib/admin-auth.server";
import prisma from "../db.server";
import { adminGraphql, type AdminGraphqlClient } from "../lib/sdl3d-graphql.server";
import { publishConfigToMetafields } from "../lib/sdl3d-sync.server";
import { defaultViewerSettings } from "../lib/sdl3d-shared";

const VALID_PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;
const RESOLVE_BATCH_SIZE = 100;

/* ───── helpers ───── */

async function ensureDraftConfig(shopId: string, productGid: string) {
  return prisma.productConfig.upsert({
    where: {
      shopId_shopifyProductGid: { shopId, shopifyProductGid: productGid },
    },
    update: {},
    create: {
      shopId,
      shopifyProductGid: productGid,
      enabled: false,
      sourceMode: "APP",
      status: "DRAFT",
      viewerSettingsJson: JSON.stringify(defaultViewerSettings),
    },
  });
}

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function error(message: string, status = 400) {
  return json({ ok: false, message }, status);
}

function ok(message: string, reload = true) {
  return json({ ok: true, message, reload });
}

/* ───── action ───── */

export async function action({ request }: ActionFunctionArgs) {
  return withAdminAuth(request, async ({ admin, session, shop }) => {
    const formData = await request.formData();
    const intent = String(formData.get("intent") || "");

    // Bulk intents have no productGid; handle before the per-product check.
    if (intent === "deleteOrphanedConfigs") {
      return handleDeleteOrphanedConfigs(admin, shop);
    }
    if (intent === "republishAll") {
      return handleRepublishAll(admin, session.shop, shop);
    }

    const productGid = String(formData.get("productGid") || "");
    if (!productGid) {
      return error("Missing product GID.");
    }

    switch (intent) {
      case "publish":
        return handlePublish(admin, session.shop, formData);
      case "saveDraft":
        return handleSaveDraft(shop, productGid, formData);
      case "setViewerType":
        return handleSetViewerType(shop, productGid, formData);
      case "deleteConfig":
        return handleDeleteConfig(shop, productGid);
      default:
        return error("Unknown config intent.");
    }
  });
}

/* ───── handlers ───── */

async function handlePublish(admin: AdminGraphqlClient, shopDomain: string, formData: FormData) {
  const productConfigId = String(formData.get("productConfigId") || "");
  if (!productConfigId) {
    return error("Save the draft first so there is a product config to publish.");
  }
  try {
    await publishConfigToMetafields({
      admin, shopDomain, productConfigId, storefrontMode: "metafield",
    });
    return ok("Published draft to metafields.");
  } catch (err) {
    return error(err instanceof Error ? err.message : "Publish failed.", 500);
  }
}

async function handleSetViewerType(shop: { id: string }, productGid: string, formData: FormData) {
  const viewerType = String(formData.get("viewerType") || "MODEL_3D");
  const config = await ensureDraftConfig(shop.id, productGid);
  await prisma.productConfig.update({
    where: { id: config.id },
    data: { viewerType: viewerType === "IMAGE_360" ? "IMAGE_360" : "MODEL_3D" },
  });
  return ok(`Viewer type set to ${viewerType === "IMAGE_360" ? "360° Image" : "3D Model"}.`);
}

async function handleSaveDraft(shop: { id: string }, productGid: string, formData: FormData) {
  const isAutoSave = formData.get("autoSave") === "1";
  const enabled = formData.get("enabled") === "on";
  const sourceMode = String(formData.get("sourceMode") || "APP").toUpperCase();
  const viewerType = String(formData.get("viewerType") || "MODEL_3D");
  const modelFileShopifyGid = String(formData.get("modelFileShopifyGid") || "").trim();
  const posterFileShopifyGid = String(formData.get("posterFileShopifyGid") || "").trim();
  const viewerSettingsJson = String(formData.get("viewerSettingsJson") || "").trim();
  const hotspotsJson = String(formData.get("hotspotsJson") || "").trim();
  const hotspotsJson360 = String(formData.get("hotspotsJson360") || "").trim() || null;

  try {
    JSON.parse(viewerSettingsJson);
  } catch {
    return json({ ok: false, autoSaved: false, message: "Viewer settings JSON is invalid." }, 400);
  }

  let parsedHotspots: Array<Record<string, unknown>> = [];
  try {
    parsedHotspots = JSON.parse(hotspotsJson);
    if (!Array.isArray(parsedHotspots)) {
      return json({ ok: false, autoSaved: false, message: "Hotspots JSON must be an array." }, 400);
    }
  } catch {
    return json({ ok: false, autoSaved: false, message: "Hotspots JSON is invalid." }, 400);
  }

  const productConfig = await prisma.productConfig.upsert({
    where: {
      shopId_shopifyProductGid: { shopId: shop.id, shopifyProductGid: productGid },
    },
    update: {
      enabled, sourceMode, viewerType,
      status: "DRAFT",
      modelFileShopifyGid: modelFileShopifyGid || null,
      posterFileShopifyGid: posterFileShopifyGid || null,
      viewerSettingsJson, hotspotsJson360,
    },
    create: {
      shopId: shop.id,
      shopifyProductGid: productGid,
      enabled, sourceMode, viewerType,
      status: "DRAFT",
      modelFileShopifyGid: modelFileShopifyGid || null,
      posterFileShopifyGid: posterFileShopifyGid || null,
      viewerSettingsJson, hotspotsJson360,
    },
  });

  await prisma.hotspot.deleteMany({ where: { productConfigId: productConfig.id } });

  const COORD_RE = /^(-?\d*\.?\d+)(?:m)?\s+(-?\d*\.?\d+)(?:m)?\s+(-?\d*\.?\d+)(?:m)?$/i;

  for (let i = 0; i < parsedHotspots.length; i += 1) {
    const h = parsedHotspots[i] as Record<string, unknown>;
    const position = String(h.position || "0m 0m 0m").trim().match(COORD_RE);
    if (!position) {
      return json({ ok: false, autoSaved: false, message: `Hotspot ${i + 1} has an invalid position.` }, 400);
    }

    const normal = h.normal ? String(h.normal).trim().match(COORD_RE) : null;
    const focusTarget = h.focusTarget ? String(h.focusTarget).trim().match(COORD_RE) : null;

    await prisma.hotspot.create({
      data: {
        productConfigId: productConfig.id,
        sortOrder: Number(h.sortOrder ?? i + 1),
        visible: Boolean(h.visible ?? true),
        title: String(h.title ?? `Hotspot ${i + 1}`),
        body: String(h.body ?? ""),
        icon: (h.icon as string) ?? null,
        style: String(h.style ?? "card"),
        color: (h.color as string) ?? null,
        animation:
          typeof h.animation === "string" && h.animation !== "none" ? h.animation : null,
        mediaImageUrl: typeof h.mediaImageUrl === "string" && h.mediaImageUrl ? h.mediaImageUrl : null,
        mediaVideoUrl: typeof h.mediaVideoUrl === "string" && h.mediaVideoUrl ? h.mediaVideoUrl : null,
        positionX: Number(position[1]),
        positionY: Number(position[2]),
        positionZ: Number(position[3]),
        normalX: normal ? Number(normal[1]) : null,
        normalY: normal ? Number(normal[2]) : null,
        normalZ: normal ? Number(normal[3]) : null,
        focusTargetX: focusTarget ? Number(focusTarget[1]) : null,
        focusTargetY: focusTarget ? Number(focusTarget[2]) : null,
        focusTargetZ: focusTarget ? Number(focusTarget[3]) : null,
        focusOrbit: (h.focusOrbit as string) ?? null,
        ctaLabel: (h.ctaLabel as string) ?? null,
        ctaUrl: (h.ctaUrl as string) ?? null,
      },
    });
  }

  if (isAutoSave) {
    return json({ ok: true, autoSaved: true, message: "Draft autosaved." });
  }
  return ok("Draft saved.");
}

async function handleDeleteConfig(shop: { id: string }, productGid: string) {
  const config = await prisma.productConfig.findUnique({
    where: {
      shopId_shopifyProductGid: { shopId: shop.id, shopifyProductGid: productGid },
    },
    select: { id: true, status: true },
  });
  if (!config) {
    return json({ ok: false, message: "Config not found." }, 404);
  }

  // Hotspots and Captures cascade per the schema's onDelete: Cascade.
  await prisma.productConfig.delete({ where: { id: config.id } });

  return json({
    ok: true,
    productGid,
    wasPublished: config.status === "PUBLISHED",
    message: "Removed.",
  });
}

/**
 * Bulk republish — re-runs the publish path for every PUBLISHED config in
 * the shop. Closes the staleness footgun from Slice 8 viewer-settings PR
 * #3 (shop-default BG resolved at publish-time, so changing the shop
 * default doesn't update already-published products until they republish).
 * Same mechanism unsticks anything else the publish path resolves at
 * publish-time (icon GIDs, mediaImageUrl GIDs).
 *
 * Sequential calls to publishConfigToMetafields per config — pilot
 * merchant scale is fine; if a future tenant has hundreds of products
 * this could move to a background job. Errors don't halt the batch;
 * each product gets one attempt and the result list reports outcomes.
 */
async function handleRepublishAll(
  admin: AdminGraphqlClient,
  shopDomain: string,
  shop: { id: string },
) {
  const configs = await prisma.productConfig.findMany({
    where: { shopId: shop.id, status: "PUBLISHED" },
    select: { id: true, shopifyProductGid: true },
  });

  if (configs.length === 0) {
    return json({
      ok: true,
      total: 0,
      successful: 0,
      failed: 0,
      errors: [],
      message: "No published products to republish.",
    });
  }

  let successful = 0;
  const errors: Array<{ productGid: string; message: string }> = [];

  for (const config of configs) {
    try {
      await publishConfigToMetafields({
        admin,
        shopDomain,
        productConfigId: config.id,
        storefrontMode: "metafield",
      });
      successful++;
    } catch (err) {
      errors.push({
        productGid: config.shopifyProductGid,
        message: err instanceof Error ? err.message : "Unknown publish error.",
      });
    }
  }

  const failed = errors.length;
  const summary = failed === 0
    ? `Republished ${successful} product${successful === 1 ? "" : "s"}.`
    : `Republished ${successful} of ${configs.length}; ${failed} failed.`;

  return json({
    ok: failed === 0,
    total: configs.length,
    successful,
    failed,
    errors,
    message: summary,
  });
}

async function handleDeleteOrphanedConfigs(
  admin: AdminGraphqlClient,
  shop: { id: string },
) {
  const configs = await prisma.productConfig.findMany({
    where: { shopId: shop.id },
    select: { id: true, shopifyProductGid: true },
  });
  if (configs.length === 0) {
    return json({ ok: true, deletedCount: 0, message: "Nothing to delete." });
  }

  const malformed: string[] = [];
  const validGids: string[] = [];
  for (const c of configs) {
    if (VALID_PRODUCT_GID.test(c.shopifyProductGid)) {
      validGids.push(c.shopifyProductGid);
    } else {
      malformed.push(c.shopifyProductGid);
    }
  }

  const missing = new Set<string>(malformed);

  for (let i = 0; i < validGids.length; i += RESOLVE_BATCH_SIZE) {
    const batch = validGids.slice(i, i + RESOLVE_BATCH_SIZE);
    try {
      const data = await adminGraphql<{
        nodes: Array<{ __typename: string; id: string } | null>;
      }>(
        admin,
        `query ResolveProductExistence($ids: [ID!]!) {
          nodes(ids: $ids) { __typename ... on Product { id } }
        }`,
        { ids: batch },
      );
      const resolved = new Set<string>();
      for (const node of data.nodes) {
        if (node && node.__typename === "Product" && "id" in node) {
          resolved.add(node.id);
        }
      }
      for (const gid of batch) {
        if (!resolved.has(gid)) missing.add(gid);
      }
    } catch (err) {
      console.error("[sdl3d/config] deleteOrphanedConfigs resolve failed", err);
      return json(
        {
          ok: false,
          message: "Couldn't verify product existence with Shopify. Try again.",
        },
        502,
      );
    }
  }

  if (missing.size === 0) {
    return json({ ok: true, deletedCount: 0, message: "No orphaned configs found." });
  }

  const result = await prisma.productConfig.deleteMany({
    where: { shopId: shop.id, shopifyProductGid: { in: Array.from(missing) } },
  });

  return json({
    ok: true,
    deletedCount: result.count,
    message: `Removed ${result.count} orphaned config${result.count === 1 ? "" : "s"}.`,
  });
}

