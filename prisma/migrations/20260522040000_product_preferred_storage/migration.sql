-- Slice 8 dashboard polish — per-product storage preference.
-- Nullable: null means "use the shop's default storage". The capture
-- API consults this column before falling back to ShopStorage.isDefault.
-- ON DELETE SET NULL on the FK: removing a storage row should not
-- cascade-delete the product config; it just falls back to the default.
ALTER TABLE "ProductConfig" ADD COLUMN "preferredStorageId" TEXT;

ALTER TABLE "ProductConfig"
  ADD CONSTRAINT "ProductConfig_preferredStorageId_fkey"
  FOREIGN KEY ("preferredStorageId") REFERENCES "ShopStorage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ProductConfig_preferredStorageId_idx" ON "ProductConfig"("preferredStorageId");
