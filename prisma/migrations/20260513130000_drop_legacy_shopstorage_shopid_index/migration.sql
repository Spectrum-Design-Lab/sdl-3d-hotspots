-- Slice 5B follow-up: the prior single-row uniqueness on ShopStorage was a
-- UNIQUE INDEX (created by 20260512120000_add_shop_storage:
--   CREATE UNIQUE INDEX "ShopStorage_shopId_key" ON "ShopStorage"("shopId");
-- ), not a CONSTRAINT. The 5B migration's
--   ALTER TABLE "ShopStorage" DROP CONSTRAINT IF EXISTS "ShopStorage_shopId_key";
-- was therefore a no-op, leaving Postgres still enforcing "one row per shopId".
-- Attempting to add a second provider failed with P2002 on `shopId`.
--
-- Drop the lingering index here. `IF EXISTS` keeps it idempotent for any
-- fresh installs that may have applied the broken 5B migration before this
-- one — and for the rare case where someone has already cleaned it up by
-- hand.

DROP INDEX IF EXISTS "ShopStorage_shopId_key";
