import prisma from "../db.server";

/* ────────────────────────────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────────────────────────────── */

export interface FolderSummary {
  id: string;
  name: string;
  assetCount: number;
  createdAt: string;
}

export interface FolderAsset {
  id: string;
  shopifyFileGid: string | null;
  originalFilename: string;
  url: string;
  kind: string;
  mimeType: string | null;
  createdAt: string;
}

/* ────────────────────────────────────────────────────────────────────
 * List folders
 * ──────────────────────────────────────────────────────────────────── */

export async function listFolders(shopId: string): Promise<FolderSummary[]> {
  const folders = await prisma.folder.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { assets: true } } },
  });
  return folders.map((f) => ({
    id: f.id,
    name: f.name,
    assetCount: f._count.assets,
    createdAt: f.createdAt.toISOString(),
  }));
}

/* ────────────────────────────────────────────────────────────────────
 * Get folder contents
 * ──────────────────────────────────────────────────────────────────── */

export async function getFolderContents(folderId: string): Promise<FolderAsset[]> {
  const assets = await prisma.asset.findMany({
    where: { folderId },
    orderBy: { originalFilename: "asc" },
  });
  return assets.map((a) => ({
    id: a.id,
    shopifyFileGid: a.shopifyFileGid,
    originalFilename: a.originalFilename,
    url: a.url,
    kind: a.kind,
    mimeType: a.mimeType,
    createdAt: a.createdAt.toISOString(),
  }));
}

/* ────────────────────────────────────────────────────────────────────
 * Create folder (auto-suffix on name conflict)
 * ──────────────────────────────────────────────────────────────────── */

export async function createFolder(shopId: string, name: string): Promise<{ id: string; name: string }> {
  let finalName = name.trim() || "Untitled Folder";
  let attempt = 0;

  // Retry-on-collision loop — exits via explicit return (success) or
  // throw (non-unique-constraint failure). Constant condition is the
  // intent.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const folder = await prisma.folder.create({
        data: { shopId, name: finalName },
      });
      return { id: folder.id, name: folder.name };
    } catch (err: any) {
      // Unique constraint violation → try with suffix
      if (err?.code === "P2002" && attempt < 50) {
        attempt++;
        finalName = `${name.trim()} (${attempt})`;
      } else {
        throw err;
      }
    }
  }
}

/* ────────────────────────────────────────────────────────────────────
 * Rename folder
 * ──────────────────────────────────────────────────────────────────── */

export async function renameFolder(folderId: string, name: string): Promise<void> {
  await prisma.folder.update({
    where: { id: folderId },
    data: { name: name.trim() },
  });
}

/* ────────────────────────────────────────────────────────────────────
 * Delete folder (assets get folderId = null via SetNull)
 * ──────────────────────────────────────────────────────────────────── */

export async function deleteFolder(folderId: string): Promise<void> {
  await prisma.folder.delete({ where: { id: folderId } });
}

/* ────────────────────────────────────────────────────────────────────
 * Add files to folder
 * ──────────────────────────────────────────────────────────────────── */

export interface FileToAdd {
  shopifyFileGid: string;
  originalFilename: string;
  url: string;
  kind: string;
}

export async function addFilesToFolder(
  shopId: string,
  folderId: string,
  files: FileToAdd[],
): Promise<number> {
  let created = 0;
  for (const file of files) {
    // Upsert by shopifyFileGid within the same folder to avoid duplicates
    const existing = await prisma.asset.findFirst({
      where: { shopId, shopifyFileGid: file.shopifyFileGid, folderId },
    });
    if (!existing) {
      await prisma.asset.create({
        data: {
          shopId,
          folderId,
          kind: file.kind,
          originalFilename: file.originalFilename,
          shopifyFileGid: file.shopifyFileGid,
          url: file.url,
          storageMode: "SHOPIFY_FILE",
        },
      });
      created++;
    }
  }
  return created;
}

/* ────────────────────────────────────────────────────────────────────
 * Remove files from folder (deletes Asset records)
 * ──────────────────────────────────────────────────────────────────── */

export async function removeFilesFromFolder(assetIds: string[]): Promise<number> {
  const result = await prisma.asset.deleteMany({
    where: { id: { in: assetIds } },
  });
  return result.count;
}
