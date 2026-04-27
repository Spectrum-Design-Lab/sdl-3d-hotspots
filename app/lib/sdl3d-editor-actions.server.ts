import { redirect } from "react-router";
import prisma from "../db.server";
import { defaultViewerSettings, detectViewerTypeFromFilename, type ImageSequenceFrame } from "./sdl3d-shared";
import { adminGraphql, ensureShop, type AdminGraphqlClient } from "./sdl3d-graphql.server";
import { publishConfigToMetafields, pullMetafieldsToDraft } from "./sdl3d-sync.server";
import { uploadShopifyAdminFile, listShopifyFiles } from "./sdl3d-files.server";
import { uploadImageSequence } from "./sdl3d-image-sequence.server";

async function ensureDraftConfig(shopId: string, productGid: string) {
  return prisma.productConfig.upsert({
    where: {
      shopId_shopifyProductGid: {
        shopId,
        shopifyProductGid: productGid,
      },
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

function buildRedirectUrl(q: string, productGid: string, flash: string) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (productGid) params.set("product", productGid);
  if (flash) params.set("flash", flash);
  return `/app/sdl3d/editor?${params.toString()}`;
}

/** Return JSON when fetcher mode, redirect otherwise */
function respond(isFetcher: boolean, q: string, productGid: string, message: string, reload = true) {
  if (isFetcher) return { ok: true, message, reload };
  return redirect(buildRedirectUrl(q, productGid, message));
}

export async function handleEditorAction({
  admin,
  shopDomain,
  formData,
}: {
  admin: AdminGraphqlClient;
  shopDomain: string;
  formData: FormData;
}) {
  const shop = await ensureShop(shopDomain);
  const intent = String(formData.get("intent") || "");
  const productGid = String(formData.get("productGid") || "");
  const q = String(formData.get("q") || "");
  const isAutoSave = formData.get("autoSave") === "1";
  const isFetcher = formData.get("fetcherMode") === "1";

  if (!productGid) {
    if (isFetcher) return { ok: false, message: "Missing product GID.", reload: false };
    return redirect(buildRedirectUrl(q, productGid, "Missing product GID."));
  }

  if (intent === "pull") {
    try {
      await pullMetafieldsToDraft({
        admin,
        shopDomain,
        shopifyProductGid: productGid,
      });
      if (isFetcher) return { ok: true, message: "Pulled metafields into draft.", reload: true };
      return redirect(buildRedirectUrl(q, productGid, "Pulled metafields into draft."));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Pull failed.";
      if (isFetcher) return { ok: false, message: msg, reload: false };
      return redirect(buildRedirectUrl(q, productGid, msg));
    }
  }

  if (intent === "publish") {
    const productConfigId = String(formData.get("productConfigId") || "");
    if (!productConfigId) {
      const msg = "Save the draft first so there is a product config to publish.";
      if (isFetcher) return { ok: false, message: msg, reload: false };
      return redirect(buildRedirectUrl(q, productGid, msg));
    }
    try {
      await publishConfigToMetafields({
        admin,
        shopDomain,
        productConfigId,
        storefrontMode: "metafield",
      });
      if (isFetcher) return { ok: true, message: "Published draft to metafields.", reload: true };
      return redirect(buildRedirectUrl(q, productGid, "Published draft to metafields."));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Publish failed.";
      if (isFetcher) return { ok: false, message: msg, reload: false };
      return redirect(buildRedirectUrl(q, productGid, msg));
    }
  }

  if (intent === "selectModelFile") {
    const selectedModelFileGid = String(formData.get("selectedModelFileGid") || "");
    const config = await ensureDraftConfig(shop.id, productGid);
    await prisma.productConfig.update({
      where: { id: config.id },
      data: { modelFileShopifyGid: selectedModelFileGid || null },
    });
    return respond(isFetcher, q, productGid, "Selected model file saved to draft.");
  }

  if (intent === "selectPosterFile") {
    const selectedPosterFileGid = String(formData.get("selectedPosterFileGid") || "");
    const config = await ensureDraftConfig(shop.id, productGid);
    await prisma.productConfig.update({
      where: { id: config.id },
      data: { posterFileShopifyGid: selectedPosterFileGid || null },
    });
    return respond(isFetcher, q, productGid, "Selected poster file saved to draft.");
  }

  if (intent === "uploadModelFile") {
    const uploaded = formData.get("modelUpload");
    if (!(uploaded instanceof File) || uploaded.size <= 0) {
      return respond(isFetcher, q, productGid, "Choose a .glb file first.");
    }
    const detectedType = detectViewerTypeFromFilename(uploaded.name);
    const created = await uploadShopifyAdminFile({
      admin,
      file: uploaded,
      kind: detectedType === "MODEL_3D" ? "MODEL_3D" : "IMAGE",
      alt: uploaded.name,
    });
    const config = await ensureDraftConfig(shop.id, productGid);
    await prisma.productConfig.update({
      where: { id: config.id },
      data: {
        modelFileShopifyGid: created.id,
        viewerType: detectedType,
      },
    });
    return respond(
      isFetcher, q, productGid,
      `Uploaded ${detectedType === "IMAGE_360" ? "image" : "model"} file. Viewer type set to ${detectedType === "IMAGE_360" ? "360°" : "3D Model"}.`,
    );
  }

  if (intent === "uploadImageSequence") {
    const files: File[] = [];
    for (const entry of formData.getAll("imageSequenceUpload")) {
      if (entry instanceof File && entry.size > 0) {
        files.push(entry);
      }
    }
    if (!files.length) {
      return respond(isFetcher, q, productGid, "Choose image files first.");
    }
    const config = await ensureDraftConfig(shop.id, productGid);
    const result = await uploadImageSequence({ admin, productConfigId: config.id, files });
    return respond(
      isFetcher, q, productGid,
      `Uploaded ${result.frameCount} frames for 360° image sequence.`,
    );
  }

  if (intent === "selectImageSequence") {
    const selectedGidsRaw = String(formData.get("selectedGids") || "[]");
    let gids: string[];
    try {
      gids = JSON.parse(selectedGidsRaw);
    } catch {
      return respond(isFetcher, q, productGid, "Invalid file selection.");
    }
    if (!Array.isArray(gids) || !gids.length) {
      return respond(isFetcher, q, productGid, "No files selected.");
    }
    const frames: ImageSequenceFrame[] = gids.map((gid, i) => ({
      index: i,
      imageGid: String(gid),
      imageUrl: "",
    }));
    const prefix = String(formData.get("prefix") || "").trim() || null;
    const config = await ensureDraftConfig(shop.id, productGid);
    await prisma.productConfig.update({
      where: { id: config.id },
      data: {
        imageSequenceJson: JSON.stringify(frames),
        frameCount: frames.length,
        viewerType: "IMAGE_360",
        imageSequencePrefix: prefix,
      },
    });
    return respond(
      isFetcher, q, productGid,
      `Selected ${frames.length} files as 360° image sequence.`,
    );
  }

  if (intent === "searchFiles") {
    const fileType = String(formData.get("fileType") || "IMAGE") as "MODEL3D" | "IMAGE";
    const searchTerm = String(formData.get("searchTerm") || "").trim();
    const result = await listShopifyFiles(admin, fileType, null, 50, searchTerm || undefined);
    return { ok: true, intent: "searchFiles", files: result.files, hasNextPage: result.hasNextPage, endCursor: result.endCursor };
  }

  if (intent === "uploadPosterFile") {
    const uploaded = formData.get("posterUpload");
    if (!(uploaded instanceof File) || uploaded.size <= 0) {
      return respond(isFetcher, q, productGid, "Choose an image file first.");
    }
    const created = await uploadShopifyAdminFile({
      admin,
      file: uploaded,
      kind: "IMAGE",
      alt: uploaded.name,
    });
    const config = await ensureDraftConfig(shop.id, productGid);
    await prisma.productConfig.update({
      where: { id: config.id },
      data: { posterFileShopifyGid: created.id },
    });
    return respond(
      isFetcher, q, productGid,
      `Uploaded poster file to Shopify. Status: ${created.fileStatus}.`,
    );
  }

  if (intent === "setViewerType") {
    const viewerType = String(formData.get("viewerType") || "MODEL_3D");
    const config = await ensureDraftConfig(shop.id, productGid);
    await prisma.productConfig.update({
      where: { id: config.id },
      data: { viewerType: viewerType === "IMAGE_360" ? "IMAGE_360" : "MODEL_3D" },
    });
    return respond(isFetcher, q, productGid, `Viewer type set to ${viewerType === "IMAGE_360" ? "360° Image" : "3D Model"}.`);
  }

  if (intent === "copyConfig") {
    return handleCopyConfig({ shop, productGid, q, formData, isFetcher });
  }

  if (intent === "saveAsPreset") {
    const presetName = String(formData.get("presetName") || "").trim();
    if (!presetName) {
      return respond(isFetcher, q, productGid, "Preset name is required.");
    }
    const existing = await prisma.preset.findUnique({
      where: { shopId_name: { shopId: shop.id, name: presetName } },
    });
    if (existing) {
      await prisma.preset.update({
        where: { id: existing.id },
        data: {
          viewerType: String(formData.get("viewerType") || "MODEL_3D"),
          viewerSettingsJson: String(formData.get("viewerSettingsJson") || "{}"),
          hotspotsJson: String(formData.get("hotspotsJson") || "[]"),
          hotspotsJson360: String(formData.get("hotspotsJson360") || "") || null,
        },
      });
      return respond(isFetcher, q, productGid, `Preset "${presetName}" updated.`);
    }
    await prisma.preset.create({
      data: {
        shopId: shop.id,
        name: presetName,
        viewerType: String(formData.get("viewerType") || "MODEL_3D"),
        viewerSettingsJson: String(formData.get("viewerSettingsJson") || "{}"),
        hotspotsJson: String(formData.get("hotspotsJson") || "[]"),
        hotspotsJson360: String(formData.get("hotspotsJson360") || "") || null,
      },
    });
    return respond(isFetcher, q, productGid, `Preset "${presetName}" saved.`);
  }

  if (intent === "loadMoreFiles") {
    const fileType = String(formData.get("fileType") || "MODEL3D") as "MODEL3D" | "IMAGE";
    const cursor = String(formData.get("cursor") || "");
    const result = await listShopifyFiles(admin, fileType, cursor || null);
    return { ok: true, fileType, files: result.files, hasNextPage: result.hasNextPage, endCursor: result.endCursor };
  }

  if (intent === "saveDraft") {
    return handleSaveDraft({ shop, productGid, q, formData, isAutoSave });
  }

  return redirect(buildRedirectUrl(q, productGid, "Unknown action."));
}

async function handleSaveDraft({
  shop,
  productGid,
  q,
  formData,
  isAutoSave,
}: {
  shop: { id: string };
  productGid: string;
  q: string;
  formData: FormData;
  isAutoSave: boolean;
}) {
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
    if (isAutoSave) {
      return { ok: false, autoSaved: false, message: "Autosave skipped: viewer settings JSON is invalid." };
    }
    return redirect(buildRedirectUrl(q, productGid, "viewerSettingsJson is not valid JSON."));
  }

  let parsedHotspots: Array<{
    id?: string;
    sortOrder?: number;
    visible?: boolean;
    title?: string;
    body?: string;
    icon?: string | null;
    style?: string;
    color?: string | null;
    position?: string;
    normal?: string | null;
    focusTarget?: string | null;
    focusOrbit?: string | null;
    ctaLabel?: string | null;
    ctaUrl?: string | null;
  }> = [];

  try {
    parsedHotspots = JSON.parse(hotspotsJson);
    if (!Array.isArray(parsedHotspots)) {
      if (isAutoSave) {
        return { ok: false, autoSaved: false, message: "Autosave skipped: hotspots JSON must be an array." };
      }
      return redirect(buildRedirectUrl(q, productGid, "hotspotsJson must be a JSON array."));
    }
  } catch {
    if (isAutoSave) {
      return { ok: false, autoSaved: false, message: "Autosave skipped: hotspots JSON is invalid." };
    }
    return redirect(buildRedirectUrl(q, productGid, "hotspotsJson is not valid JSON."));
  }

  const productConfig = await prisma.productConfig.upsert({
    where: {
      shopId_shopifyProductGid: {
        shopId: shop.id,
        shopifyProductGid: productGid,
      },
    },
    update: {
      enabled,
      sourceMode,
      viewerType,
      status: "DRAFT",
      modelFileShopifyGid: modelFileShopifyGid || null,
      posterFileShopifyGid: posterFileShopifyGid || null,
      viewerSettingsJson,
      hotspotsJson360,
    },
    create: {
      shopId: shop.id,
      shopifyProductGid: productGid,
      enabled,
      sourceMode,
      viewerType,
      status: "DRAFT",
      modelFileShopifyGid: modelFileShopifyGid || null,
      posterFileShopifyGid: posterFileShopifyGid || null,
      viewerSettingsJson,
      hotspotsJson360,
    },
  });

  await prisma.hotspot.deleteMany({
    where: { productConfigId: productConfig.id },
  });

  const COORD_RE = /^(-?\d*\.?\d+)(?:m)?\s+(-?\d*\.?\d+)(?:m)?\s+(-?\d*\.?\d+)(?:m)?$/i;

  for (let i = 0; i < parsedHotspots.length; i += 1) {
    const h = parsedHotspots[i];
    const position = String(h.position || "0m 0m 0m").trim().match(COORD_RE);
    if (!position) {
      if (isAutoSave) {
        return { ok: false, autoSaved: false, message: `Autosave skipped: Hotspot ${i + 1} has an invalid position.` };
      }
      return redirect(buildRedirectUrl(q, productGid, `Hotspot ${i + 1} has an invalid position.`));
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
        icon: h.icon ?? null,
        style: String(h.style ?? "card"),
        color: h.color ?? null,
        positionX: Number(position[1]),
        positionY: Number(position[2]),
        positionZ: Number(position[3]),
        normalX: normal ? Number(normal[1]) : null,
        normalY: normal ? Number(normal[2]) : null,
        normalZ: normal ? Number(normal[3]) : null,
        focusTargetX: focusTarget ? Number(focusTarget[1]) : null,
        focusTargetY: focusTarget ? Number(focusTarget[2]) : null,
        focusTargetZ: focusTarget ? Number(focusTarget[3]) : null,
        focusOrbit: h.focusOrbit ?? null,
        ctaLabel: h.ctaLabel ?? null,
        ctaUrl: h.ctaUrl ?? null,
      },
    });
  }

  if (isAutoSave) {
    return { ok: true, autoSaved: true, message: "Draft autosaved." };
  }
  return redirect(buildRedirectUrl(q, productGid, "Draft saved."));
}

