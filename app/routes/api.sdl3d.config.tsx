/**
 * API route for product config operations:
 *   saveDraft, publish, pull, copyConfig, setViewerType
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

export function loader({ request }: LoaderFunctionArgs) {
  return new Response("Method not allowed", { status: 405 });
}
import shopify from "../shopify.server";
import prisma from "../db.server";
import { ensureShop, adminGraphql, type AdminGraphqlClient } from "../lib/sdl3d-graphql.server";
import { publishConfigToMetafields, pullMetafieldsToDraft } from "../lib/sdl3d-sync.server";
import { defaultViewerSettings, detectViewerTypeFromFilename, type ImageSequenceFrame } from "../lib/sdl3d-shared";
import { notify } from "../lib/notify.server";

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
  const { admin, session } = await shopify.authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const productGid = String(formData.get("productGid") || "");

  if (!productGid) {
    return error("Missing product GID.");
  }

  switch (intent) {
    case "pull":
      return handlePull(admin, session.shop, productGid);
    case "publish":
      return handlePublish(admin, session.shop, formData);
    case "saveDraft":
      return handleSaveDraft(shop, productGid, formData);
    case "copyConfig":
      return handleCopyConfig(shop, productGid, formData);
    case "setViewerType":
      return handleSetViewerType(shop, productGid, formData);
    default:
      return error("Unknown config intent.");
  }
}

/* ───── handlers ───── */

async function handlePull(admin: AdminGraphqlClient, shopDomain: string, productGid: string) {
  try {
    await pullMetafieldsToDraft({ admin, shopDomain, shopifyProductGid: productGid });
    return ok("Pulled metafields into draft.");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pull failed.";
    void notify({
      title: `Metafield pull failed for ${shopDomain}`,
      body: `${productGid}: ${message}`,
      level: "error",
    });
    return error(message, 500);
  }
}

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

async function handleCopyConfig(shop: { id: string }, productGid: string, formData: FormData) {
  const sourceProductGid = String(formData.get("sourceProductGid") || "");
  if (!sourceProductGid) return error("No source product selected.");
  if (sourceProductGid === productGid) return error("Cannot copy from the same product.");

  const source = await prisma.productConfig.findUnique({
    where: {
      shopId_shopifyProductGid: { shopId: shop.id, shopifyProductGid: sourceProductGid },
    },
    include: { hotspots: true },
  });

  if (!source) return error("Source product has no saved configuration.");

  const target = await prisma.productConfig.upsert({
    where: {
      shopId_shopifyProductGid: { shopId: shop.id, shopifyProductGid: productGid },
    },
    update: {
      enabled: source.enabled, sourceMode: source.sourceMode, viewerType: source.viewerType,
      status: "DRAFT",
      modelFileShopifyGid: source.modelFileShopifyGid, posterFileShopifyGid: source.posterFileShopifyGid,
      viewerSettingsJson: source.viewerSettingsJson,
      imageSequenceJson: source.imageSequenceJson, frameCount: source.frameCount,
      hotspotsJson360: source.hotspotsJson360,
    },
    create: {
      shopId: shop.id, shopifyProductGid: productGid,
      enabled: source.enabled, sourceMode: source.sourceMode, viewerType: source.viewerType,
      status: "DRAFT",
      modelFileShopifyGid: source.modelFileShopifyGid, posterFileShopifyGid: source.posterFileShopifyGid,
      viewerSettingsJson: source.viewerSettingsJson,
      imageSequenceJson: source.imageSequenceJson, frameCount: source.frameCount,
      hotspotsJson360: source.hotspotsJson360,
    },
  });

  await prisma.hotspot.deleteMany({ where: { productConfigId: target.id } });

  for (const h of source.hotspots) {
    await prisma.hotspot.create({
      data: {
        productConfigId: target.id,
        sortOrder: h.sortOrder, visible: h.visible,
        title: h.title, body: h.body, icon: h.icon, style: h.style, color: h.color,
        positionX: h.positionX, positionY: h.positionY, positionZ: h.positionZ,
        normalX: h.normalX, normalY: h.normalY, normalZ: h.normalZ,
        focusTargetX: h.focusTargetX, focusTargetY: h.focusTargetY, focusTargetZ: h.focusTargetZ,
        focusOrbit: h.focusOrbit, ctaLabel: h.ctaLabel, ctaUrl: h.ctaUrl,
      },
    });
  }

  return ok(`Copied configuration from source product (${source.hotspots.length} hotspots).`);
}
