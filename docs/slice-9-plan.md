# Slice 9 — Unified upload: merchant captures frames from the embedded admin

> **STATUS: RE-SCOPED 2026-05-25.** Original plan (below, preserved
> for context) assumed PR #1 (queue + worker) and most of PR #2
> (admin upload UI) were greenfield. Recon showed both already
> shipped in Slices 3–7 — pg-boss + worker, full orchestrator,
> `Capture` model, sign/record/retry API, Polaris uploader, and the
> 3-tab `Sdl3dMediaSourceModal` are all live. One plan-vs-reality
> contradiction noted: the shipped flow uses signed-URL
> direct-to-bucket (chosen in Slice 3), not multipart-to-admin-server
> as decision #1 proposed. That decision is overridden by what's
> already in production — kept signed-URL.
>
> **Re-scoped to the actual gaps:** validation surfacing, onboarding
> wizard hook, and job lifecycle ops. See "Re-scoped PRs" below.

## What was already shipped before Slice 9 started

Verified 2026-05-25 against `main`:

- **Queue + worker**: [app/lib/queue.server.ts](../app/lib/queue.server.ts)
  boots pg-boss with `JOB_NAMES.PROCESS_CAPTURE`; [worker/index.ts](../worker/index.ts)
  registers the handler and is launched alongside the web tier by
  [scripts/start.js](../scripts/start.js).
- **Orchestrator**: [app/lib/capture-pipeline/orchestrator.ts](../app/lib/capture-pipeline/orchestrator.ts)
  runs the full pipeline — claim → download raw.zip from the merchant's
  bucket → extract → scan → sample (72 frames) → sharp convert →
  upload converted frames → write `imageSequenceJson` on `ProductConfig`
  → write a manifest.json next to the frames. Failure is captured in
  `Capture.status=FAILED` + `errorMessage` and never re-thrown.
- **API**: [app/routes/api.sdl3d.captures.tsx](../app/routes/api.sdl3d.captures.tsx)
  with `signRawUpload`, `recordRawUpload`, `retry`, plus GET by
  `captureId` or `productGid` for polling.
- **Upload UI**: [app/components/Sdl3dRawCaptureUploader.tsx](../app/components/Sdl3dRawCaptureUploader.tsx)
  zips a folder selection in-browser via JSZip, signs, PUTs to the
  merchant's bucket, records, polls. Polaris-styled (Slice 5C),
  embedded mode (Slice 7).
- **Surface in editor**: [app/components/Sdl3dMediaSourceModal.tsx](../app/components/Sdl3dMediaSourceModal.tsx)
  "Upload to CDN" tab opens from the Media inspector inside the
  editor. Per-product storage override flows through (Slice 6 PR #3 +
  Slice 8).
- **`Capture` model + statuses**: PENDING / UPLOADING / QUEUED /
  PROCESSING / COMPLETED / FAILED. Captures-shared exports the enum,
  bucket-key helpers, and `DEFAULT_FRAME_COUNT_TARGET=72`.

End-to-end the merchant can already upload a ZIP and watch frames
land. The remaining friction is what the original plan called PR #3
+ PR #4 + PR #5 — those are this slice.

## Why now

Slice 8 closed every dashboard polish item that needed the *current*
ingestion model. The pilot merchant can configure viewers, edit
hotspots, manage storage, and publish — but the very first step
(turn raw 360° captures into a published frame sequence) still goes
through SDL hands. That's the bottleneck preventing real
self-service onboarding for the pilot and any follow-on merchant.

