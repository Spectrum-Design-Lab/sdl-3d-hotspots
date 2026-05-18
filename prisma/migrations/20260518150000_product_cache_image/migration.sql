-- Slice 5C PR #4 follow-up: cache product featuredImage so the dashboard
-- can render real thumbnails alongside titles. Both columns nullable —
-- products without a featured image (or that get resolved before the next
-- backfill) just render a generic placeholder.

ALTER TABLE "ProductCache" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "ProductCache" ADD COLUMN "imageAlt" TEXT;
