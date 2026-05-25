-- Slice 9 PR #1 — pre-flight validation surfacing.
-- Stores a serialized `ValidationReport` (shape from
-- @spectrum-design-lab/shared) produced by the orchestrator before
-- convert/upload. Null for older captures and for runs where the input
-- was perfect (no issues at all). When set, the uploader UI renders the
-- issues alongside the success / failure banner so the merchant sees
-- exactly which filenames were skipped or which indices were duplicated.
ALTER TABLE "Capture" ADD COLUMN "validationJson" TEXT;
