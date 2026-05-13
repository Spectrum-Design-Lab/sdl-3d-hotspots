/**
 * API route for ShopStorage operations (Slice 5B: per-row CRUD):
 *   saveCredentials  — create or update one row (keyed by storageId on update,
 *                      by (shop, provider) on create). First row for a shop
 *                      is forced isDefault = true.
 *   testConnection   — head-bucket a saved row (storageId) or an in-progress
 *                      edit (raw form values).
 *   setDefault       — flip one row to isDefault = true, all others for the
 *                      same shop to false, in a single transaction.
 *   deleteStorage    — delete one row by storageId. If it was the default
 *                      and other rows remain, the most-recently-updated
 *                      remaining row is promoted to default.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { withAdminAuth } from "../lib/admin-auth.server";
import prisma from "../db.server";
import { encrypt } from "../lib/storage-encryption.server";
import {
  buildBackend,
  loadStorageForShopById,
  STORAGE_PROVIDERS,
  type StorageProvider,
} from "../lib/storage.server";

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function loader(_args: LoaderFunctionArgs) {
  return new Response("Method not allowed", { status: 405 });
}

const VALID_PROVIDERS: ReadonlySet<StorageProvider> = new Set(
  STORAGE_PROVIDERS.map((p) => p.value),
);

export async function action({ request }: ActionFunctionArgs) {
  return withAdminAuth(request, async ({ shop }) => {
    const formData = await request.formData();
    const intent = String(formData.get("intent") || "");

    if (intent === "saveCredentials") {
      const storageId = String(formData.get("storageId") || "").trim() || null;
      const provider = String(formData.get("provider") || "") as StorageProvider;
      const endpoint = String(formData.get("endpoint") || "").trim();
      const region = String(formData.get("region") || "").trim();
      const bucket = String(formData.get("bucket") || "").trim();
      const accessKey = String(formData.get("accessKey") || "");
      const secretKey = String(formData.get("secretKey") || "");
      const publicBaseUrlRaw = String(formData.get("publicBaseUrl") || "").trim();
      const publicBaseUrl = publicBaseUrlRaw || null;

      if (!VALID_PROVIDERS.has(provider)) {
        return json({ ok: false, message: "Invalid provider." }, 400);
      }
      if (provider === "SHOPIFY_FILES") {
        return json(
          { ok: false, message: "Shopify Files backend is coming soon — pick S3-compatible storage for now." },
          400,
        );
      }
      if (!endpoint || !bucket) {
        return json({ ok: false, message: "Endpoint and bucket are required." }, 400);
      }

      // Update path: keyed by storageId, scoped to this shop.
      if (storageId) {
        const existing = await prisma.shopStorage.findFirst({
          where: { id: storageId, shopId: shop.id },
        });
        if (!existing) {
          return json({ ok: false, message: "Storage row not found." }, 404);
        }

        // Provider changes aren't allowed on edit (would conflict with composite
        // uniqueness and confuse the row's identity). UI hides provider on Edit;
        // server enforces.
        if (provider !== (existing.provider as StorageProvider)) {
          return json(
            { ok: false, message: "Provider can't change on edit — delete and re-add to change provider." },
            400,
          );
        }

        let accessKeyEncrypted: Uint8Array<ArrayBuffer> | undefined;
        let secretKeyEncrypted: Uint8Array<ArrayBuffer> | undefined;
        try {
          if (accessKey) accessKeyEncrypted = encrypt(accessKey);
          if (secretKey) secretKeyEncrypted = encrypt(secretKey);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown encryption error.";
          return json({ ok: false, message: `Cannot encrypt credentials: ${message}` }, 500);
        }

        await prisma.shopStorage.update({
          where: { id: storageId },
          data: {
            endpoint,
            region,
            bucket,
            publicBaseUrl,
            testedAt: null,
            ...(accessKeyEncrypted ? { accessKeyEncrypted } : {}),
            ...(secretKeyEncrypted ? { secretKeyEncrypted } : {}),
          },
        });

        return json({ ok: true, storageId });
      }

      // Create path: keyed by (shop, provider).
      if (!accessKey || !secretKey) {
        return json(
          { ok: false, message: "Access key and secret key are required when adding a provider." },
          400,
        );
      }

      const duplicate = await prisma.shopStorage.findUnique({
        where: { shopId_provider: { shopId: shop.id, provider } },
      });
      if (duplicate) {
        return json(
          { ok: false, message: "You already have a row for this provider — edit it instead of adding a new one." },
          400,
        );
      }

      let accessKeyEncrypted: Uint8Array<ArrayBuffer>;
      let secretKeyEncrypted: Uint8Array<ArrayBuffer>;
      try {
        accessKeyEncrypted = encrypt(accessKey);
        secretKeyEncrypted = encrypt(secretKey);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown encryption error.";
        return json({ ok: false, message: `Cannot encrypt credentials: ${message}` }, 500);
      }

      // First row for this shop is forced default so captures continue to work
      // without an extra UI step.
      const existingCount = await prisma.shopStorage.count({ where: { shopId: shop.id } });
      const isDefault = existingCount === 0;

      const created = await prisma.shopStorage.create({
        data: {
          shopId: shop.id,
          provider,
          endpoint,
          region,
          bucket,
          publicBaseUrl,
          accessKeyEncrypted,
          secretKeyEncrypted,
          isDefault,
        },
      });

      return json({ ok: true, storageId: created.id, isDefault });
    }

    if (intent === "testConnection") {
      const storageId = String(formData.get("storageId") || "").trim() || null;
      const provider = String(formData.get("provider") || "") as StorageProvider;
      const endpoint = String(formData.get("endpoint") || "").trim();
      const region = String(formData.get("region") || "").trim();
      const bucket = String(formData.get("bucket") || "").trim();
      const accessKey = String(formData.get("accessKey") || "");
      const secretKey = String(formData.get("secretKey") || "");
      const publicBaseUrl = String(formData.get("publicBaseUrl") || "").trim() || null;

      // Prefer the saved row if the user supplied a storageId and didn't
      // re-enter keys (edit-in-place flow with the masked key fields).
      const useSavedRow =
        storageId && (!accessKey || !secretKey);

      let backend: Awaited<ReturnType<typeof loadStorageForShopById>> = null;

      if (useSavedRow && storageId) {
        backend = await loadStorageForShopById(shop.id, storageId);
        if (!backend) {
          return json({ ok: false, message: "Storage row not found." }, 404);
        }
      } else {
        // In-progress form values (test before save, or test after re-typing keys).
        if (!VALID_PROVIDERS.has(provider) || provider === "SHOPIFY_FILES") {
          return json({ ok: false, message: "Pick an S3-compatible provider to test." }, 400);
        }
        if (!endpoint || !bucket || !accessKey || !secretKey) {
          return json(
            { ok: false, message: "Fill endpoint, bucket, access key, and secret key to test." },
            400,
          );
        }
        backend = buildBackend({
          provider,
          endpoint,
          region,
          bucket,
          accessKey,
          secretKey,
          publicBaseUrl,
        });
      }

      try {
        await backend.headBucket();
      } catch (err) {
        const awsName = (err as { name?: string } | null)?.name;
        const awsCode = (err as { Code?: string; code?: string } | null)?.Code
          ?? (err as { Code?: string; code?: string } | null)?.code;
        const httpStatus = (err as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
        const message = err instanceof Error ? err.message : "Connection failed.";
        console.error("[sdl3d/storage] testConnection failed", {
          shopId: shop.id,
          provider: backend.provider,
          bucket: backend.bucket,
          awsName,
          awsCode,
          httpStatus,
          message,
        });
        const display = awsCode ? `${awsCode}: ${message}` : message;
        return json({ ok: false, message: display }, 200);
      }

      if (storageId) {
        await prisma.shopStorage
          .update({ where: { id: storageId }, data: { testedAt: new Date() } })
          .catch(() => undefined);
      }

      return json({ ok: true });
    }

    if (intent === "setDefault") {
      const storageId = String(formData.get("storageId") || "").trim();
      if (!storageId) {
        return json({ ok: false, message: "Missing storageId." }, 400);
      }
      const row = await prisma.shopStorage.findFirst({
        where: { id: storageId, shopId: shop.id },
      });
      if (!row) {
        return json({ ok: false, message: "Storage row not found." }, 404);
      }
      if (row.isDefault) {
        return json({ ok: true, storageId, alreadyDefault: true });
      }
      await prisma.$transaction([
        prisma.shopStorage.updateMany({
          where: { shopId: shop.id, isDefault: true, id: { not: storageId } },
          data: { isDefault: false },
        }),
        prisma.shopStorage.update({
          where: { id: storageId },
          data: { isDefault: true },
        }),
      ]);
      return json({ ok: true, storageId });
    }

    if (intent === "deleteStorage") {
      const storageId = String(formData.get("storageId") || "").trim();
      if (!storageId) {
        return json({ ok: false, message: "Missing storageId." }, 400);
      }
      const row = await prisma.shopStorage.findFirst({
        where: { id: storageId, shopId: shop.id },
      });
      if (!row) {
        return json({ ok: false, message: "Storage row not found." }, 404);
      }

      // If the deleted row was the default and others remain, promote the
      // most-recently-updated remaining row.
      const replacement = row.isDefault
        ? await prisma.shopStorage.findFirst({
            where: { shopId: shop.id, id: { not: storageId } },
            orderBy: { updatedAt: "desc" },
          })
        : null;

      await prisma.$transaction([
        prisma.shopStorage.delete({ where: { id: storageId } }),
        ...(replacement
          ? [
              prisma.shopStorage.update({
                where: { id: replacement.id },
                data: { isDefault: true },
              }),
            ]
          : []),
      ]);

      return json({ ok: true, storageId, promotedStorageId: replacement?.id ?? null });
    }

    return json({ ok: false, message: "Unknown storage intent." }, 400);
  });
}
