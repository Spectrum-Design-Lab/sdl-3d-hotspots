import prisma from "../../db.server";
import { loadStorageForShop } from "../storage.server";
import type { AdminGraphqlClient } from "../sdl3d-graphql.server";
import type { ProcessingContext } from "./types";

/** Job payload pushed onto pg-boss by API actions (Slice 3) or smoke tests. */
export type ProcessCaptureJobData = {
  shopId: string;
  captureId: string;
};

/**
 * Slice 3 will replace this stub with:
 *   1. Read Capture row + ShopStorage + a Shopify admin client for `shopId`.
 *   2. Idempotency check (bail if status is COMPLETED/FAILED).
 *   3. Download raw.zip via signed GET from `<shopId>/captures/<captureId>/raw.zip`.
 *   4. Unpack → scanner → sampler → converter (sharp) → uploader.
 *   5. Write resulting frame array into `ProductConfig.imageSequenceJson`.
 *   6. Mark Capture COMPLETED, or FAILED with errorMessage on throw.
 *
 * Slice 2 keeps the signature so the worker can be wired up and a stub job
 * round-trip is verifiable from the queue. The Capture Prisma model lands in
 * Slice 3.
 */
export async function processCapture(
  ctx: ProcessingContext,
  captureId: string,
): Promise<void> {
  console.log(
    `[capture-pipeline] processCapture stub — shopId=${ctx.shopId} captureId=${captureId}`,
  );
  // Intentional no-op until Slice 3. Throwing here would re-fail the job and
  // pg-boss would re-deliver indefinitely; just succeed silently for now.
}

/**
 * Stub admin client. Slice 3 replaces this with a real session-backed client
 * constructed via Shopify.unauthenticated.admin(shopDomain) on the worker.
 */
function stubShopifyClient(shopId: string): AdminGraphqlClient {
  return {
    graphql: async () => {
      throw new Error(
        `[capture-pipeline] Shopify admin client not wired for shopId=${shopId} (Slice 3).`,
      );
    },
  };
}

/**
 * Worker job entrypoint. Builds the `ProcessingContext` from the job payload
 * and delegates to `processCapture`. Separated so a future API action that
 * runs the pipeline inline (e.g. for tests) can call `processCapture` directly
 * with a pre-built context.
 */
export async function runProcessCaptureJob(
  data: ProcessCaptureJobData,
): Promise<void> {
  const storage = await loadStorageForShop(data.shopId);
  if (!storage) {
    throw new Error(
      `[capture-pipeline] No ShopStorage row for shopId=${data.shopId}; merchant has not configured a bucket.`,
    );
  }

  const ctx: ProcessingContext = {
    shopId: data.shopId,
    storage,
    shopify: stubShopifyClient(data.shopId),
    prisma,
  };

  await processCapture(ctx, data.captureId);
}