We also already have the pieces. `app/lib/capture-pipeline/` contains
ported `scanner`, `sampler`, `converter`, `uploader`, and
`orchestrator` modules (~60% of the platform's `core-360`). `pg-boss`
is in deps. `build:worker` script in `package.json` is wired. The
per-product storage preference shipped in Slice 8 means the
orchestrator knows where to upload before the merchant even starts.

What remains is the **UI surface and the job-queue plumbing** — both
contained in-repo, no cross-app contract changes.

## Decisions locked (from the planning conversation)

These are not open for re-litigation unless a later step surfaces a
concrete reason.

1. **Upload via admin server, not direct-to-Spaces.** 28 MB per
   product (360 frames at standard capture quality) fits comfortably
   in a single multipart POST. Direct-to-Spaces with signed URLs is
   a perf optimization we don't need at pilot scale. Revisit only if
   a tenant arrives with >200 MB per capture.

2. **PRD-IDs are user-input, optional.** No auto-generation in the
   unified app. Merchant types one if they want a memorable handle;
   blank defaults to using the Shopify product GID as the canonical
   identifier downstream. Removes one of `sdl-platform`'s
   load-bearing functions.

3. **Single ZIP file, not multi-file folder upload.** Browsers'
   folder upload (`webkitdirectory`) is uneven across themes and the
   merchant pilot is desktop-first. A ZIP archive is one file, one
   request, one progress bar; the orchestrator unpacks server-side.
   Frame name pattern validation runs after unpack.

4. **Background processing via pg-boss.** `build:worker` already
   exists for this. UI dispatches an "upload finished, please
   process" job after the multipart body is persisted to a
   temporary location; worker picks it up and runs the orchestrator.
   Admin UI polls the job's status until done. SSE is nicer but
   not worth the complexity at pilot scale — 1.5 s polling is fine
   for a job that takes 20–60 s.

5. **Same Docker container hosts the worker.** No separate worker
   service for pilot. `docker-start` (npm script) already runs both
   the React Router server and the worker. If load demands it later,
   split into a separate Unraid container — but not now.

6. **`sdl-platform` dashboard not retired in this slice.** Keep it
   running as SDL-internal ops tooling (audit, manual reprocess,
   troubleshooting). Archive after Slice 9 ships *and* the pilot
   merchant has used the unified flow for a real capture batch.
   Decoupling deployment from "the platform must also be live"
   happens then, not now.

7. **No PRD-ID validation against existing IDs.** Merchants may
   reuse a PRD-ID across products if they want, or leave it blank.
   The downstream consumer is `sdl_3d.imageSequence360` and the
   per-frame URLs — the PRD-ID is a *label*, not a foreign key in
   the unified app. (It's still a real identifier in `sdl-platform`'s
   ops dashboard; cross-app consistency is the user's problem if
   they care.)

8. **Frame sampling stays at 72 frames.** Existing
   `sdl-3d-hotspots/app/lib/capture-pipeline/sampler.ts` does
   even-spaced sampling from `frameCountTarget` (currently always 72
   per `Capture.frameCountTarget @default(72)`). If a merchant wants
   a different count, expose `frameCountTarget` as an upload-form
   field in v2; not v1.

## Re-scoped PRs (the actual Slice 9 work)

Three PRs. PR #1 / #2 of the original plan are dropped — already shipped.

### PR #1 — Pre-flight validation surfacing

Today validation is silent. The orchestrator only throws on the
"floor" cases (zip has 0 supported files, scanner found 0 frames,
sampler returned 0 frames). Less catastrophic-but-still-broken
inputs (filenames the scanner can't parse, duplicates, sequence gaps
that survive sampling, frame count too low for a smooth turntable)
fail late or silently degrade.

**Changes**:
- Port [packages/core-360/src/validator.ts](../../sdl-platform/packages/core-360/src/validator.ts)
  → `app/lib/capture-pipeline/validator.ts`. It returns a
  `ValidationReport` with structured issues (missing_frame, duplicate,
  naming_error). The orchestrator calls it right after `scanDirectory`
  before any sharp work.
- Hard-fail rules (block heavy work, mark FAILED with actionable
  message): zero parseable frames, frame count < target/2 (e.g.
  fewer than 36 frames for the default 72 target — sampled output
  would be aliased/jumpy).
- Soft-warn rules (proceed, but record in validationJson so the UI
  can show them): missing frames in a sequence the sampler will
  paper over, duplicates dropped by `byIndex`, naming-error frames
  the scanner skipped.
- Schema: add `Capture.validationJson String?` (TEXT, holds the
  serialized report). Migration `20260525000000_capture_validation_json`.
- API: surface `validationJson` through `api.sdl3d.captures.tsx`
  responses and the GET endpoint.
- UI: extend the uploader's `processing` / `done` / `error` banners
  to show issues. Hard-fail = critical Banner with the specific
  filename-pattern hint. Soft-warn = info Banner with a "Proceed"
  affordance baked into the "done" state ("72 frames live — 8 raw
  frames were duplicates and got de-duped").

**Files**:
- `app/lib/capture-pipeline/validator.ts` (new)
- `app/lib/capture-pipeline/orchestrator.ts` — wire validation call,
  decide hard-fail vs. soft-warn, persist `validationJson`
- `prisma/schema.prisma` — `Capture.validationJson String?`
- `app/routes/api.sdl3d.captures.tsx` — include `validationJson` in
  `captureToWire`
- `app/components/Sdl3dRawCaptureUploader.tsx` — render
  warnings/errors with structure (filename, issue type)
- Tests: `app/lib/capture-pipeline/validator.test.ts` for the
  classification rules

### PR #2 — Onboarding wizard hook

The 5-step onboarding wizard ([app/routes/app._index.tsx](../app/routes/app._index.tsx) STEPS
array) introduces the app but doesn't drop the merchant into the
upload flow. Today they have to: skip the wizard → find the editor
→ pick a product → open Media → find the Upload tab. That's the
wall the unified-app pivot promised to remove.

**Changes**:
- Add an "Upload your first capture" step to the wizard with a CTA
  that deep-links into the editor with the upload modal pre-opened
  for the picked product.
- Reuse the wizard's existing product picker — once they pick, the
  editor URL becomes
  `/app/sdl3d/editor?productGid=<gid>&openMediaUpload=1`.
- Editor reads `openMediaUpload=1` on mount and opens
  `Sdl3dMediaSourceModal` with the "Upload to CDN" tab active.
- After the capture completes, the wizard's "completed" step
  congratulates and links them to the editor.

**Files**:
- `app/routes/app._index.tsx` — extend `STEPS`, add a product-picker
  inside the new step
- `app/routes/app.sdl3d.editor.tsx` — read `openMediaUpload` query
  param, open the modal on mount
- No schema changes

### PR #3 — Job lifecycle ops

Backoff, retries, dead-letter, cancellation. Not pilot-blocking but
the difference between "robust enough for one merchant" and "robust
enough to leave running without watching it."

**Changes**:
- pg-boss `retryLimit: 2` with exponential backoff (configured at
  `boss.work()` call site in `worker/index.ts` or per-job at enqueue
  via `boss.send` options).
- Schema: `Capture.attempts Int @default(0)` (worker increments at
  each pickup) + `Capture.cancelledAt DateTime?` + a new
  `CANCELLED` status. Migration
  `20260525100000_capture_attempts_cancelled`.
- Dead-letter surface: Settings → "Failed captures" section listing
  recent FAILED rows with `Reprocess` (calls existing `retry`
  intent) and `Delete capture` (cascades — `ProductConfig.captures`
  has `onDelete: Cascade`).
- Cancellation: while a capture is `PENDING`, `UPLOADING`, `QUEUED`,
  or `PROCESSING`, the uploader UI shows a "Cancel" button that
  POSTs a new `intent=cancel` to the captures API. The worker
  re-reads the capture row before each major step (validate /
  convert / upload / write) and bails out if `cancelledAt` is set.

**Files**:
- `prisma/schema.prisma` — `Capture.attempts`, `Capture.cancelledAt`
- `app/lib/captures-shared.ts` — add `CANCELLED` to the enum
- `worker/index.ts` — pass pg-boss `boss.work` options for retry
  limit + backoff
- `app/lib/capture-pipeline/orchestrator.ts` — bump `attempts` on
  claim, re-check cancellation between steps
- `app/routes/api.sdl3d.captures.tsx` — `intent=cancel`,
  `intent=deleteCapture`, include `attempts`/`cancelledAt` in wire
- `app/routes/app.sdl3d.settings.tsx` — Failed captures section
- `app/components/Sdl3dRawCaptureUploader.tsx` — Cancel button +
  CANCELLED state rendering

## Out of scope (re-scoped)

- **`Capture.jobId` correlation column** (original PR #1): pg-boss
  manages its own job-row state and the existing pipeline never
  needs to look up "which job processed this capture" — would add a
  column nothing reads. Dropped.
- **Dedicated `/app/sdl3d/upload` route** (original PR #2): the
  in-editor Modal flow is the canonical surface and the onboarding
  hook (PR #2 above) takes care of the deep-link case. A standalone
  page would duplicate UI without adding a use case.
- **Multipart-to-admin-server upload path** (original decision #1):
  contradicted by the shipped signed-URL flow, which is working at
  the pilot. Revisit only if a tenant arrives where signed URLs
  break (e.g. a corporate proxy that strips the auth header).

## Original plan (preserved for context, superseded above)

> Five PRs, ~5–8 days if no surprises. Order is "queue + worker first,
> then UI on top, then ops polish."

### PR #1 — pg-boss queue + worker boot

Foundation. No user-visible change yet.

**Changes**:
- Install/configure `pg-boss` against the existing Postgres database
  (already a dep; just need a boot call).
- New `worker/index.ts` queue consumer with the orchestrator wired
  to a single job type `capture.process`.
- Job payload: `{ captureId: string }`. Worker loads the Capture
  row, runs scan → validate → sample → convert → upload → metafield
  write, updates `Capture.status` at each step.
- `worker/index.ts` boot wires pg-boss `start()` + `work()`.
- `scripts/start.js` (used by `docker-start`) starts both processes
  (already does — verify).

**Out of scope for this PR**:
- The UI to *enqueue* jobs (PR #2).
- Job status surfacing (PR #2).
- Cancellation / retry / dead-letter handling (PR #5).

**Files**:
- `worker/index.ts` — already exists per `build:worker`; extend.
- `app/lib/capture-pipeline/orchestrator.ts` — confirm it can be
  driven by a single `captureId` (verify; orchestrator already
  loads its own state).
- `prisma/schema.prisma` — add `Capture.jobId String?` column for
  the pg-boss job correlation. Migration
  `20260523000000_capture_job_id`.

### PR #2 — Admin upload UI + capture creation

The merchant-facing entry point.

**Changes**:
- New route `app.sdl3d.upload.tsx` OR a Modal launched from the
  editor's existing capture surface. Decision at PR kickoff: a
  full route is more discoverable, a Modal keeps the merchant in
  context. Lean route — easier to deep-link from onboarding later.
- Form fields:
  - Product picker (`ProductBrowserModal`, already exists)
  - Optional PRD-ID text field
  - ZIP file input (Polaris `DropZone`)
  - Submit button → enqueues job
- On submit:
  - POST multipart to a new `api.sdl3d.uploads.tsx` route
  - Server stores the ZIP in a temp location (DO Spaces with a
    `tmp/<shopId>/<captureId>/raw.zip` key works — same backend
    the pipeline already uses)
  - Creates a `Capture` row in PENDING state with the storage id
    set from the product's `preferredStorageId` (Slice 8) or shop
    default
  - Enqueues `capture.process` job with `captureId`
  - Returns the capture id to the UI
- UI then polls `api.sdl3d.captures.tsx` (existing) for the
  capture's status until SUCCESS or ERROR.

**Files**:
- `app/routes/app.sdl3d.upload.tsx` (new)
- `app/routes/api.sdl3d.uploads.tsx` (new — multipart receiver +
  job enqueue)
- `app/lib/capture-pipeline/orchestrator.ts` — extract the
  raw-ZIP-handling step (today it reads from a known bucket key)
- `app/components/CaptureProgress.tsx` (new) — polling status card
  with step indicator

**UX wins**:
1. Merchant uploads a folder ZIP, sees a progress bar, ends on
   "ready to edit" with a one-click button to the editor.
2. No SDL operator handoff. No cross-app dashboard. Single install.

### PR #3 — Frame validation surfacing

Today validation happens silently inside the orchestrator. If a
merchant uploads a malformed folder (wrong file extensions, gaps in
sequence numbering, wrong count), the job fails late and the
merchant has no actionable error.

**Changes**:
- Add a pre-flight validation step that runs *before* the heavy
  conversion/upload work. Run scanner + validator on the ZIP, then
  pause and present results to the merchant.
- If validation passes cleanly, auto-proceed (no extra click).
- If warnings (e.g. "Sequence has 358 frames; will sample to 72"),
  show inline; merchant can proceed or cancel.
- If errors (e.g. "Filename pattern doesn't match `frame_NNN.jpg`;
  rename and retry"), block until the merchant uploads a new ZIP.

**Files**:
- `app/lib/capture-pipeline/validator.ts` — port from
  `sdl-platform/packages/core-360/src/validator.ts` (not yet in
  the hotspots repo).
- Wire validation step into orchestrator state machine as a new
  `VALIDATING` status before `PROCESSING`.
- UI surfaces validation issues from `Capture.errorMessage` /
  new `Capture.validationJson` column.

### PR #4 — Onboarding integration

Once upload works, the onboarding wizard's "Add a 3D model or
images" step should link to the upload flow.

**Changes**:
- `app/routes/app._index.tsx` onboarding modal — add a CTA on the
  upload step that opens `/app/sdl3d/upload` with the picked
  product preselected.
- Refresh dashboard after first successful capture so the merchant
  sees the new ProductConfig row.

**Files**:
- `app/routes/app._index.tsx` — onboarding step CTA.
- `app/components/CaptureProgress.tsx` — onCompleted callback that
  the upload route uses to refresh + navigate.

### PR #5 — Job lifecycle ops

Backoff, retries, dead-letter, cancellation. Not pilot-blocking but
needed before second tenant.

**Changes**:
- pg-boss `retryLimit: 2` with exponential backoff.
- `Capture.attempts` column to surface retry count to merchant.
- Dead-letter queue: capture rows that exhausted retries surface in
  Settings → "Failed captures" list with a "Reprocess" button.
- Cancellation: while a job is `PENDING` or `PROCESSING`, the UI
  shows a "Cancel" button that marks the capture `CANCELLED` and
  the worker checks the row's status between steps.

**Files**:
- `prisma/schema.prisma` — `Capture.attempts Int @default(0)` +
  `Capture.cancelledAt DateTime?`
- `worker/index.ts` — pg-boss retry config + status-checking loop.
- `app/routes/app.sdl3d.settings.tsx` — failed-captures section.

## Edge cases & invariants

1. **Concurrent uploads for the same product**: orchestrator should
   serialize per `productConfigId` so two simultaneous uploads
   don't race on the metafield write. pg-boss singleton key per
   product GID handles this.

2. **Storage row deleted mid-job**: capture row's `storageId` is a
   snapshot at enqueue time; worker reads from that specific row
   even if the merchant flips defaults. Already true today (Slice 6
   PR #3 comment in api.sdl3d.captures.tsx).

3. **ZIP without a base folder**: scanner should handle both
   `frames/frame_001.jpg` and `frame_001.jpg` (flat) — port the
   forgiving glob from `sdl-platform/packages/core-360`.

4. **Browser timeout on slow uploads**: at 28 MB on a 5 Mbps
   connection that's ~45 s. Use Polaris `<DropZone>` progress
   indicator + abort controller. Multipart streams to a tmp file
   on the server, so the request stays open but doesn't buffer
   the whole body in memory.

5. **Worker crash mid-job**: pg-boss with `retryLimit: 2` reschedules.
   Orchestrator state machine should be idempotent — re-running a
   step on a partially-uploaded capture should pick up where it
   left off, not duplicate work. Verify each step before
   implementing.

6. **PRD-ID collision across merchants**: not a concern; PRD-IDs are
   scoped per shop. If a future feature shares them cross-shop
   (e.g. global product catalog), add a uniqueness constraint
   then.

7. **`sdl_3d.imageSequence360` write race vs. editor open**: if the
   merchant is editing the product when the capture finishes, the
   editor's loader data is stale. After capture SUCCESS, the
   storefront preview auto-refreshes via revalidator and the merchant
   sees the new frames. Worst case the merchant manually reloads.

## Build / typecheck checklist (per PR)

```bash
npx prisma generate        # PRs #1, #3, #5 have schema changes
npx prisma migrate dev     # same
npx tsc --noEmit
npm run build              # CRITICAL — RR's .server import rule
npx vitest run             # pipeline modules grow tests in PRs #1 + #3
```

## Staging smoke checklist

### PR #1 (queue + worker)
1. Manually insert a `Capture` row with `status: PENDING` + a real
   `storageId` + a tmp ZIP key that exists.
2. Enqueue `capture.process` job via a one-off script.
3. Worker picks it up; capture progresses through statuses; metafield
   write succeeds; status ends `SUCCESS`.

### PR #2 (admin UI)
1. Open Upload page → pick a product → upload a ZIP → see progress
   bar advance through validating/processing/uploading/publishing.
2. Click through to the editor; sequence is loaded.
3. Storefront block on the staging store shows the new frames.

### PR #3 (validation)
1. Upload a ZIP with a malformed frame filename → validation step
   surfaces the error inline.
2. Upload a ZIP with 1000 frames → warning "Will sample to 72";
   merchant proceeds; result is a 72-frame sequence.

### PR #4 (onboarding)
1. Reset onboarding from Settings → run wizard → upload step opens
   the upload flow with the picked product preselected.
2. After SUCCESS, dashboard shows the new ProductConfig row with
   the storage column populated.

### PR #5 (ops)
1. Force a worker crash mid-job (kill the container) → pg-boss
   reschedules → second worker picks up → eventually SUCCESS.
2. From settings, manually fail a capture; "Reprocess" button kicks
   off a fresh attempt.

## Backout strategy

Each PR is independently revertible.

- **PR #1**: queue setup is additive; reverting leaves orphaned
  pg-boss tables in Postgres but nothing depends on them yet.
- **PR #2**: upload routes are net-new; remove + revert prisma
  changes.
- **PR #3**: validation runs first; reverting drops the early
  surfacing but the pipeline still works (errors fail late as
  they do today).
- **PR #4**: onboarding link only; pure UI.
- **PR #5**: ops polish; reverting leaves the system functional,
  just less robust under failure.

## Out of scope for Slice 9

Saved for follow-up slices:

- **`sdl-platform` dashboard retirement**: decided to keep as SDL-
  internal ops tool through pilot. Archive after Slice 9 ships
  *and* the pilot merchant has used the unified flow for ≥1 real
  capture batch.
- **Bucket folder re-validation** ("Validate frames" button): the
  Slice 8 backlog leftover. Queue for when a merchant hits a
  malformed folder.
- **Catmull-Rom across the wrap**: Slice 7 PR #6 leftover. Not
  blocking; trigger if a merchant reports the kink at the wrap
  point.
- **Multi-product batch upload**: one capture at a time for now.
  Bulk would need a worker pool sized for the heavy `sharp`
  conversion step.
- **Direct-to-Spaces signed URLs**: if a future tenant has
  >200 MB per capture.
- **`frameCountTarget` user-configurable**: stays at 72 for v1.
- **WebGL preview during upload**: nice-to-have ("watch your
  capture render in real time") but not on the critical path.

## Slice 8 closing summary (context for the next session)

Slice 8 wrapped in this session. Final state:
- Hotspot sub-cluster (PRs #1–#5 + follow-up): row layout / Simple-
  Advanced / animations / custom icons / typed media slots, all
  staging-validated and shipped.
- TAE bundle refactor: `tae-src/product-3d-viewer/` esbuild sources
  → minified `extensions/.../assets/*.js`. Shared 0.3.1 with subpath
  exports keeps Zod out.
- CSS clip-through fix on `.sdl3d-block` (`isolation: isolate` +
  explicit z-index) verified on staging.
- App Bridge session fix: `PolarisAppProvider linkComponent` adapter
  so dashboard product clicks navigate via React Router.
- Bulk republish button on Settings.
- Preset apply with per-hotspot dedup picker + delete confirmations.
- Per-product storage column + Modal override on dashboard.

Open Slice 8 items that *aren't* moving to Slice 9:
- Bucket folder re-validation ("Validate frames" button) — optional,
  trigger on merchant report.

Memory updated: see [[unified-app-pivot]] and the new feedback
memories ([[feedback-tae-directory-layout]],
[[feedback-polaris-link-component]]).