async function handleCopyConfig({
  shop,
  productGid,
  q,
  formData,
  isFetcher,
}: {
  shop: { id: string };
  productGid: string;
  q: string;
  formData: FormData;
  isFetcher: boolean;
}) {
  const sourceProductGid = String(formData.get("sourceProductGid") || "");
  if (!sourceProductGid) {
    return respond(isFetcher, q, productGid, "No source product selected.");
  }

  if (sourceProductGid === productGid) {
    return respond(isFetcher, q, productGid, "Cannot copy from the same product.");
  }

  const source = await prisma.productConfig.findUnique({
    where: {
      shopId_shopifyProductGid: {
        shopId: shop.id,
        shopifyProductGid: sourceProductGid,
      },
    },
    include: { hotspots: true },
  });

  if (!source) {
    return respond(isFetcher, q, productGid, "Source product has no saved configuration.");
  }

  const target = await prisma.productConfig.upsert({
    where: {
      shopId_shopifyProductGid: {
        shopId: shop.id,
        shopifyProductGid: productGid,
      },
    },
    update: {
      enabled: source.enabled,
      sourceMode: source.sourceMode,
      viewerType: source.viewerType,
      status: "DRAFT",
      modelFileShopifyGid: source.modelFileShopifyGid,
      posterFileShopifyGid: source.posterFileShopifyGid,
      viewerSettingsJson: source.viewerSettingsJson,
      imageSequenceJson: source.imageSequenceJson,
      frameCount: source.frameCount,
      hotspotsJson360: source.hotspotsJson360,
    },
    create: {
      shopId: shop.id,
      shopifyProductGid: productGid,
      enabled: source.enabled,
      sourceMode: source.sourceMode,
      viewerType: source.viewerType,
      status: "DRAFT",
      modelFileShopifyGid: source.modelFileShopifyGid,
      posterFileShopifyGid: source.posterFileShopifyGid,
      viewerSettingsJson: source.viewerSettingsJson,
      imageSequenceJson: source.imageSequenceJson,
      frameCount: source.frameCount,
      hotspotsJson360: source.hotspotsJson360,
    },
  });

  // Delete existing hotspots on target, copy from source
  await prisma.hotspot.deleteMany({ where: { productConfigId: target.id } });

  for (const h of source.hotspots) {
    await prisma.hotspot.create({
      data: {
        productConfigId: target.id,
        sortOrder: h.sortOrder,
        visible: h.visible,
        title: h.title,
        body: h.body,
        icon: h.icon,
        style: h.style,
        color: h.color,
        positionX: h.positionX,
        positionY: h.positionY,
        positionZ: h.positionZ,
        normalX: h.normalX,
        normalY: h.normalY,
        normalZ: h.normalZ,
        focusTargetX: h.focusTargetX,
        focusTargetY: h.focusTargetY,
        focusTargetZ: h.focusTargetZ,
        focusOrbit: h.focusOrbit,
        ctaLabel: h.ctaLabel,
        ctaUrl: h.ctaUrl,
      },
    });
  }

  return respond(isFetcher, q, productGid, `Copied configuration from source product (${source.hotspots.length} hotspots).`);
}
