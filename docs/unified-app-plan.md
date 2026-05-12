# Unified Shopify App — Embed `sdl-platform` into `sdl-3d-hotspots`

> **Status**: Planning. Not yet implemented. Author: SDL + Claude collaboration, 2026-05-04.

## Why this work exists

Today the SDL ecosystem has two halves:

- **`sdl-3d-hotspots`** — the Shopify embedded admin app the merchant installs. Reads metafields, renders the viewer, owns hotspot placement. Origin-agnostic.
- **`sdl-platform`** — internal SDL tooling: a CLI + Next.js dashboard that processes raw turntable photos / GLB files, uploads them to a CDN bucket, and writes the resulting URLs into Shopify product metafields.

The split made sense as separate iteration tracks but produces a clunky merchant experience. Today the merchant has to:

1. Install the Shopify app
2. Email SDL their DO Spaces credentials
3. Send SDL their raw captures
4. Wait while SDL operates the platform pipeline on their behalf
5. Open the app to place hotspots
6. Add the theme block

The unified app collapses steps 2–4 into "merchant configures their bucket once in the app, then uploads captures directly through the embedded admin." That's the long-term product shape; the platform pipeline becomes invisible plumbing inside the Shopify app rather than a separate SDL-operated tool.

## The "one app" mandate

Beyond just embedding the pipeline, the entire hub is folded into the Shopify app. Every feature the dashboard had is per-merchant work; nothing in it was inherently cross-merchant from the merchant's perspective. So:

- **Dashboard UI** (product binding, capture history, refresh buttons, settings) → becomes routes inside the embedded admin app. PRD-#### bookkeeping disappears; everything attaches directly to the Shopify product.
- **`@spectrum-design-lab/core-360` pipeline logic** → moves into `app/lib/capture-pipeline/` and runs on the app's worker process.
- **`@spectrum-design-lab/cli-360`** → reshaped as a thin client that calls the deployed app's API endpoints. Stays useful for SDL ops (debugging, batch operations from a laptop) and dev workflows. No longer carries a copy of the pipeline.
- **`@spectrum-design-lab/shared`** → unchanged. Schema source of truth, consumed via GitHub Packages by both the app and the CLI.
- **`@spectrum-design-lab/dashboard`** → archived after the embed work lands.

For SDL's eventual SaaS deployment, an SDL-only `/admin` route gives staff a cross-merchant view (capture failures, error rates, version reporting). Email-allowlist protected, only meaningful on SDL's host, never visible to self-hosted clients. Phase 2, post-pilot.

End state: **one Shopify app the merchant interacts with**, end-to-end. SDL has dev tooling on their laptop (CLI, optional admin route) but nothing that's part of the merchant's experience.

## Distribution model — dual: self-hosted (first client) + SaaS (everyone after)

The same codebase ships in two distribution shapes:

| Mode | Who it's for | Who hosts | Who's the data processor | Partner-Dashboard app lives in |
|---|---|---|---|---|
| **Self-hosted** | The first pilot client (and any future customer who specifically wants data sovereignty) | The merchant — VPS / droplet on their own infrastructure, managed by their IT team with SDL setup help | The merchant (for themselves) | Merchant's Partner account |
| **SaaS** | Everyone else | SDL — single shared multi-tenant deployment | SDL (for many merchants, scoped by `shopId`) | SDL's Partner account |

This is **two separate Partner-Dashboard apps from Shopify's perspective** (each Shopify Partner app pins exactly one `application_url`, redirect URL, app proxy URL, and webhook target). The Shopify CLI supports this cleanly via multiple `shopify.app.*.toml` files switched with `shopify app config use`. Same Docker container, same code, two deployment targets, two sets of env vars.

### What the architecture has to do to support both

