# Slice 6 — Merchant-clarity follow-ups after Polaris migration

> **STATUS: PLANNING.** Author SDL + Claude, 2026-05-19. Picks up after
> Slice 5C (`64aa66f..643333d`, all 14 PRs validated on staging).
> Three top-ROI candidates queued in 5C's "Out of scope" section, plus a
> short tail of lower-priority items. Each PR is independently shippable;
> there is no substrate / cleanup bookend like 5C had.

## Why this exists

5C closed the visual gap with Shopify admin. The remaining merchant
friction is **functional**, not visual:

1. **Orphaned configs accumulate.** PR #4's product-resolve fix surfaced
   rows tagged `Deleted on Shopify` (e.g. `<real-id>` test rows on
   staging). Today merchants can't remove these — the dashboard shows
   them with a critical Badge and no action. They have to ignore the row
   or `psql` it out.
2. **Re-uploading existing frame sets wastes a capture run.** Merchants
   who shoot turntables outside the app (CLI, another shop instance,
   manual upload) currently have to re-upload the same images through
   the in-browser ZIP + `process_capture` pipeline. The frames are
   already in the bucket; we just need to point the product at them.
3. **Storage selector is locked to the default row.** A merchant with
   multiple storage providers configured (e.g. DO Spaces for prod + R2
   for staging) can't choose where a specific capture goes without
   flipping the default in Settings → Storage, capturing, then flipping
   it back. Deferred from Slice 5B planning.

Three small surfaces, no schema churn for #1 / #3, one additive column
for #2. Total ~3–4 days of work if no surprises.

## Decisions already locked

Came out of 5C closeout (2026-05-19). Confirm at PR-1 kickoff; not
open for re-litigation otherwise.

1. **Slice 6 is functional follow-ups, not visual polish.** No
   page-rewrites. New affordances slot into existing Polaris surfaces
   (dashboard ResourceList rows, editor Inspector Media section,
   editor top bar). Visual additions are limited to: per-row action
   menus, one new Modal (folder picker), one new Select (storage
   override).
2. **One PR per item, in ROI order.** PR #1 (dashboard delete) → PR #2
   (bucket folder reuse) → PR #3 (top-bar storage selector). #1 is
   smallest blast radius and unblocks merchant cleanup. #2 is the most
   merchant-requested. #3 is the smallest UX surface but interacts
   with the active capture flow, so it lands last when the other two
   have proven nothing else regressed in `signRawUpload`.
3. **All new server intents go on existing API routes.** No new
   `api.sdl3d.*` files. `deleteConfig` + `deleteOrphanedConfigs` land
   on `api.sdl3d.config.tsx` (already owns config-lifecycle intents).
   `listBucketFolders` + `useBucketFolder` land on
   `api.sdl3d.storage.tsx` (already owns ShopStorage). Avoids the
   route-fragmentation Slice 5 already corrected once.
4. **Bucket folder reuse skips the capture pipeline entirely.** No
   `process_capture` job for these — we trust the frames are already
   sized and ordered. The new `useBucketFolder` write path sets
   `ProductConfig.imageSequenceJson` + `frameCount` +
   `imageSequencePrefix` directly. Future slice can add a "validate
   frame manifest" optional step; v1 is fire-and-forget.
5. **Top-bar storage selector is editor-state only.** It does **not**
   write to `ShopStorage.isDefault`. The selector is an override that
   piggy-backs on the existing `Capture.storageId` stamp — the
   `signRawUpload` action accepts an optional `storageId` form field
   and uses it instead of `getDefaultStorageRowId(shopId)`. Flipping
   the default still requires Settings → Storage.
