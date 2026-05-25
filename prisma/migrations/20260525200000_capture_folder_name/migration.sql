-- Slice 9 polish — merchant-provided bucket folder name.
--
-- Optional slug used as the bucket folder for both raw.zip and the
-- processed frames. When null the API falls back to the cuid id, so old
-- captures keep working without backfill. Shop-scoped uniqueness is
-- enforced at the API layer in signRawUpload (Capture has no shopId
-- column to put a partial unique index on).
ALTER TABLE "Capture" ADD COLUMN "folderName" TEXT;
CREATE INDEX "Capture_folderName_idx" ON "Capture"("folderName");