- **No code path can assume which mode it's in.** All multi-tenant scoping is by `shopId` whether one shop or many exist in the DB.
- **No phone-home from the deployed app to SDL infrastructure.** Self-hosted deployments must function with zero SDL runtime dependency. SaaS deployments don't need anything beyond what a self-hosted one already does.
- **No centralized services.** Anything the app talks to (Postgres, the merchant's bucket, Shopify) must be configurable per-deployment. SDL can't add features that depend on an SDL-only backend.
- **Same release cadence.** When SDL ships a new version, the SDL-hosted SaaS gets it via SDL's CI/CD; self-hosted clients pull and redeploy on their schedule.

### What each mode runs

**Self-hosted (pilot client today; potential future enterprise customers):**

| Service | Where | What it stores |
|---|---|---|
| Web tier + worker + Postgres + queue | Merchant's VPS / droplet | Their own data only — single `shopId` in the DB, single `ShopStorage` row, all theirs |
| Bucket | Merchant's DO Spaces | Their assets |
| Shopify store + metafields | Shopify (theirs) | Their product config, published rendered config |

The merchant's IT team handles ops; SDL helps during initial setup and on release upgrades.

**SaaS (everyone after the pilot, on SDL's infrastructure):**

| Service | Where | What it stores |
|---|---|---|
| Web tier + worker + Postgres + queue | SDL's host (Fly.io / DO App Platform / VPS) | Many merchants' data scoped by `shopId` — sessions, ProductConfigs, encrypted ShopStorage credentials |
| Bucket | Each merchant's own (DO Spaces / S3 / R2 / Bunny / Shopify Files) | Their assets — never on SDL's host |
| Shopify store + metafields | Shopify (theirs) | Their product config, published rendered config |

SDL operates the host, manages the encryption key (`STORAGE_ENC_KEY`), maintains uptime, ships releases, monitors errors. Standard SaaS responsibilities.

### Implications to be clear about

- **Launch posture: custom-install only; App Store listing is Phase 2.** The pilot ships via direct custom-distribution install links from each Partner-Dashboard app. After the pilot validates the architecture and revenue model, SDL pursues App Store listing for the SaaS deployment specifically (not for self-hosted, which is direct-sales by definition). Listing prep is its own track: App Store review, billing integration, GDPR mandatory webhooks (`customers/data_request`, `customers/redact`, `shop/redact`), listing assets, support contact. Roughly 1–2 weeks of work whenever it's prioritized.
- **The pilot client never migrates.** They stay on their self-hosted deployment forever, by their own preference. That's a feature, not a debt — it's the data-sovereignty enterprise tier.
- **SaaS mode doesn't exist until needed.** SDL's infrastructure (host, Postgres, encryption key) gets stood up when the second customer is signed up, not before. The pilot doesn't need it. Codebase already supports it.

### Cost estimates

**For the pilot client (their bill):** ~$15–30/month for a small DO droplet + Managed Postgres + their existing DO Spaces. Comparable to any moderately-sized Node app.

**For SDL's SaaS deployment (when it spins up):** ~$5–20/month at 1–2 merchants, ~$30–50/month at 10 merchants. Sharp workloads are CPU-spiky but bounded; Postgres at this scale stays small. Cloudflare DNS free.

## Architecture decisions (locked in)

| Concern | Choice | Reasoning |
|---|---|---|
| Job queue | `pg-boss` | Postgres-backed (no Redis ops), mature, ~50 lines to wire. Already running Postgres for the app. |
| Worker placement | Same Docker container, separate Node process, started by `docker-start` | Simplest deploy. The job interface is what application code touches; worker can split into its own container later without code changes. |
| Encryption at rest | AES-256-GCM, key in `STORAGE_ENC_KEY` env var (32-byte hex) | Standard Node `crypto`, no extra deps. |
| Storage SDK | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` | One API works against DO Spaces, R2, S3, Bunny. Signed URLs are first-class. |
| Upload pattern | Browser → bucket direct via signed PUT URLs; never browser → app server → bucket | Web tier never sees raw capture bytes. Cleanest for scale, security, cost. |
| Job-status UX | Polling (`fetcher.load` every 2s while a job is in flight) | SSE is nicer but adds infra; polling is fine for pilot scale. Easy to upgrade later. |
| Capture model | New `Capture` Prisma model — one product can have N captures over time, latest published wins | Lets the merchant re-capture without losing history. Replaces the `PRD-####` concept entirely. |

## Data-model changes

```
ShopStorage              (new)
  shopId                 (unique — one bucket per shop)
  provider               enum: DO_SPACES | S3 | R2 | BUNNY | SHOPIFY_FILES
  endpoint               string (e.g. fra1.digitaloceanspaces.com)
  region                 string
  bucket                 string
  accessKeyEncrypted     bytes  (AES-256-GCM)
  secretKeyEncrypted     bytes  (AES-256-GCM)
  publicBaseUrl          string nullable  (CDN base for served URLs)
  testedAt               datetime nullable
  createdAt, updatedAt

Capture                  (new)
  id                     cuid
  productConfigId        FK
  status                 enum: PENDING | UPLOADING | QUEUED | PROCESSING | COMPLETED | FAILED
  rawKey                 string         (S3 key under shopId/captures/<id>/raw.zip)
  rawSizeBytes           int nullable
  frameCountTarget       int            (e.g. 72)
  frameCountActual       int nullable
  processedManifestKey   string nullable (S3 key for processed frame list)
  errorMessage           string nullable
  startedAt              datetime nullable
  completedAt            datetime nullable
  createdAt, updatedAt

pg-boss tables           (auto-managed by pg-boss on first run)
```

`ProductConfig.imageSequenceJson` continues to hold the published frame array (no schema change). The `Capture` model is the audit trail and processing handle; once a capture completes, its processed URLs are written into the existing `imageSequenceJson` field.

**Capture retention policy:** old captures stay in the merchant's bucket and the DB by default — supports rollback if a new capture is bad. Manual deletion (single capture or "purge older than X") added as a follow-up feature when a merchant actually asks for it. No automatic deletion in v1.

## Code structure

```
app/
  routes/
    app.sdl3d.storage.tsx          (new — settings page)
    api.sdl3d.storage.tsx          (new — save / test connection)
    api.sdl3d.captures.tsx         (new — sign URL / record / status)
  lib/
    storage.server.ts              (new — StorageBackend interface + S3-compatible impl)
    storage-encryption.server.ts   (new — AES-256-GCM helpers)
    queue.server.ts                (new — pg-boss wrapper, enqueue + handlers)
    capture-pipeline/              (new directory — lifted from core-360)
      scanner.ts                   (validate raw uploads)
      sampler.ts                   (resample to target frame count)
      converter.ts                 (sharp pipeline)
      uploader.ts                  (uses StorageBackend interface)
      orchestrator.ts              (top-level processCapture(captureId) job)
worker/
  index.ts                         (new — separate Node process; registers pg-boss handlers)
prisma/
  schema.prisma                    (add ShopStorage, Capture)
  migrations/                      (new migration generated)
package.json                       (new dep: pg-boss, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, sharp; new script: worker)
Dockerfile                         (CMD changes to start both web + worker)
```

## Slicing — four independently shippable pieces (~2.5 weeks total)

**Process:** each slice is merged to `main` as it ships (no long-running feature branch — too easy to accumulate conflicts), and each slice is deployed to the staging Unraid server when it merges. Slice 1 alone is worth deploying — gives a real Settings page to walk the pilot client through during kickoff, before any heavy work lands.

### Slice 1 — Storage settings + encryption (~1.5 days)

- Prisma migration adding `ShopStorage`.
- `app/lib/storage-encryption.server.ts` — AES-256-GCM `encrypt(plaintext)` / `decrypt(ciphertext)` helpers reading `STORAGE_ENC_KEY`.
- `app/lib/storage.server.ts` — `StorageBackend` interface (`headBucket`, `signPutUrl`, `getObject`, `putObject`, `listObjects`) and `S3CompatibleBackend` impl using the AWS SDK.
- `app.sdl3d.storage.tsx` — form for provider / endpoint / region / bucket / access key / secret key / public base URL. "Test connection" button.
- `api.sdl3d.storage.tsx` — `saveCredentials` action (encrypts then upserts), `testConnection` action (decrypts, runs `headBucket`).
- Add `STORAGE_ENC_KEY` to `.env` and the deployment env-var list.
- New `/api/health` endpoint (no auth, no shop scope) returning JSON: `{ status, version, commit, deployment, uptime }`. Lets bug reports identify which version is running on which deployment. ~20 lines.

End state: a merchant can configure their bucket and confirm the credentials work, and any deployment can be queried for its version. Nothing else changes yet.

### Slice 2 — Queue + storage abstraction + multi-tenant pipeline (~3 days)

- `npm install pg-boss @aws-sdk/client-s3 @aws-sdk/s3-request-presigner sharp`.
- `app/lib/queue.server.ts` — `pg-boss` singleton, helpers `enqueue(jobName, data)` and (worker-side) `register(jobName, handler)`.
- `worker/index.ts` — separate Node process, boots Prisma + pg-boss, registers handlers.
- `Dockerfile` `CMD` changes to start both web and worker (e.g. via a small `scripts/start.sh` or `concurrently`).
- Lift `core-360`'s scanner / sampler / converter / uploader logic into `app/lib/capture-pipeline/`. Refactor every public function to take a `ProcessingContext` parameter:
  ```ts
  type ProcessingContext = {
    shopId: string;
    storage: StorageBackend;
    shopify: AdminGraphqlClient;
    prisma: PrismaClient;
  };
  ```
- `app/lib/capture-pipeline/orchestrator.ts` exposes `processCapture(ctx, captureId)` which is the worker's job handler.
- No UI yet — Slice 2 is purely groundwork verifiable by manually enqueueing a stub job.

End state: a worker process runs alongside the web tier, picks up jobs from a Postgres-backed queue, and the multi-tenant pipeline can be invoked with any shop's context.

### Slice 3 — Capture upload + end-to-end processing (~5–7 days)

- Prisma migration adding `Capture`.
- `api.sdl3d.captures.tsx`:
  - `signRawUpload` — returns a signed PUT URL for `<shopId>/captures/<captureId>/raw.zip`.
  - `recordRawUpload` — creates the `Capture` row, enqueues a `processCapture` job.
  - `getStatus` — returns the `Capture` row for polling.
- **`CLI_ADMIN_TOKEN` env var on the deployed app + dual-auth on API endpoints.** All `/api/sdl3d/*` routes accept either a normal Shopify embedded session (browser) or `Authorization: Bearer <CLI_ADMIN_TOKEN>` header (CLI / scripts / integration tests). Single shared secret per deployment; rotation is the operator's job. Implementing this in Slice 3 (rather than Slice 4) makes the new API surface scriptable from day one and is small (~3 hours of work).
- `worker/index.ts` registers `processCapture` handler that:
  1. **Idempotency check** — reads `Capture.status` first and bails immediately if already `COMPLETED` or `FAILED`. Protects against pg-boss double-delivery edge cases (timed-out worker resurrects after the job's already been redelivered).
  2. Loads `Capture` + `ShopStorage` + Shopify admin client for the shop.
  3. Downloads raw bytes from merchant's bucket (signed GET).
  4. Unpacks ZIP, runs scanner → sampler → sharp converter.
  5. Uploads processed frames back to `<shopId>/captures/<captureId>/frames/...` in the merchant's bucket.
  6. Writes the resulting frame array into `ProductConfig.imageSequenceJson`.
  7. Optionally publishes draft metafields (or leaves it for the merchant to publish manually from the editor — TBD per UX).
  8. Marks `Capture.status = COMPLETED`. On error, `FAILED` + `errorMessage`.
- Editor UI: new "Upload raw captures" button, file picker, progress states (signing → uploading → queued → processing → done). Polls `getStatus` while the capture is in flight.
- Wire failure paths: capture stuck in `PROCESSING` for too long → surfaced as a re-tryable error in the editor.

End state: from the merchant's POV, they install the app → connect their bucket once → in the editor for any product, they upload a folder of raw turntable photos → wait a minute → frames are processed and the viewer renders. Fully self-serve.

### Slice 4 — CLI thin-client refactor + sdl-platform archival (~1.5 days)

- (`CLI_ADMIN_TOKEN` and dual-auth on API endpoints already shipped in Slice 3.)
- Refactor `@spectrum-design-lab/cli-360` to call the deployed app's REST endpoints rather than running `core-360` locally. Commands map to API calls:
  - `cli-360 captures upload <productGid> <folder>` → `POST /api/sdl3d/captures/sign` then PUT to bucket then `POST /api/sdl3d/captures` then poll status.
  - `cli-360 captures retry <captureId>` → `POST /api/sdl3d/captures/:id/retry`.
  - `cli-360 products refresh <productGid>` → `POST /api/sdl3d/products/:gid/refresh-cache`.
  - All commands take `--app-url` and `--token` flags (or env vars `SDL_APP_URL`, `SDL_CLI_TOKEN`).
- Remove `@spectrum-design-lab/core-360` import from `cli-360`.
- Archive `@spectrum-design-lab/core-360`: bump version to a `*-deprecated` tag, mark `private: true` in `package.json`, add a `DEPRECATED.md` pointing at the new location in the hotspot app.
- Archive `@spectrum-design-lab/dashboard`: same treatment. The `:3360` dev script in `sdl-platform` still works for now but the package is marked deprecated.
- Update `sdl-platform`'s top-level README to reflect the new shape: `shared` + `cli-360` are the only living packages.

End state: `sdl-platform` is reduced to two packages (`shared` + reshaped `cli-360`). Everything else lives inside the Shopify app. SDL ops can still drive captures from the laptop using `cli-360` against any deployment URL (pilot client's, SDL's SaaS, or local dev).

## What happens to `sdl-platform` after this lands

- **`@spectrum-design-lab/shared`** — stays as-is. Schema source of truth, consumed by the hotspot app via GitHub Packages and (still) by `cli-360`.
- **`@spectrum-design-lab/core-360`** — the implementation moves into the hotspot app's `app/lib/capture-pipeline/`. **Archived as part of this work** once `cli-360` is migrated off it (Slice 4).
- **`@spectrum-design-lab/cli-360`** — reshaped as part of this work into a thin API client that calls the deployed app's endpoints (`POST /api/sdl3d/captures`, etc.) instead of running the pipeline itself. Useful long-term for SDL ops, batch operations, and dev workflows.
- **`@spectrum-design-lab/dashboard`** — **archived as part of this work** once the embedded admin covers all its features (after Slice 3). Its surfaces are replaced by routes in the Shopify app for the merchant view, plus an optional SDL-only `/admin` route in the SaaS deployment for cross-merchant support.

**Sequencing of the cleanup:** Slices 1–3 do the embedding work without touching `sdl-platform` (so the existing pilot loop keeps running unchanged in case we need to roll back any individual slice). Slice 4 then does the CLI refactor + archival in one focused commit, after the embedded admin can independently do everything `core-360` and `dashboard` did.

## Deployment runbook — what SDL hands the pilot client's IT team

This is what SDL produces alongside the embedding work, so the pilot client's IT team can stand up the deployment when the code is ready. SDL doesn't run any of this; SDL writes the doc and helps during initial setup. **For SDL's SaaS deployment (Phase 2, when the second customer arrives), the same runbook applies — SDL just follows it themselves on SDL's host.**

### Prerequisites the merchant provides

- A VPS / droplet (4 GB RAM minimum for sharp workloads, 8 GB recommended). DigitalOcean droplet is the assumed default given the pilot client is already on DO.
- A Postgres database. Easiest: DigitalOcean Managed Postgres in the same region (~$15/mo).
- A subdomain pointed at the VPS (e.g. `shopify-app.client-domain.com`). Cloudflare DNS recommended for free TLS termination + DDoS, but any DNS provider works.
- A DigitalOcean Spaces bucket (the same one the storefront viewer reads from).
- A Shopify Partner account in the merchant's name.

### One-time setup steps (SDL helps the IT team through these)

1. **Provision the VPS, install Docker + docker-compose.**
2. **Create the Shopify Partner-Dashboard app** in the merchant's Partner account. Configure:
   - `application_url` = their chosen subdomain.
   - Redirect URL = `https://{subdomain}/api/auth`.
   - App proxy = `https://{subdomain}/proxy/sdl3d`, prefix `apps`, subpath `sdl3d`.
   - Webhooks to `/webhooks/app/uninstalled`, `/webhooks/app/scopes_update`.
   - Required access scopes (same as `shopify.app.toml` today).
   - Capture the `client_id` and `client_secret` for the env file.
3. **Pull the codebase** to the VPS via `git clone` from the public GitHub repository (`https://github.com/spectrum-design-lab/sdl-3d-hotspots`). The codebase is open for the merchant's IT team to audit and customize as they see fit.
4. **Create `.env`** from `.env.example` with values for:
   - `SHOPIFY_API_KEY` (from the Partner app)
   - `SHOPIFY_API_SECRET` (from the Partner app)
   - `SHOPIFY_APP_URL=https://{subdomain}`
   - `SCOPES=...` (matches the Partner app config)
   - `DATABASE_URL` (their managed Postgres URL)
   - `STORAGE_ENC_KEY` (32-byte hex — generated once with `openssl rand -hex 32`, never changes)
   - Optionally `SDL_NOTIFY_WEBHOOK_URL` for failure alerts to Slack/Discord/etc.
5. **Bring up the stack** with `docker compose up -d` (or `docker run` for a single container; the Dockerfile already builds correctly).
6. **Run migrations**: `docker compose exec app npm run setup` (already runs `prisma migrate deploy`).
7. **Generate the install link** in the Partner Dashboard → Distribution → Custom distribution → enter their `.myshopify.com` domain. Click the link, OAuth, app installs.
8. **Walk through the onboarding flow** with the merchant on a screen-share to verify everything works end-to-end.

### Update process (recurring)

When SDL ships a new release:
- SDL emails the merchant's IT contact with the version tag, what changed, and any migration considerations. (No "phone home" version-check inside the app — that would contradict the no-runtime-dependency-on-SDL principle.)
- Merchant's IT team runs `git pull && docker compose up -d --build` on the VPS.
- Migrations apply automatically on container start (`prisma migrate deploy`).
- Brief downtime during container restart (~10 seconds). Schedulable for off-hours.

### Secrets management

The pilot deployment uses a plain `.env` file at the project root with `chmod 600` permissions. SDL hands the merchant's IT team a checklist of values they need to set during onboarding.

**Critical:** the IT team must store a copy of the `.env` file (or at least the `STORAGE_ENC_KEY` and `SHOPIFY_API_SECRET` values) **off-server** in their secrets manager of choice — 1Password, Bitwarden, an encrypted file in their backup S3, whatever they normally use. If the VPS is rebuilt and `STORAGE_ENC_KEY` is lost, every encrypted `ShopStorage` row becomes unreadable, and the merchant has to re-enter their bucket credentials. Not catastrophic but annoying.

For an enterprise deployment that wants something more sophisticated (HashiCorp Vault, Doppler, AWS Secrets Manager), the codebase reads env vars in the standard way — any secrets manager that injects them at process start will work without code changes. Pilot doesn't need this.

### What SDL maintains as part of "supplying the software"

- This runbook, kept in sync with the code (versioned in `docs/deployment-runbook.md`).
- A `docker-compose.yml` in the repo that boots web + worker + (optional) local Postgres for dev.
- A `.env.example` covering every env var the app reads, with comments.
- **Staging deployment on SDL's home Unraid server**, exposed via Cloudflare Tunnel (`cloudflare/cloudflared` container) at `staging-app.spectrumdesignlab.com`. Used purely to test releases against `spec-test-2.myshopify.com` before telling merchants they're safe to update. Same Docker container + env-var shape as production deployments — Unraid's Docker is just Docker, so what works in staging works on the pilot client's DO droplet and on SDL's eventual SaaS host. Cost: $0 (sunk cost on the server, free Cloudflare tier).

### What SDL never does

- Operate the merchant's deployment.
- Hold copies of the merchant's database backups.
- Have shell access to the merchant's VPS (unless invited for a specific support call).
- Phone home from the deployed app to SDL infrastructure.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Sharp processing OOMs on large captures (e.g. 360 frames × 8 MB) | Stream from S3 → process one frame at a time → stream back. Don't buffer the whole capture in memory. |
| Worker crashes mid-job | `pg-boss` re-delivers jobs on worker restart. Capture goes back to `QUEUED`. Idempotent processing via Capture.id keying. |
| Merchant's bucket credentials wrong / bucket gone | Fail the job fast with a clear error message in `Capture.errorMessage`; surface in the editor with a "fix in Settings" deep link. |
| `STORAGE_ENC_KEY` rotation | Out of scope for v1. Document it as a known operational concern and add a key-versioning column when you actually need to rotate. |
| Big GLB files stress the same upload path | Same signed-URL flow. Worker for `.glb` is a no-op (just upload as-is + write `sdl_3d.model_file`). Doesn't need sharp. |
| Code accidentally adds a centralized SDL service that breaks self-hosted deployments | Self-hosted clients can't depend on SDL infrastructure. Code review checklist item: "does this feature require an SDL-controlled URL?" If yes, either redesign or make it merchant-configurable so self-hosted deployments fall back gracefully. |
| Self-hosted client falls behind on updates | Runbook + `docker compose pull && up -d` is ~minutes. Releases are infrequent and announce breaking changes loudly. Worst case: client runs an older version; the storefront viewer (metafield mode) is unaffected by their app version. |
| Two deployments (pilot + SDL SaaS) on different versions report conflicting bugs | Every release tagged. SDL keeps a staging deployment matching the latest release; bug reports include the deployment's version (surfaced via `/api/health`). |
| Multi-tenancy bug in SaaS deployment (shop A sees shop B's captures) | Every Prisma query in the new code paths must filter by `shopId`. Vitest integration test creating two shops + captures asserts isolation. Same code is single-tenant-safe in self-hosted mode (only one shop ever exists). |
| `STORAGE_ENC_KEY` rotation on SaaS deployment | Out of scope for v1. Add a key-versioning column when actually needed. Self-hosted deployments don't share this concern — they manage their own key. |

## What I need from you before starting

1. **Approve the data-model changes** above (`ShopStorage`, `Capture`).
2. **Confirm the dual-distribution model** — pilot client self-hosts on their DO infrastructure with their own Partner-Dashboard app; SDL hosts the SaaS deployment for everyone after, with a separate Partner-Dashboard app in SDL's account. SDL's host gets stood up later, when the second customer arrives.
3. **Generate `STORAGE_ENC_KEY` for the pilot deployment** — a 32-byte hex string. The pilot client's IT team can generate it during setup (`openssl rand -hex 32`); SDL generates a separate one for SDL's own SaaS host when that's stood up. Each deployment has its own key.
4. **Decide whether you want me to commit `core-360`'s archival as part of Slice 2**, or leave it alone in `sdl-platform` for now and just stop importing it.

Once those four are settled, I'll start Slice 1.
