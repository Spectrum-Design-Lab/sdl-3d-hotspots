import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  coerceViewerSettings,
  dbHotspotToPublished,
  defaultViewerSettings,
  safeJsonParse,
} from "../lib/sdl3d-serialization.server";
import { resolveSelectedAssetUrls } from "../lib/sdl3d-files.server";

/**
 * App proxy endpoint: returns published 3D viewer config for a product.
 *
 * Storefront URL: /apps/sdl3d/config?product_handle=my-product
 * Proxied to:     /proxy/sdl3d/config?product_handle=my-product&shop=...&signature=...
 *
 * Query params (added by Shopify):
 *   - shop: the myshopify.com domain
 *   - signature: HMAC for verification
 *   - logged_in_customer_id: (optional)
 *
 * Query params (from theme extension JS):
 *   - product_id: Shopify product GID (e.g., gid://shopify/Product/123)
 *   - product_handle: product handle (alternative lookup)
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.public.appProxy(request);

  if (!session || !admin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const shopDomain = session.shop;
  const productId = url.searchParams.get("product_id");
  const productHandle = url.searchParams.get("product_handle");

  if (!productId && !productHandle) {
    return Response.json(
      { error: "Missing product_id or product_handle parameter" },
      { status: 400 },
    );
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  if (!shop) {
    return Response.json({ error: "Shop not found" }, { status: 404 });
  }

  // Resolve product GID from handle if needed
  let productGid = productId;
  if (!productGid && productHandle) {
    const data = await adminGraphqlProxy<{
      productByIdentifier: { id: string } | null;
    }>(admin, `
      query GetProductByHandle($handle: String!) {
        productByIdentifier(identifier: { handle: $handle }) {
          id
        }
      }
    `, { handle: productHandle });

    productGid = data.productByIdentifier?.id || null;
    if (!productGid) {
      return Response.json({ error: "Product not found" }, { status: 404 });
    }
  }

  // Find the published config
  const config = await prisma.productConfig.findUnique({
    where: {
      shopId_shopifyProductGid: {
        shopId: shop.id,
        shopifyProductGid: productGid!,
      },
    },
    include: {
      hotspots: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!config) {
    return Response.json({ error: "No config found for this product" }, { status: 404 });
  }

  if (!config.enabled) {
    return Response.json({ error: "Viewer is not enabled for this product" }, { status: 404 });
  }

  const viewerSettings = coerceViewerSettings(
    safeJsonParse(config.viewerSettingsJson, defaultViewerSettings),
  );
  const viewerType = config.viewerType || "MODEL_3D";

  // Resolve file URLs from Shopify
  const { modelSourceUrl, posterUrl } = await resolveSelectedAssetUrls({
    admin: admin as any,
    modelFileGid: config.modelFileShopifyGid,
    posterFileGid: config.posterFileShopifyGid,
  });

  // Resolve fallback image: shop logo for loading poster, product image for error fallback
  const logoUrl = shop.logoUrl || null;
  let fallbackImageUrl: string | null = null;
  try {
    const prodData = await adminGraphqlProxy<{
      product: { featuredMedia: { preview?: { image?: { url: string } } } | null } | null;
    }>(admin, `
      query GetProductImage($id: ID!) {
        product(id: $id) {
          featuredMedia { preview { image { url } } }
        }
      }
    `, { id: productGid! });
    fallbackImageUrl = prodData.product?.featuredMedia?.preview?.image?.url ?? null;
  } catch { /* non-critical */ }

  // Build response based on viewer type
  if (viewerType === "IMAGE_360") {
    const imageSequence = safeJsonParse<unknown[]>(config.imageSequenceJson, []);
    const hotspots360 = safeJsonParse<unknown[]>(config.hotspotsJson360, []);

    return Response.json({
      enabled: true,
      viewerType: "image_360",
      posterUrl: posterUrl || logoUrl || fallbackImageUrl,
      fallbackImageUrl,
      viewerSettings,
      imageSequence,
      hotspots360,
      storefrontVersion: config.storefrontVersion,
    });
  }

  // MODEL_3D
  const hotspots = config.hotspots.map(dbHotspotToPublished);

  return Response.json({
    enabled: true,
    viewerType: "model_3d",
    modelSourceUrl,
    posterUrl: posterUrl || logoUrl || fallbackImageUrl,
    fallbackImageUrl,
    viewerSettings,
    hotspots,
    storefrontVersion: config.storefrontVersion,
  });
}

/** Thin GraphQL helper for the app proxy admin client */
async function adminGraphqlProxy<T>(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const response = await admin.graphql(`#graphql\n${query}`, { variables });
  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(JSON.stringify(json.errors, null, 2));
  }
  return json.data as T;
}
