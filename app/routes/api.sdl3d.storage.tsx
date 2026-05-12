/**
 * API route for ShopStorage operations:
 *   saveCredentials  — encrypt + upsert bucket credentials for the shop
 *   testConnection   — load creds, run headBucket, update testedAt on success
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import shopify from "../shopify.server";
import prisma from "../db.server";
import { ensureShop } from "../lib/sdl3d-graphql.server";
import { encrypt } from "../lib/storage-encryption.server";
import {
  buildBackend,
  loadStorageForShop,
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
  const { session } = await shopify.authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "saveCredentials") {
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

    const shop = await ensureShop(session.shop);
    const existing = await prisma.shopStorage.findUnique({ where: { shopId: shop.id } });

    if (!existing && (!accessKey || !secretKey)) {
      return json(
        { ok: false, message: "Access key and secret key are required when saving for the first time." },
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

    if (existing) {
      await prisma.shopStorage.update({
        where: { shopId: shop.id },
        data: {
          provider,
          endpoint,
          region,
          bucket,
          publicBaseUrl,
          testedAt: null,
          ...(accessKeyEncrypted ? { accessKeyEncrypted } : {}),
          ...(secretKeyEncrypted ? { secretKeyEncrypted } : {}),
        },
      });
    } else {
      await prisma.shopStorage.create({
        data: {
          shopId: shop.id,
          provider,
          endpoint,
          region,
          bucket,
          publicBaseUrl,
          accessKeyEncrypted: accessKeyEncrypted!,
          secretKeyEncrypted: secretKeyEncrypted!,
        },
      });
    }

    return json({ ok: true });
  }

  if (intent === "testConnection") {
    const shop = await ensureShop(session.shop);

    let backend = await loadStorageForShop(shop.id);

    // If form contains in-progress edits, prefer those (test before save).
    const provider = String(formData.get("provider") || "") as StorageProvider;
    if (provider) {
      const endpoint = String(formData.get("endpoint") || "").trim();
      const region = String(formData.get("region") || "").trim();
      const bucket = String(formData.get("bucket") || "").trim();
      const accessKey = String(formData.get("accessKey") || "");
      const secretKey = String(formData.get("secretKey") || "");
      const publicBaseUrl = String(formData.get("publicBaseUrl") || "").trim() || null;

      if (!VALID_PROVIDERS.has(provider) || provider === "SHOPIFY_FILES") {
        return json({ ok: false, message: "Pick an S3-compatible provider to test." }, 400);
      }
      if (endpoint && bucket && accessKey && secretKey) {
        backend = buildBackend({ provider, endpoint, region, bucket, accessKey, secretKey, publicBaseUrl });
      }
    }

    if (!backend) {
      return json({ ok: false, message: "No credentials saved yet. Fill the form and click Save first." }, 400);
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

    await prisma.shopStorage
      .update({ where: { shopId: shop.id }, data: { testedAt: new Date() } })
      .catch(() => undefined);

    return json({ ok: true });
  }

  return json({ ok: false, message: "Unknown storage intent." }, 400);
}
