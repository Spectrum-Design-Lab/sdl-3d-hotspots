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
// Every error our admin-auth helper throws is prefixed with this so it can't
// be confused with Shopify-library errors (which have wording like
// "Invalid Bearer tokens" that's easy to mistake for ours). If you see a 401
// from /api/sdl3d/* without this prefix in the body, the failure is from
// Shopify's session-auth path — not our CLI bearer logic.
const ADMIN_AUTH_PREFIX = "[sdl3d-admin-auth]";

export async function authenticateAdminApi(request: Request): Promise<AuthenticatedAdmin> {
  const bearer = extractBearerToken(request);
  const adminToken = process.env.CLI_ADMIN_TOKEN?.trim() ?? "";

  // Try CLI auth ONLY when the bearer length matches the configured CLI token.
  // Embedded admin requests carry a Shopify session JWT in the Authorization
  // header (App Bridge attaches it automatically); those JWTs are hundreds of
  // characters long and will never match a 64-char CLI_ADMIN_TOKEN. If the
  // bearer isn't a CLI-token match we silently fall through to Shopify's own
  // session-token validator — that's the right behavior for App Bridge calls,
  // and it also means a malformed/expired session JWT gets a Shopify-shaped
  // error rather than a misleading CLI-shaped one.
  const looksLikeCliToken =
    bearer != null &&
    adminToken.length > 0 &&
    bearer.length === adminToken.length &&
    constantTimeEquals(bearer, adminToken);

  if (looksLikeCliToken) {
    const url = new URL(request.url);
    const shopDomain = extractCliShopDomain(request, url.searchParams.get("shop"));
    if (!shopDomain) {
      throw new AdminAuthError(
        400,
        `${ADMIN_AUTH_PREFIX} CLI bearer accepted, but no target shop provided. Send X-Shop-Domain: <shop>.myshopify.com header or ?shop= query param.`,
      );
    }

    const sessionRow = await prisma.session.findFirst({
      where: { shop: shopDomain, isOnline: false },
      orderBy: { id: "desc" },
    });
    if (!sessionRow) {
      throw new AdminAuthError(
        404,
        `${ADMIN_AUTH_PREFIX} CLI bearer accepted, but no offline Shopify session row exists for shop "${shopDomain}". The merchant must complete OAuth (install the app) at least once before CLI access works.`,
      );
    }

    const { admin } = await shopify.unauthenticated.admin(shopDomain);
    const shop = await ensureShop(shopDomain);
    console.log(`${ADMIN_AUTH_PREFIX} CLI auth ok for shop=${shopDomain}`);
    return {
      admin,
      session: { shop: shopDomain },
      shop: { id: shop.id, shopDomain: shop.shopDomain },
      authKind: "cli",
    };
  }

  // Fall back to normal embedded admin session auth. This is the path the
  // browser takes on every fetcher.submit — App Bridge handles the JWT.
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
