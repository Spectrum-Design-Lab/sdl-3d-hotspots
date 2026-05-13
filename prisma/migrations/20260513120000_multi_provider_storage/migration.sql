-- Slice 5B: one ShopStorage row per (shop, provider), with isDefault flag.
-- Existing single-row deployments backfill cleanly: the existing row becomes
-- that shop's default, the shopId-only uniqueness is replaced with a composite
-- (shopId, provider) uniqueness, and a new (shopId, isDefault) index supports
-- the default lookup path. Forward-compatible: pre-5B code that did
-- findUnique({ shopId }) still finds the (single) row on a migrated DB.

-- Drop the old single-row uniqueness constraint.
ALTER TABLE "ShopStorage" DROP CONSTRAINT IF EXISTS "ShopStorage_shopId_key";

-- isDefault flag; existing rows get TRUE so they keep working unchanged.
ALTER TABLE "ShopStorage"
  ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

UPDATE "ShopStorage" SET "isDefault" = true;

-- Composite uniqueness so a shop can hold one row per provider but not
-- two rows for the same provider.
CREATE UNIQUE INDEX "ShopStorage_shopId_provider_key"
  ON "ShopStorage"("shopId", "provider");

-- Plain shopId index (composite uniqueness above does NOT cover shopId-only
-- lookups efficiently on Postgres, since it's keyed on (shopId, provider)).
CREATE INDEX "ShopStorage_shopId_idx" ON "ShopStorage"("shopId");

-- Supports loadDefaultStorageForShop in one disk seek.
CREATE INDEX "ShopStorage_shopId_isDefault_idx"
  ON "ShopStorage"("shopId", "isDefault");

-- Capture.storageId — stamped at signRawUpload so the worker reads from the
-- bucket that was the default when the upload started, even if the merchant
-- flips the default mid-job. Nullable so pre-5B rows continue to work (worker
-- falls back to the shop's current default).
ALTER TABLE "Capture"
  ADD COLUMN "storageId" TEXT;

ALTER TABLE "Capture"
  ADD CONSTRAINT "Capture_storageId_fkey"
  FOREIGN KEY ("storageId") REFERENCES "ShopStorage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Capture_storageId_idx" ON "Capture"("storageId");
