/**
 * API route for the custom-icon library.
 *
 *   GET                           — list all uploaded icons for this shop
 *   POST  intent=upload           — multipart upload, writes to merchant
 *                                   bucket under `<shopId>/icons/...`
 *   POST  intent=delete           — delete bucket object + Asset row
 *
 * Icons live in the merchant's connected CDN bucket (DigitalOcean Spaces /
 * S3 / R2 / Bunny) — same place as processed capture frames. The shopId
 * prefix prevents collisions with anything else the merchant might be
 * storing in the same bucket. Uploads require a default ShopStorage row;
 * if none exists we return 412 so the picker can prompt the merchant to
 * configure storage first.
 *
 * The on-Shopify-Files icon path (kind=ICON via Shopify staged uploads)
 * remains supported via the existing `pickFromShopifyFiles` callback in
 * the picker — this route only handles the merchant-CDN library.
 *
 * Auth: same dual-auth as the rest of /api/sdl3d/* — embedded admin
 * session or CLI_ADMIN_TOKEN bearer.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { withAdminAuth } from "../lib/admin-auth.server";
import { iconLibraryKey } from "../lib/captures-shared";
import { loadDefaultStorageForShop } from "../lib/storage.server";

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ALLOWED_MIME_TYPES = new Set([
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

// 1 MB cap — icons should be tiny SVGs or small rasters. Anything bigger
// hints at the merchant uploading a full product image by mistake.
const MAX_ICON_BYTES = 1 * 1024 * 1024;

// Slugify into a filesystem/url-safe filename. Preserves the extension
// so Content-Type sniffing on the storefront works.
function safeFilenameFromUpload(name: string): string {
  const lastDot = name.lastIndexOf(".");
  const base = lastDot > 0 ? name.slice(0, lastDot) : name;
  const ext = lastDot > 0 ? name.slice(lastDot + 1) : "";
  const slugBase = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "icon";
  const slugExt = ext.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 8) || "bin";
  return `${slugBase}.${slugExt}`;
}

function iconToWire(row: {
  id: string;
  originalFilename: string;
  url: string;
  mimeType: string | null;
  sizeBytes: bigint | null;
  bucketKey: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    originalFilename: row.originalFilename,
    url: row.url,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes !== null ? Number(row.sizeBytes) : null,
    bucketKey: row.bucketKey,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  return withAdminAuth(request, async (auth) => {
    const rows = await prisma.asset.findMany({
      where: {
        shopId: auth.shop.id,
        kind: "ICON",
        storageMode: "MERCHANT_BUCKET",
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        originalFilename: true,
        url: true,
        mimeType: true,
        sizeBytes: true,
        bucketKey: true,
        createdAt: true,
      },
    });
    return json({ icons: rows.map(iconToWire) });
  });
}

export async function action({ request }: ActionFunctionArgs) {
  return withAdminAuth(request, async (auth) => {
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.startsWith("multipart/form-data")) {
      const form = await request.formData();
      const intent = String(form.get("intent") ?? "upload");

      if (intent === "upload") {
        const file = form.get("file");
        if (!(file instanceof File)) {
          return json({ error: "file is required" }, 400);
        }
        if (file.size === 0) {
          return json({ error: "file is empty" }, 400);
        }
        if (file.size > MAX_ICON_BYTES) {
          return json(
            {
              error: `file too large — icons capped at ${Math.round(MAX_ICON_BYTES / 1024)} KB (got ${Math.round(file.size / 1024)} KB)`,
            },
            413,
          );
        }
        const mime = file.type || "application/octet-stream";
        if (!ALLOWED_MIME_TYPES.has(mime)) {
          return json(
            { error: `unsupported icon type "${mime}" — accept SVG / PNG / JPEG / WebP / GIF` },
            415,
          );
        }

        const storage = await loadDefaultStorageForShop(auth.shop.id);
        if (!storage) {
          return json(
            {
              error:
                "No default storage configured — connect a bucket under Settings → Storage before uploading icons.",
            },
            412,
          );
        }
        if (!storage.publicBaseUrl) {
          return json(
            {
              error:
                "Default storage has no Public Base URL configured — set one so the storefront can fetch icons.",
            },
            412,
          );
        }

        // Create the Asset row first so we have an id for the key. If
        // the bucket PUT fails we delete the row to keep the library
        // consistent.
        const filename = safeFilenameFromUpload(file.name);
        const placeholder = await prisma.asset.create({
          data: {
            shopId: auth.shop.id,
            kind: "ICON",
            storageMode: "MERCHANT_BUCKET",
            originalFilename: file.name,
            // url is required on the schema; rewrite after successful PUT.
            url: "",
            mimeType: mime,
            sizeBytes: BigInt(file.size),
          },
        });
        const key = iconLibraryKey(auth.shop.id, placeholder.id, filename);
        const publicBase = storage.publicBaseUrl.replace(/\/$/, "");
        const publicUrl = `${publicBase}/${key}`;

        try {
          const buf = Buffer.from(await file.arrayBuffer());
          await storage.putObject(key, buf, {
            contentType: mime,
            acl: "public-read",
            // Icons are content-addressed by asset-id-prefixed key, so
            // overwrites never happen — long immutable cache is safe.
            cacheControl: "public, max-age=31536000, immutable",
          });
        } catch (err) {
          await prisma.asset.delete({ where: { id: placeholder.id } });
          const message = err instanceof Error ? err.message : String(err);
          return json({ error: `bucket upload failed: ${message}` }, 502);
        }

        const updated = await prisma.asset.update({
          where: { id: placeholder.id },
          data: { url: publicUrl, bucketKey: key },
          select: {
            id: true,
            originalFilename: true,
            url: true,
            mimeType: true,
            sizeBytes: true,
            bucketKey: true,
            createdAt: true,
          },
        });
        return json({ icon: iconToWire(updated) });
      }

      return json({ error: `unknown intent "${intent}"` }, 400);
    }

    // JSON-bodied delete.
    const body = (await request.json().catch(() => ({}))) as {
      intent?: string;
      id?: string;
    };
    if (body.intent === "delete") {
      const id = body.id;
      if (!id) return json({ error: "id is required" }, 400);
      const row = await prisma.asset.findFirst({
        where: { id, shopId: auth.shop.id, kind: "ICON" },
        select: { id: true, bucketKey: true },
      });
      if (!row) return json({ error: "icon not found" }, 404);

      if (row.bucketKey) {
        const storage = await loadDefaultStorageForShop(auth.shop.id);
        if (storage) {
          // Best-effort bucket delete. If it fails (key already gone,
          // bucket flipped) we still drop the DB row — leaving an
          // orphaned DB row is worse than an orphaned bucket object.
          try {
            await storage.deleteObject(row.bucketKey);
          } catch (err) {
            console.warn(
              `[icons] best-effort delete failed for ${row.bucketKey}:`,
              err instanceof Error ? err.message : err,
            );
          }
        }
      }
      await prisma.asset.delete({ where: { id: row.id } });
      return json({ ok: true });
    }

    return json({ error: "unknown request" }, 400);
  });
}
