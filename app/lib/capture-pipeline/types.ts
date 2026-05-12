import type { PrismaClient } from "@prisma/client";
import type { StorageBackend } from "../storage.server";
import type { AdminGraphqlClient } from "../sdl3d-graphql.server";

/**
 * Threaded through every capture-pipeline function. Worker builds this once
 * per job from the Capture row's shopId and hands it to the orchestrator.
 *
 * - `shopId` keys all bucket paths and DB rows.
 * - `storage` is the merchant's `ShopStorage`-backed `StorageBackend`.
 * - `shopify` is an admin GraphQL client scoped to the same shop.
 * - `prisma` is the shared singleton (kept on the ctx so test code can swap it).
 */
export type ProcessingContext = {
  shopId: string;
  storage: StorageBackend;
  shopify: AdminGraphqlClient;
  prisma: PrismaClient;
};
