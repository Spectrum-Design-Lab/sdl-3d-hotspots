-- Slice 8 hotspots PR #5 — typed media slots.
--
-- Two nullable columns for the hotspot popup's image + video. Both
-- store either a Shopify file GID, an absolute URL, or NULL. 360
-- hotspots carry the same shape via the JSON blob (no column add
-- there — Hotspot360 type extension in app/lib/sdl3d-shared.ts is
-- the source of truth).
ALTER TABLE "Hotspot" ADD COLUMN "mediaImageUrl" TEXT;
ALTER TABLE "Hotspot" ADD COLUMN "mediaVideoUrl" TEXT;
