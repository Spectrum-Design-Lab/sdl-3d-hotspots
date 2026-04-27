/**
 * API route for folder operations:
 *   listFolders, getFolderContents, createFolder, renameFolder,
 *   deleteFolder, addToFolder, removeFromFolder
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import shopify from "../shopify.server";
import { ensureShop } from "../lib/sdl3d-graphql.server";
import {
  listFolders,
  getFolderContents,
  createFolder,
  renameFolder,
  deleteFolder,
  addFilesToFolder,
  removeFilesFromFolder,
  type FileToAdd,
} from "../lib/sdl3d-folders.server";

export function loader({ request }: LoaderFunctionArgs) {
  return new Response("Method not allowed", { status: 405 });
}

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

/* ───── action ───── */

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await shopify.authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  switch (intent) {
    case "listFolders":
      return handleListFolders(shop.id);
    case "getFolderContents":
      return handleGetFolderContents(formData);
    case "createFolder":
      return handleCreateFolder(shop.id, formData);
    case "renameFolder":
      return handleRenameFolder(formData);
    case "deleteFolder":
      return handleDeleteFolder(formData);
    case "addToFolder":
      return handleAddToFolder(shop.id, formData);
    case "removeFromFolder":
      return handleRemoveFromFolder(formData);
    default:
      return error("Unknown folder intent.");
  }
}

/* ───── handlers ───── */

async function handleListFolders(shopId: string) {
  const folders = await listFolders(shopId);
  return json({ ok: true, folders });
}

async function handleGetFolderContents(formData: FormData) {
  const folderId = String(formData.get("folderId") || "");
  if (!folderId) return error("Missing folder ID.");
  const assets = await getFolderContents(folderId);
  return json({ ok: true, assets });
}

async function handleCreateFolder(shopId: string, formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  if (!name) return error("Folder name is required.");
  const folder = await createFolder(shopId, name);
  return json({ ok: true, folder });
}

async function handleRenameFolder(formData: FormData) {
  const folderId = String(formData.get("folderId") || "");
  const name = String(formData.get("name") || "").trim();
  if (!folderId) return error("Missing folder ID.");
  if (!name) return error("Folder name is required.");
  await renameFolder(folderId, name);
  return json({ ok: true, message: "Folder renamed." });
}

async function handleDeleteFolder(formData: FormData) {
  const folderId = String(formData.get("folderId") || "");
  if (!folderId) return error("Missing folder ID.");
  await deleteFolder(folderId);
  return json({ ok: true, message: "Folder deleted." });
}

async function handleAddToFolder(shopId: string, formData: FormData) {
  const folderId = String(formData.get("folderId") || "");
  if (!folderId) return error("Missing folder ID.");

  let files: FileToAdd[];
  try {
    const filesRaw = String(formData.get("files") || "[]");
    files = JSON.parse(filesRaw);
  } catch {
    return error("Invalid files data.");
  }

  if (!Array.isArray(files) || !files.length) {
    return error("No files to add.");
  }

  const count = await addFilesToFolder(shopId, folderId, files);
  return json({ ok: true, message: `Added ${count} file(s) to folder.`, count });
}

async function handleRemoveFromFolder(formData: FormData) {
  let assetIds: string[];
  try {
    const raw = String(formData.get("assetIds") || "[]");
    assetIds = JSON.parse(raw);
  } catch {
    return error("Invalid asset IDs.");
  }

  if (!Array.isArray(assetIds) || !assetIds.length) {
    return error("No assets to remove.");
  }

  const count = await removeFilesFromFolder(assetIds);
  return json({ ok: true, message: `Removed ${count} file(s) from folder.`, count });
}
