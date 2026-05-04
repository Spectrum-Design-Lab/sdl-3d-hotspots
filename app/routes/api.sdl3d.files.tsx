/**
 * API route for file operations:
 *   uploadModelFile, uploadPosterFile, selectModelFile, selectPosterFile,
 *   uploadImageSequence, selectImageSequence, searchFiles, loadMoreFiles
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import shopify from "../shopify.server";
import prisma from "../db.server";

export function loader({ request }: LoaderFunctionArgs) {
  return new Response("Method not allowed", { status: 405 });
}
import { ensureShop, type AdminGraphqlClient } from "../lib/sdl3d-graphql.server";
import { uploadShopifyAdminFile, listShopifyFiles, listAllShopifyFilesByPrefix, listRelatedFiles } from "../lib/sdl3d-files.server";
import { uploadImageSequence } from "../lib/sdl3d-image-sequence.server";
import { defaultViewerSettings, detectViewerTypeFromFilename, type ImageSequenceFrame } from "../lib/sdl3d-shared";
import { createFolder, addFilesToFolder } from "../lib/sdl3d-folders.server";

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

  // File search/pagination don't require productGid
  if (intent === "searchFiles") {
    return handleSearchFiles(admin, formData);
  }
  if (intent === "loadMoreFiles") {
    return handleLoadMoreFiles(admin, formData);
  }
  if (intent === "autoSelectByPrefix") {
    return handleAutoSelectByPrefix(admin, formData);
  }
  if (intent === "loadRelatedFiles") {
    return handleLoadRelatedFiles(admin, formData);
  }

  if (!productGid) {
    return error("Missing product GID.");
  }

  switch (intent) {
    case "selectModelFile":
      return handleSelectModelFile(shop, productGid, formData);
    case "selectPosterFile":
      return handleSelectPosterFile(shop, productGid, formData);
    case "uploadModelFile":
      return handleUploadModelFile(admin, shop, productGid, formData);
    case "uploadPosterFile":
      return handleUploadPosterFile(admin, shop, productGid, formData);
    case "uploadImageSequence":
      return handleUploadImageSequence(admin, shop, productGid, formData);
    case "selectImageSequence":
      return handleSelectImageSequence(shop, productGid, formData);
    default:
      return error("Unknown file intent.");
  }
}

/* ───── handlers ───── */

async function handleSelectModelFile(shop: { id: string }, productGid: string, formData: FormData) {
  const selectedModelFileGid = String(formData.get("selectedModelFileGid") || "");
  const config = await ensureDraftConfig(shop.id, productGid);
  await prisma.productConfig.update({
    where: { id: config.id },
    data: { modelFileShopifyGid: selectedModelFileGid || null },
  });
  return ok("Selected model file saved to draft.");
}

async function handleSelectPosterFile(shop: { id: string }, productGid: string, formData: FormData) {
  const selectedPosterFileGid = String(formData.get("selectedPosterFileGid") || "");
  const config = await ensureDraftConfig(shop.id, productGid);
  await prisma.productConfig.update({
    where: { id: config.id },
    data: { posterFileShopifyGid: selectedPosterFileGid || null },
  });
  return ok("Selected poster file saved to draft.");
}