6. **Deletion is hard delete + cascade.** `ProductConfig` has
   `onDelete: Cascade` on Hotspot and Capture relations
   ([prisma/schema.prisma:139,178](sdl-3d-hotspots/prisma/schema.prisma#L139)).
   Deleting a row drops the hotspots and capture history with it. No
   soft-delete column. Merchants who want recovery should rely on the
   Shopify metafield as their source of truth — if the config was
   `PUBLISHED`, the metafield still exists post-deletion and can be
   pulled back with the existing `pull` intent on
   `api.sdl3d.config.tsx`.
7. **No bulk-undo on bulk delete.** "Delete all orphaned configs"
   confirms once via Polaris `Modal` and then deletes. Merchants
   considering this action are by definition cleaning up test
   detritus; the cost of an unintended bulk-delete is bounded by
   #6's metafield-recovery path.
8. **No new schema columns except `ProductConfig.imageSequenceSource`**
   (added in PR #2 to distinguish capture-pipeline frames from
   bucket-folder-reuse frames). Used for diagnostics ("did this
   product's frames come from the pipeline or from a folder pick?")
   and for future re-validation. Default `"CAPTURE"` so existing rows
   stay correctly classified post-migration. PR #2 owns the migration.

## Migration order — PR-by-PR

### PR #1 — Dashboard config deletion

Smallest surface. Two new actions (per-row Remove, bulk
Delete-orphaned). One new API intent group. No schema changes.

**Polaris components**:
- `ResourceItem.shortcutActions` for the per-row Remove. Shopify's
  ResourceItem renders these as a hover-revealed action button on
  the right edge of the row.
- Page header gets a `secondaryActions` array containing a single
  `{ content: "Delete orphaned…", destructive: true,
  onAction: openBulkDeleteModal }` — surfaced only when at least one
  `productMissing` row exists in `data.configs`.
- `Modal` for the bulk-delete confirmation, listing the count of
  orphaned rows and an explanatory body ("These products were
  deleted on Shopify but still have configs in this app. Their
  hotspots and capture history will be deleted.").
- `Toast` (existing `Frame` already mounted in
  [app/routes/app._index.tsx:509](sdl-3d-hotspots/app/routes/app._index.tsx#L509))
  for "Removed `{title}`" success messages.

**API changes** — extend `api.sdl3d.config.tsx`:
- `intent=deleteConfig` — accepts `productGid` form field, deletes the
  one `ProductConfig` row scoped to the calling shop. Returns
  `{ ok: true, productGid }`. 404 if the row doesn't exist or
  belongs to another shop.
- `intent=deleteOrphanedConfigs` — server-side resolves every
  `ProductConfig` for the shop, fetches them all via Shopify
  GraphQL `nodes(ids:)` in batches of 100, deletes only those that
  came back `null`. Returns `{ ok: true, deletedCount }`. Reuses
  the `VALID_PRODUCT_GID` regex from the dashboard loader to also
  delete rows with malformed GIDs (the `<real-id>` placeholder
  case).

**UX wins locked in for this PR**:
1. **Per-row Remove is gated to `productMissing` rows only.** Live
   configs are protected from accidental deletion — the only way to
   delete a still-existing product's config is to delete it from the
   Editor (a follow-up Slice 7 candidate, not in 6). Prevents the
   "merchant clicks Remove on the wrong row" failure mode.
2. **Bulk action's count is computed from the loader, not a
   round-trip.** The header action's label reads "Delete orphaned
   (3)" so the merchant sees the scope before clicking. The Modal
   re-runs the resolve server-side so the count can't drift between
   page load and confirmation.
3. **Removed row toast carries an "Undo by re-publishing from
   metafield" hint** for `PUBLISHED` rows. Surfaces the recovery
   path inline so the merchant doesn't think the data is gone for
   good.

**Files that change in PR #1**:
- `app/routes/app._index.tsx` — add `shortcutActions` to
  `ProductResourceRow`, add `secondaryActions` to `Page`, add the
  bulk-delete `Modal`, wire `fetcher.submit` calls. Loader stays
  unchanged (the `productMissing` flag is already computed).
- `app/routes/api.sdl3d.config.tsx` — add the two new intents.
- `app/lib/sdl3d-shared.ts` — no changes (no new types beyond the
  existing `DashConfig`).

**Out of scope for PR #1**:
- Undo via local toast action. The "Undo by re-publishing" hint is
  prose, not a button. Polaris `Toast` only supports one action,
  and "re-pull from metafield" requires navigating to the editor
  anyway.
- Soft-delete column. Decision #6.
- Editor-side "Delete this config" button. Slice 7 candidate;
  merchants don't currently ask for it and it changes the
  navigation flow (deleting your active product needs to redirect
  somewhere).

### PR #2 — Reuse existing bucket folders for 360°

Biggest UX surface of this slice. New Modal, new API intent group,
one additive schema column.

**Polaris components**:
- Editor Inspector → Media section: existing `Sdl3dRawCaptureUploader`
  card stays as-is. Add a sibling `Card` below it titled "Use existing
  folder" with `Button` "Browse bucket folders…" that opens the new
  Modal.
- `Modal` (size `large`) titled "Choose a bucket folder". Body is a
  Polaris `ResourceList` of folders with: `Thumbnail` (first frame
  preview), folder name (path tail), `Text tone="subdued"` for full
  prefix + frame count + total size. Each item has a primary `Button`
  "Use this folder" that closes the Modal and triggers the
  `useBucketFolder` intent.
- `EmptyState` inside the Modal when the bucket has no
  frame-bearing prefixes ("No frame sequences found in this
  bucket. Frames detected as folders containing 24 or more
  `.jpg` / `.png` files at the same depth.").
- `Banner tone="info"` at the Modal top: "Frames will be used as-is.
  Capture-pipeline validation (size, ordering) is skipped." So the
  merchant knows this isn't a substitute for the full capture flow.

**API changes** — extend `api.sdl3d.storage.tsx`:
- `intent=listBucketFolders` — accepts `prefix` form field
  (defaulting to `""` for root). Calls
  `loadDefaultStorageForShop(shopId)` → `listObjects(prefix)` and
  groups returned keys into folders by their parent prefix. A
  folder qualifies if it contains ≥ 24 keys ending in
  `.jpg|.jpeg|.png|.webp` at the same depth. Returns
  `{ ok: true, folders: [{ prefix, name, frameCount, totalBytes,
  previewUrl }] }`. The `previewUrl` is the first frame keyed by
  alphanumeric sort, resolved via `publicBaseUrl` or a 15-minute
  signed GET URL when `publicBaseUrl` is null.
- `intent=useBucketFolder` — accepts `productGid` + `prefix` +
  `frameKeys` (JSON array of object keys, alphanumerically sorted
  client-side). Creates or updates the `ProductConfig` for the
  product, sets `imageSequenceJson` to the resolved URLs,
  `imageSequencePrefix` to the chosen prefix, `frameCount` to the
  array length, `imageSequenceSource` to `"BUCKET_FOLDER"`. Does
  NOT touch the Capture table. Returns
  `{ ok: true, productConfigId, frameCount }`.

**Schema changes**:
- `ProductConfig.imageSequenceSource String @default("CAPTURE")`.
  Values: `"CAPTURE" | "BUCKET_FOLDER"`. Migration sets the default
  on all existing rows.

**UX wins locked in for this PR**:
1. **Skipping the capture pipeline cuts wait time from
   ~minutes to ~seconds.** Pipeline does upload → unzip → resize →
   re-upload; folder pick is a single LIST + a metadata write.
   Merchants iterating on hotspot placement against frames they
   shot once shouldn't re-process every time they switch products.
2. **Frame previews in the picker.** Each folder row shows its
   first frame as a `Thumbnail` so merchants can tell which
   product's frames live in which folder. Today nothing in the app
   shows raw bucket content; merchants identify folders by
   memorized prefixes.
3. **Frame count + total size shown before commit.** Avoids the
   "picked the wrong folder" failure mode. A folder with 12 frames
   probably isn't a turntable; surfacing the count lets the
   merchant catch it before commit. Total bytes flags accidentally
   huge sources (un-resized originals).

**Files that change in PR #2**:
- `app/routes/api.sdl3d.storage.tsx` — add the two new intents.
- `app/lib/storage.server.ts` — small helper
  `listFrameBearingFolders(backend, prefix, minFrames)` that wraps
  the existing `listObjects` with the grouping logic. Pure server,
  no Prisma dependency.
- `app/components/Sdl3dBucketFolderPicker.tsx` — new component, the
  Modal + ResourceList.
- `app/routes/app.sdl3d.editor.tsx` — wire the picker into the
  Media InspectorSection at
  [app/routes/app.sdl3d.editor.tsx:1572](sdl-3d-hotspots/app/routes/app.sdl3d.editor.tsx#L1572),
  after the `Sdl3dRawCaptureUploader` and before the poster
  `FileTriggerCard`.
- `prisma/schema.prisma` — add the `imageSequenceSource` column.
- `prisma/migrations/<timestamp>_image_sequence_source/migration.sql` —
  the column add + default.
- `app/lib/sdl3d-schemas.ts` — extend the `imageSequence360` element
  schema if any new field is exposed to the Theme App Extension
  (likely none — the extension just reads URLs; source classification
  is server-only).

**Out of scope for PR #2**:
- Browsing buckets other than the default. Merchants pick a folder
  from whichever ShopStorage row is currently default. PR #3
  (top-bar storage selector) adds the multi-bucket affordance.
- Folder creation / upload from the Modal. Read-only.
- Re-validation of folder contents (size, dimensions, frame
  ordering). Trust on commit; Slice 7 candidate.
- Deleting bucket folders from this UI. Storage operations live in
  Settings → Storage; this Modal is a picker only.

### PR #3 — Editor top-bar storage selector

Smallest UX surface, but the riskiest by interaction count — it
mutates the active capture flow.

**Polaris components**:
- Editor top bar (existing `sdl-editor__topbar__left` flex container
  at [app/routes/app.sdl3d.editor.tsx:1257](sdl-3d-hotspots/app/routes/app.sdl3d.editor.tsx#L1257)):
  add a Polaris `Select` between the `TopbarField` "Mode" and the
  save-state `Badge`. Label "Storage" (rendered via the existing
  `TopbarField` wrapper for visual consistency), value is the
  current storage row id, options are the shop's
  `ShopStorage` rows formatted as `<provider>: <bucket>`.
- `Badge` next to the Select with tone "subdued" reading "default"
  when the selection matches `ShopStorage.isDefault`, "override"
  otherwise. Makes it immediately clear when a non-default bucket
  will be used for the next capture.

**API changes**:
- `api.sdl3d.captures.tsx` `signRawUpload` intent — accept an
  optional `storageId` form field. If present, validate it belongs
  to the caller's shop (`prisma.shopStorage.findFirst({ where:
  { id, shopId } })`) and use it instead of
  `getDefaultStorageRowId(shopId)`. Stamp the new `Capture.storageId`
  with the override. If absent, behavior is unchanged.
- Editor route loader — extend the existing loader to return
  `availableStorages: ShopStorageSummary[]` (call
  `listStoragesForShop(shop.id)` already in
  [app/lib/storage.server.ts:297](sdl-3d-hotspots/app/lib/storage.server.ts#L297)).
  Only renders the Select when `availableStorages.length > 1`.

**UX wins locked in for this PR**:
1. **Visible "this capture is going somewhere unusual" indicator.**
   The "override" Badge surfaces the active state at all times,
   not just at upload time. Merchants who switched the selector
   yesterday and came back today see it immediately.
2. **No reload required to switch.** Today the only way to change
   the capture target is Settings → Storage → Set as default. The
   top-bar Select is a one-click override that persists until the
   next page load (intentionally non-persistent — see Decision #5;
   it's an override, not a preference).
3. **Selector hidden when not needed.** Shops with one storage row
   see no new chrome. Avoids cluttering the topbar for the common
   case (single bucket).

**Files that change in PR #3**:
- `app/routes/app.sdl3d.editor.tsx` — loader returns
  `availableStorages`; editor component renders the Select, passes
  the chosen `storageId` to `<Sdl3dRawCaptureUploader>` as a new
  optional prop.
- `app/components/Sdl3dRawCaptureUploader.tsx` — accept the new
  `storageId` prop, pass it as `formData.set("storageId", ...)`
  in the `signRawUpload` POST.
- `app/routes/api.sdl3d.captures.tsx` — accept and validate the
  optional `storageId` in `handleSignRawUpload`.
- No schema changes (the `Capture.storageId` column already exists
  per [prisma/schema.prisma:126](sdl-3d-hotspots/prisma/schema.prisma#L126)).

**Out of scope for PR #3**:
- Persisting the override per-shop or per-product. Decision #5.
- Per-product storage assignment in the dashboard's ResourceList.
  Slice 7 candidate; needs broader thought on dashboard density.
- Storage selector for the bucket-folder picker from PR #2.
  Folder picker reads from the *selector's current value* once #3
  lands — until then it stays on the default row.

## Edge cases & invariants

1. **`getDefaultStorageRowId` returns null.** PR #3's override path
   still surfaces the existing "Storage credentials not configured"
   error when the merchant picks a row that's since been deleted (race
   between editor load and Browse). The Select option list freezes at
   page-load time; if the merchant deletes the row in another tab,
   the POST returns 404 `Storage row not found` and the existing
   `needsStorageSetup` UI path handles it.

2. **PR #2's `listBucketFolders` performance.** A bucket with
   thousands of objects under deep prefixes pays for one
   `ListObjectsV2` round-trip per page (1000 keys/page). Cap at the
   first 10 pages (10k keys) per call; if `isTruncated` after that,
   render the EmptyState with "Bucket too large to scan automatically
   — narrow the prefix with the search field." (the Modal grows a
   `TextField` prefix search if we hit this — defer to a follow-up
   only if a real merchant hits the cap).

3. **PR #2's frame ordering.** `listObjects` returns keys in S3's
   sort order (UTF-8 binary). We re-sort client-side using
   `localeCompare(undefined, { numeric: true })` so frames like
   `frame_2.jpg`, `frame_10.jpg` order correctly. The frame-keys
   array we POST is already sorted; the server trusts that order.
   Document the contract in the API intent's response schema.

4. **PR #1's bulk delete race.** Merchant clicks "Delete orphaned
   (3)" → opens Modal → in the meantime, the resolve from
   `intent=deleteOrphanedConfigs` finds only 2 orphans (maybe one
   product was un-deleted on Shopify). Server returns
   `{ deletedCount: 2 }`; client toast says "Removed 2 of 3 marked
   for deletion." Honest about the drift.

5. **PR #2's `useBucketFolder` overwrites previous frames.** If the
   merchant ran a capture pipeline first and then picks a folder,
   `imageSequenceJson` is overwritten with the folder's frames.
   `imageSequenceSource` flips to `"BUCKET_FOLDER"`. Old Capture
   rows stay in the DB for audit but are no longer wired to the
   product's frames. Surface a Polaris `Banner tone="warning"` in
   the Modal when the merchant has existing frames: "Replacing 72
   existing frames from capture run 2026-05-18."

6. **PR #3's `Capture.storageId` already-stamped semantics.** The
   stamp at `signRawUpload` time is load-bearing — the worker
   reads from that specific bucket later
   ([app/routes/api.sdl3d.captures.tsx:188](sdl-3d-hotspots/app/routes/api.sdl3d.captures.tsx#L188)).
   The override path slots into the same write; no worker changes
   needed.

7. **Polaris `ResourceItem.shortcutActions` and `url` interplay.**
   `ResourceItem` rows in the dashboard currently set `url` so the
   whole row is a link to the editor. Adding `shortcutActions`
   keeps the row clickable but lets the action button stop
   propagation. Verified pattern in Polaris docs; if Remove
   accidentally triggers navigation, wrap the action's onClick
   per `feedback_polaris_event_gotchas.md`.

8. **The new `Sdl3dBucketFolderPicker.tsx` is client-only.** It
   uses `useFetcher` to POST to the API route; no `.server`
   imports. Per `feedback_rr_server_split.md`, run `npm run build`
   before commit to catch server-import bleed.

## Build / typecheck checklist (per PR)

```bash
npx prisma generate            # PR #2 only — others have no schema changes
npx tsc --noEmit
npm run build                  # CRITICAL — RR's .server import rule
```

PR #2 also runs `npx prisma migrate dev --name image_sequence_source`
locally and commits the generated migration file alongside the
schema change.

## Staging smoke checklist (per PR)

Generic shape: each PR is its own staging deploy + smoke. PR-specific
items below.

### PR #1
1. Dashboard loads with at least one orphaned config (use staging's
   existing `<real-id>` test row, or `intent=resetOnboarding` and
   re-seed). Verify "Delete orphaned (N)" appears in the header.
2. Click per-row Remove on an orphan → confirm toast → verify the
   row vanishes and `prisma productConfig findUnique` returns null.
3. Per-row Remove must NOT appear on live (non-`productMissing`)
   rows. Inspect a healthy product row.
4. Bulk Delete-orphaned with 3 orphans → confirm Modal → toast
   reads "Removed 3" → next page load shows the badge gone from
   the header.

### PR #2
1. Pre-upload a folder of 36 frames to the staging bucket via
   `aws s3 cp --recursive`. Open the editor with a fresh product
   selected. Confirm the new "Use existing folder" Card renders
   in Media.
2. Open the picker → verify the folder shows with frame count,
   total bytes, and a Thumbnail of the first frame.
3. Click "Use this folder" → verify `ProductConfig.imageSequenceJson`
   is populated, `frameCount = 36`, `imageSequenceSource =
   "BUCKET_FOLDER"`. No Capture row created.
4. Refresh the editor → verify the 360° preview canvas renders the
   frames in correct order.
5. Re-run with an existing-frames product → verify the warning
   Banner appears and the replace works.
6. Edge case: pick an empty-bucket shop → verify the EmptyState.

### PR #3
1. Add a second `ShopStorage` row on the staging shop (a separate
   bucket) → open the editor → verify the new Storage Select
   appears in the topbar. Single-row shops should still see no
   selector.
2. Select the non-default row → verify "override" Badge appears.
3. Run a real capture upload → verify `Capture.storageId` matches
   the override, not the default. Worker should process from the
   override bucket.
4. Switch back to the default → Badge reverts to "default".
5. Delete the override row in another tab while it's selected → run
   a capture → verify the "Storage credentials not configured"
   error path still triggers cleanly (no 500).

## Backout strategy

Each PR is independently revertable. None depend on the others; the
ROI ordering is for merchant impact, not for landing dependencies.

PR #2's schema column add is forward-compatible — reverting the code
without rolling back the column is safe (column just stays unused
with its `"CAPTURE"` default).

## Out of scope for Slice 6 (notes for future slices)

- **Editor-side "Delete this config" button** — needs navigation-
  after-delete handling. Slice 7 candidate.
- **Per-product storage assignment in the dashboard** — column in the
  ResourceList showing which bucket each product's last capture
  used, plus a way to override default for a specific product.
  Needs broader dashboard density review.
- **Bucket folder re-validation** — optional "Validate frames" button
  on the folder picker that checks dimensions and ordering before
  commit. Slice 7 if a merchant hits a malformed folder in
  production.
- **Folder browsing across multiple storage rows** — picker shows
  folders from all configured buckets, not just the active one.
  Wait until a merchant actually has 3+ buckets and asks for it.
- **Soft-delete on `ProductConfig`** — recover-from-trash flow.
  Today's metafield-recovery path covers the common case.
- **Logo DropZone with real Shopify staged upload** — deferred from
  Slice 5C PR #1. Low merchant ROI; do it when there's a broader
  Settings page revisit.
- **"System" theme option + `darkModeChoice` column** — deferred
  from 5C PR #1. Wait for a real merchant request; nobody on
  staging has asked.
- **App Store listing assets** — separate Phase-2 track.
- **Localization beyond en** — separate slice.
- **`auth.login` route Polaris migration** — drops `globals.d.ts`
  to 1 declaration (`model-viewer` only). Only worth it during a
  broader OAuth visual pass.
