-- Slice 6 PR #2: distinguish capture-pipeline frames from bucket-folder-reuse frames.
-- Default "CAPTURE" so existing rows stay classified as pipeline-produced.
-- New value "BUCKET_FOLDER" is written by the listBucketFolders/useBucketFolder flow.
ALTER TABLE "ProductConfig"
  ADD COLUMN "imageSequenceSource" TEXT NOT NULL DEFAULT 'CAPTURE';
