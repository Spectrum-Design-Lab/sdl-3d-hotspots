# Slice 5B — Multi-provider Storage with Default Selection

> **Status**: Planning, not yet implemented. Author: SDL + Claude, 2026-05-13.
> Picks up after Slice 5A's quick-win commits (`134354b..6741368` on `main`).
> Prerequisite: Slice 5A is deployed to staging and smoke-tested.

## Why this exists

The unified app currently treats storage as **one bucket per shop**:
`ShopStorage` has `@unique shopId`, the `loadStorageForShop(shopId)` helper
does a `findUnique({ where: { shopId } })`, and the Storage settings page is a
single edit form.

Two real-world cases that breaks:

1. **Multi-bucket merchants.** A merchant might have a production DO Spaces
   bucket and a separate staging R2 bucket, or be migrating between providers
   and want to keep both rows alive during the cutover. Today they have to
   wipe one to add the other.

2. **Provider testing.** SDL Ops occasionally needs to verify connectivity
   to a non-production provider without destroying the merchant's working
   config. Same blocker.

Slice 5B turns `ShopStorage` into **one row per (shop, provider)** with a
single `isDefault` flag picking which row backs uploads. UX-wise the Storage
page becomes a list of configured providers with an inline edit + a radio-
style default picker — the merchant sees every bucket they've configured,
not just the last one they touched.

## Decisions already locked

These came out of the Slice 5 planning conversation (2026-05-13). They are
not open for re-litigation in 5B; bring them up on a follow-up slice if
something changes.

1. **One default per shop.** Setting a row's `isDefault = true` flips every
   other row for that shop to `false`. UI enforces the radio behavior; server
   enforces the invariant in a transaction.

2. **Captures always upload to the default provider.** No per-product
   override (would require a `ProductConfig.storageProviderId` FK and a
   migration). No per-upload override from the editor (would require the
   top-bar storage selector, which is part of 5C, after the Polaris
   migration ships). The dropdown the user mentioned in their 5 list moves
   into 5C.

3. **Existing single-row deployments backfill cleanly.** The 5B migration
   leaves the existing row in place, sets its `isDefault = true`, and adds
   the composite uniqueness constraint. Zero-downtime, no manual data
   wrangling on the pilot deployment.

4. **`SHOPIFY_FILES` provider still throws** — Slice-1 placeholder, not in
   scope for 5B. The provider list keeps it greyed out as "coming soon".

5. **Encryption stays per-row.** Each `ShopStorage` row carries its own
   encrypted `accessKeyEncrypted` / `secretKeyEncrypted`. No shared "shop
   default credentials" abstraction. AES-256-GCM with `STORAGE_ENC_KEY` as
   before.

## Data model change

### Schema delta — `prisma/schema.prisma`

```prisma
model ShopStorage {
  id                  String    @id @default(cuid())
  shopId              String
  provider            String
  endpoint            String
  region              String
  bucket              String
  accessKeyEncrypted  Bytes
  secretKeyEncrypted  Bytes
  publicBaseUrl       String?
  testedAt            DateTime?
  isDefault           Boolean   @default(false)   // ← NEW
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  shop Shop @relation(fields: [shopId], references: [id], onDelete: Cascade)

  @@unique([shopId, provider])                    // ← was @unique shopId
  @@index([shopId])
  @@index([shopId, isDefault])                    // ← supports default lookup
}
```

Also update the `Shop` model — the existing reverse relation has to flip
from one to many:

```prisma
model Shop {
  // ...
  storages        ShopStorage[]                   // ← was: storage ShopStorage?
}
```

### Migration — `prisma/migrations/20260513120000_multi_provider_storage/migration.sql`

```sql
-- Drop the old single-row uniqueness constraint
ALTER TABLE "ShopStorage" DROP CONSTRAINT IF EXISTS "ShopStorage_shopId_key";

-- Composite uniqueness so a shop can hold one row per provider but not
-- two rows for the same provider.
CREATE UNIQUE INDEX "ShopStorage_shopId_provider_key"
  ON "ShopStorage"("shopId", "provider");

-- isDefault flag; existing rows get TRUE so they keep working unchanged.
ALTER TABLE "ShopStorage"
  ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

UPDATE "ShopStorage" SET "isDefault" = true;

-- Index on (shopId, isDefault) so loadDefaultStorageForShop is one disk seek.
CREATE INDEX "ShopStorage_shopId_isDefault_idx"
  ON "ShopStorage"("shopId", "isDefault");
```

Migration is additive + a uniqueness reshape; safe to apply against the
pilot's running DB. The existing pilot row will end up as that shop's
default automatically.

## Server-side changes

### `app/lib/storage.server.ts`

- **Rename** `loadStorageForShop(shopId)` →
  `loadDefaultStorageForShop(shopId)`. New behavior: `findFirst({ where:
  { shopId, isDefault: true } })`. Returns `null` if the shop has rows but
  none marked default — that should never happen given the
  setDefault-in-a-transaction invariant, but log a warning if it does.

