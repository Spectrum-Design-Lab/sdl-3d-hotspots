import prisma from "../db.server";

export type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function isThrottled(errors: Array<{ message?: string; extensions?: { code?: string } }>): boolean {
  return errors.some(
    (e) =>
      e.extensions?.code === "THROTTLED" ||
      /throttl/i.test(e.message ?? ""),
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function adminGraphql<T>(
  admin: AdminGraphqlClient,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await admin.graphql(`#graphql\n${query}`, { variables });
    const json = await response.json();

    if (json.errors?.length) {
      if (isThrottled(json.errors) && attempt < MAX_RETRIES) {
        const wait = BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(`[sdl3d] Shopify API throttled, retrying in ${wait}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await delay(wait);
        continue;
      }
      lastError = new Error(JSON.stringify(json.errors, null, 2));
      throw lastError;
    }

    return json.data as T;
  }

  throw lastError ?? new Error("adminGraphql: max retries exceeded");
}

export async function ensureShop(shopDomain: string) {
  return prisma.shop.upsert({
    where: { shopDomain },
    update: {},
    create: { shopDomain },
  });
}
