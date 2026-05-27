-- Slice 9 follow-up — custom icon library on merchant CDN.
--
-- Adds a nullable bucketKey column to Asset so icons uploaded to the
-- merchant's storage bucket (storageMode="MERCHANT_BUCKET", kind="ICON")
-- can be deleted safely without parsing the public URL back into a key.
-- Existing rows (kind=MODEL_3D/IMAGE, storageMode=SHOPIFY_FILE) keep
-- bucketKey NULL since their lifecycle is owned by Shopify Files.

ALTER TABLE "Asset" ADD COLUMN "bucketKey" TEXT;