- **Add** `loadStorageForShopByProvider(shopId, provider)`. Used by 5C's
  top-bar selector when it ships; also useful for the storage page's test-
  connection flow when editing a non-default row.

- **Add** `listStoragesForShop(shopId): Promise<ShopStorageSummary[]>`.
  Returns lightweight rows (no decrypted creds) for the storage page's list
  rendering.

Callers to update:
- `app/routes/api.sdl3d.captures.tsx:handleSignRawUpload` — already calls
  `loadStorageForShop(auth.shop.id)`; just rename to the default variant.
- `app/lib/capture-pipeline/orchestrator.ts:runProcessCaptureJob` — same
  rename.
- `app/routes/api.sdl3d.storage.tsx` — see below.

### `app/routes/api.sdl3d.storage.tsx`

The current single-row CRUD becomes per-row CRUD plus a `setDefault` intent.

- `intent=saveCredentials` — needs a `storageId` param (or `provider` if
  creating from scratch). Logic:
  - If `storageId` present → update that specific row.
  - Else (creating) → upsert by `[shopId, provider]`.
  - If this is the shop's **first** row, force `isDefault = true`.
  - Never silently flip another row's `isDefault`; that's the dedicated
    intent below.

- `intent=testConnection` — accept `storageId` (test a saved row) or the
  raw form values (test an in-progress edit). Same as today, just keyed by
  row instead of by shop.

- `intent=deleteStorage` — **NEW**. Delete one row by `storageId`. If the
  deleted row was the default and other rows remain, pick the most-recently-
  updated remaining row and mark it default. If the deleted row was the only
  row, no replacement needed (next signRawUpload will fail cleanly with
  "no storage configured", which the editor already handles).

- `intent=setDefault` — **NEW**. Flip one row to `isDefault = true` and all
  others for the same shop to `isDefault = false`. Wrap in
  `prisma.$transaction` so no transient state where zero rows are default.

```ts
await prisma.$transaction([
  prisma.shopStorage.updateMany({
    where: { shopId, isDefault: true, id: { not: storageId } },
    data: { isDefault: false },
  }),
  prisma.shopStorage.update({
    where: { id: storageId },
    data: { isDefault: true },
  }),
]);
```

## UI changes

### `app/routes/app.sdl3d.storage.tsx`

Replace the single-form page with:

```
─── Storage page ───────────────────────────────────────────────
│ ▌ DigitalOcean Spaces   ●  default     [ Edit ] [ Delete ]   │
│   sdl-cdn @ syd1.digitaloceanspaces.com                       │
│   Last tested: 2026-05-13 14:22                               │
├───────────────────────────────────────────────────────────────┤
│ ▌ Cloudflare R2                        [ Edit ] [ Delete ]   │
│   merchant-r2-test @ ...                                      │
│   ( Set as default )                                          │
├───────────────────────────────────────────────────────────────┤
│ [ + Add provider ]                                            │
└───────────────────────────────────────────────────────────────┘
```

Loader returns `storages: ShopStorageSummary[]` (sorted: default first,
then by `updatedAt desc`). No decrypted credentials in the loader payload —
the form's secret fields stay masked (`••••••••`) like the current page.

The Add / Edit flow opens an inline edit panel for one row at a time — the
existing form fields stay the same (Provider / Space URL / Endpoint /
Region / Bucket / Access key / Secret / Public base URL / Test connection).
Just scoped to one row, with a hidden `storageId` field that backs the
update vs. the create.

Provider dropdown in the Add flow only shows providers the shop **doesn't
already have**. Once all S3-compatible providers are configured, the
Add button greys out with a tooltip.

### `app/routes/app._index.tsx` / dashboard

No changes for 5B. Storage status doesn't surface on the home page today;
adding a "Storage: 2 providers, default DO Spaces" stat is a 5C polish task,
not a 5B requirement.

### Editor

**No changes for 5B.** The top-bar storage selector the user mentioned in
the Slice 5 list moves to 5C — it ships alongside the Polaris redesign so
the dropdown lives in a refreshed top-bar component, not the current ad-hoc
one. Captures continue to use the shop's default provider, no override.

## Edge cases & invariants

1. **Switching default while a capture is in flight.** The capture's
   `signRawUpload` already wrote a `rawKey` rooted in the default-at-the-
   time bucket and uploaded the zip to that bucket via signed PUT. The
   `processCapture` worker reads `loadDefaultStorageForShop` fresh when it
   picks up the job, which would now be a **different** bucket. To avoid
   pulling the raw zip from the wrong bucket, **the worker must remember
   which storage row was used**. Two ways to handle:

   - **Easiest**: add `storageId` (FK) to `Capture` and stamp it at
     `signRawUpload` time. Worker uses that specific storage row, not the
     current default.
   - **Lazier**: store enough of the URL prefix on `Capture.rawKey` that
     the worker can infer the right bucket. Brittle.

   Pick the easiest. Migration adds a nullable `Capture.storageId` FK; the
   worker falls back to the default if null (handles pre-5B rows).

2. **Deleting the row that's currently default while another exists**: see
   above — server picks the most-recently-updated remaining row as the new
   default.

