-- Slice 9 PR #3 — job lifecycle ops.
--
-- attempts: bumped by the orchestrator each time it claims the row, so
--   the merchant can see "attempt 2 of 3" in the dashboard without
--   reaching into pg-boss state.
-- cancelledAt: merchant-initiated cancellation. Set non-null by the
--   cancel API; the orchestrator re-reads the row between heavy pipeline
--   steps and bails out if this is populated. Distinct from
--   completedAt because the capture never reached SUCCESS.
ALTER TABLE "Capture" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Capture" ADD COLUMN "cancelledAt" TIMESTAMP(3);
