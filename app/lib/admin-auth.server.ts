/**
 * Dual-auth for `/api/sdl3d/*` routes.
 *
 *   Browser flow:   normal Shopify embedded admin session
 *   Script flow:    Authorization: Bearer <CLI_ADMIN_TOKEN>  +  X-Shop-Domain header
 *
 * `CLI_ADMIN_TOKEN` is one shared secret per deployment, set in the env. The
 * pilot client's IT team rotates it whenever they want; SDL doesn't track it.
 * Bearer-authenticated callers must always identify a shop because the API
 * surface is per-shop (the env token has no shop affinity of its own).
 *
 * Always returns the same `{ admin, session, shop }` shape so callers stay
 * single-path regardless of which credential type the caller used.
 */
import { timingSafeEqual } from "node:crypto";
import shopify from "../shopify.server";
import prisma from "../db.server";
import { ensureShop, type AdminGraphqlClient } from "./sdl3d-graphql.server";

export type AuthenticatedAdmin = {
  admin: AdminGraphqlClient;
  session: { shop: string };
  shop: { id: string; shopDomain: string };
  authKind: "session" | "cli";
};

class AdminAuthError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AdminAuthError";
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function extractCliShopDomain(request: Request, urlShopParam: string | null): string | null {
  const headerShop = request.headers.get("x-shop-domain") ?? request.headers.get("X-Shop-Domain");
  return (headerShop ?? urlShopParam ?? "").trim() || null;
}

/**
 * Verify and resolve admin context for a request. Accepts either:
 *   1. A Shopify embedded session (normal browser flow), or
 *   2. `Authorization: Bearer <CLI_ADMIN_TOKEN>` plus a shop identifier in
 *      `X-Shop-Domain` header or `?shop=` query string.
 *
 * For (2) we look up the offline Session row keyed by shop and construct an
 * unauthenticated admin client. Throws an `AdminAuthError` with an HTTP status
 * if the request can't be authenticated — callers convert that to a JSON
 * response (see {@link runAuthenticatedAdminAction}).
 */
export async function authenticateAdminApi(request: Request): Promise<AuthenticatedAdmin> {
  const bearer = extractBearerToken(request);
  const adminToken = process.env.CLI_ADMIN_TOKEN?.trim() ?? "";

  if (bearer && adminToken && constantTimeEquals(bearer, adminToken)) {
    // CLI flow — caller must tell us which shop to act as.
    const url = new URL(request.url);
    const shopDomain = extractCliShopDomain(request, url.searchParams.get("shop"));
    if (!shopDomain) {
      throw new AdminAuthError(
        400,
        "CLI auth: provide the target shop via X-Shop-Domain header or ?shop= query param.",
      );
    }

    const sessionRow = await prisma.session.findFirst({
      where: { shop: shopDomain, isOnline: false },
      orderBy: { id: "desc" },
    });
    if (!sessionRow) {
      throw new AdminAuthError(
        404,
        `CLI auth: no offline session stored for shop "${shopDomain}". The merchant must install the app first.`,
      );
    }

    const { admin } = await shopify.unauthenticated.admin(shopDomain);
    const shop = await ensureShop(shopDomain);
    return {
      admin,
      session: { shop: shopDomain },
      shop: { id: shop.id, shopDomain: shop.shopDomain },
      authKind: "cli",
    };
  }

  if (bearer && !adminToken) {
    throw new AdminAuthError(
      401,
      "CLI auth attempted but CLI_ADMIN_TOKEN is not configured on this deployment.",
    );
  }

  if (bearer && adminToken && !constantTimeEquals(bearer, adminToken)) {
    throw new AdminAuthError(401, "Invalid bearer token.");
  }

  // Fall back to a normal embedded admin session.
  const { admin, session } = await shopify.authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  return {
    admin,
    session: { shop: session.shop },
    shop: { id: shop.id, shopDomain: shop.shopDomain },
    authKind: "session",
  };
}

/** Helper for routes that want a 1-liner: authenticate or return 401/400 JSON. */
export async function withAdminAuth<T>(
  request: Request,
  handler: (auth: AuthenticatedAdmin) => Promise<T>,
): Promise<T | Response> {
  try {
    const auth = await authenticateAdminApi(request);
    return await handler(auth);
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return new Response(JSON.stringify({ ok: false, message: err.message }), {
        status: err.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw err;
  }
}

export { AdminAuthError };