3. **Deleting the only row**: allowed. Next capture fails with the existing
   "no storage configured" error path; merchant has to add a provider
   before uploading again.

4. **Provider value is part of uniqueness**: changing a row's `provider`
   from DO_SPACES → R2 isn't an edit; it's a delete+re-add. UI hides
   provider from the Edit flow (only Add lets you pick a provider).

5. **Test-connection on an in-progress edit**: the server's testConnection
   handler already accepts raw form values to test before save; that flow
   stays. New version threads `storageId` if present so we can reuse the
   saved keys when the merchant edits a row but doesn't re-enter keys.

6. **Capture-pipeline retry semantics**: if a `Capture` was created against
   a now-deleted `storageId`, the retry intent should fail with a helpful
   error (`"This capture's storage provider has been removed. Re-create the
   provider with the same bucket to retry, or delete the capture."`). The
   alternative — silently switching to the default — would silently move
   bytes to a different bucket, which is worse.

## Files that need to change

```
prisma/
  schema.prisma                                          # model changes
  migrations/20260513120000_multi_provider_storage/
    migration.sql                                        # NEW

app/lib/
  storage.server.ts                                      # rename + new helpers

app/routes/
  api.sdl3d.storage.tsx                                  # CRUD per row + setDefault + delete
  api.sdl3d.captures.tsx                                 # use default storage helper
  app.sdl3d.storage.tsx                                  # list-of-providers UI

app/lib/capture-pipeline/
  orchestrator.ts                                        # use default storage helper (+ stamp storageId on capture)
```

Optional follow-up touches:
- `app/components/Sdl3dRawCaptureUploader.tsx` — surface which storage was
  used in the "Done" state. Cheap UX improvement.
- `.env.example` — note that `STORAGE_ENC_KEY` rotation now affects multiple
  rows per shop. (Same operational concern as today, just multiplied.)

## Build / typecheck checklist

Standard from prior slices:

```bash
npx prisma generate
npx tsc --noEmit
npm run build              # catches React Router .server cross-import rule
```

Worker bundle must continue to import cleanly — orchestrator's storage
helper rename is the only file the worker pulls from this change.

## Staging smoke checklist (after deploy)

1. **Migration applies cleanly.** `docker logs sdl-3d-hotspots-staging |
   grep -i migrat` shows `20260513120000_multi_provider_storage` applied.
   `docker exec postgresql18 psql -U SDLView -d sdl3d_hotspots_staging
   -c '\d "ShopStorage"'` lists the new `isDefault` column.

2. **Existing row stayed the default.** SQL:
   ```
   SELECT id, provider, "isDefault" FROM "ShopStorage";
   ```
   Pre-5B row appears with `isDefault = true`.

3. **Captures still work end-to-end** against the (default) DO Spaces row.
   Run a small upload from the editor — same flow as Slice 3 smoke. No
   regression.

4. **Add a second provider** (e.g. an R2 row with bogus creds for testing;
   just need it to save and round-trip the form). The list renders both
   rows; DO Spaces stays the default.

5. **Set R2 as default** → DO Spaces flips to non-default in the same UI
   transaction. Reload the page; persistence holds.

6. **Set DO Spaces back to default** — repeat the round-trip.

7. **Delete the R2 row** — DO Spaces remains the default. List goes back
   to one item.

8. **Delete the last remaining row** — confirm dialog fires. After
   deletion, attempting a capture upload in the editor shows the standard
   "no storage configured" error with a link back to the Storage page.

9. **CLI smoke**: `sdl-360 captures upload …` continues to work against
   the shop's current default. No CLI changes needed in 5B.

## Backout strategy

If something regresses on the staging deploy:

1. `docker stop sdl-3d-hotspots-staging && docker rm
   sdl-3d-hotspots-staging`.
2. Roll the image back to the Slice 5A tag (the `6741368` build, or
   whatever tag the operator stamped during the prior deploy).
3. The migration is forward-compatible — old code reads `findUnique({
   shopId })` against a DB that now has a composite uniqueness instead of
   shop-only. Prisma will still find the row (since each pre-5B shop has
   exactly one), so the old code will function on the migrated schema. The
   `isDefault` column is just ignored by old code.
4. If a rollback drags on, you can drop the new column with `ALTER TABLE
   "ShopStorage" DROP COLUMN "isDefault"` and re-add the `shopId`
   uniqueness — but skip that unless really stuck. The forward-compat
   property means usually you don't need to.

## Out of scope for 5B (notes for future slices)

- **Editor top-bar storage selector** → Slice 5C, after Polaris migration
  ships the new top-bar component.
- **Per-product or per-upload storage override** → not committed to. The
  user picked the simplest model (shop default). If a merchant ever asks
  for per-product, revisit then.
- **Storage-page restyle / Polaris components** → 5C.
- **Storage-row deletion that also wipes the associated bucket prefix** →
  out of scope. Captures stay behind in the bucket; cleanup is the
  merchant's responsibility (matches "we never touch the merchant's bucket
  without their action" principle).
- **Cross-shop storage sharing** → not a feature; would conflict with
  the self-hosted-per-merchant deployment model.