async function handleUploadModelFile(admin: AdminGraphqlClient, shop: { id: string }, productGid: string, formData: FormData) {
  const uploaded = formData.get("modelUpload");
  if (!(uploaded instanceof File) || uploaded.size <= 0) {
    return error("Choose a .glb file first.");
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
  return ok(
    `Uploaded ${detectedType === "IMAGE_360" ? "image" : "model"} file. Viewer type set to ${detectedType === "IMAGE_360" ? "360°" : "3D Model"}.`,
  );
}

async function handleUploadPosterFile(admin: AdminGraphqlClient, shop: { id: string }, productGid: string, formData: FormData) {
  const uploaded = formData.get("posterUpload");
  if (!(uploaded instanceof File) || uploaded.size <= 0) {
    return error("Choose an image file first.");
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
  return ok(`Uploaded poster file to Shopify. Status: ${created.fileStatus}.`);
}

async function handleUploadImageSequence(admin: AdminGraphqlClient, shop: { id: string }, productGid: string, formData: FormData) {
  const files: File[] = [];
  for (const entry of formData.getAll("imageSequenceUpload")) {
    if (entry instanceof File && entry.size > 0) {
      files.push(entry);
    }
  }
  if (!files.length) {
    return error("Choose image files first.");
  }
  const config = await ensureDraftConfig(shop.id, productGid);
  const result = await uploadImageSequence({ admin, productConfigId: config.id, files });

  // Auto-create folder when uploaded from a ZIP
  const zipFolderName = String(formData.get("zipFolderName") || "").trim();
  let folderId: string | null = null;
  if (zipFolderName && result.uploadedFiles.length) {
    const folder = await createFolder(shop.id, zipFolderName);
    folderId = folder.id;
    await addFilesToFolder(
      shop.id,
      folder.id,
      result.uploadedFiles
        .filter((f): f is typeof f & { shopifyFileGid: string } => Boolean(f.shopifyFileGid))
        .map((f) => ({
          shopifyFileGid: f.shopifyFileGid,
          originalFilename: f.filename,
          url: "",
          kind: "IMAGE",
        })),
    );
  }

  return json({
    ok: true,
    message: `Uploaded ${result.frameCount} frames for 360° image sequence.${folderId ? ` Created folder "${zipFolderName}".` : ""}`,
    reload: true,
    folderId,
  });
}

async function handleSelectImageSequence(shop: { id: string }, productGid: string, formData: FormData) {
  const selectedGidsRaw = String(formData.get("selectedGids") || "[]");
  let gids: string[];
  try {
    gids = JSON.parse(selectedGidsRaw);
  } catch {
    return error("Invalid file selection.");
  }
  if (!Array.isArray(gids) || !gids.length) {
    return error("No files selected.");
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
  return ok(`Selected ${frames.length} files as 360° image sequence.`);
}

async function handleSearchFiles(admin: AdminGraphqlClient, formData: FormData) {
  const fileType = String(formData.get("fileType") || "IMAGE") as "MODEL3D" | "IMAGE";
  const searchTerm = String(formData.get("searchTerm") || "").trim();
  const result = await listShopifyFiles(admin, fileType, null, 100, searchTerm || undefined);
  return json({ ok: true, intent: "searchFiles", files: result.files, hasNextPage: result.hasNextPage, endCursor: result.endCursor });
}

async function handleLoadMoreFiles(admin: AdminGraphqlClient, formData: FormData) {
  const fileType = String(formData.get("fileType") || "MODEL3D") as "MODEL3D" | "IMAGE";
  const cursor = String(formData.get("cursor") || "");
  const result = await listShopifyFiles(admin, fileType, cursor || null);
  return json({ ok: true, fileType, files: result.files, hasNextPage: result.hasNextPage, endCursor: result.endCursor });
}

async function handleAutoSelectByPrefix(admin: AdminGraphqlClient, formData: FormData) {
  const fileType = String(formData.get("fileType") || "IMAGE") as "MODEL3D" | "IMAGE";
  const prefix = String(formData.get("prefix") || "").trim();
  if (!prefix) return json({ ok: false, message: "No prefix provided." }, 400);
  const files = await listAllShopifyFilesByPrefix(admin, fileType, prefix);
  return json({ ok: true, intent: "autoSelectByPrefix", files, count: files.length });
}

async function handleLoadRelatedFiles(admin: AdminGraphqlClient, formData: FormData) {
  const fileType = String(formData.get("fileType") || "IMAGE") as "MODEL3D" | "IMAGE";
  const referenceFilename = String(formData.get("referenceFilename") || "").trim();
  if (!referenceFilename) {
    const result = await listShopifyFiles(admin, fileType, null, 100);
    return json({ ok: true, intent: "loadRelatedFiles", files: result.files, hasNextPage: result.hasNextPage, endCursor: result.endCursor });
  }
  const result = await listRelatedFiles(admin, fileType, referenceFilename);
  return json({ ok: true, intent: "loadRelatedFiles", files: result.files, hasNextPage: result.hasNextPage, endCursor: result.endCursor });
}
