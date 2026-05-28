# BFA pilot setup — operator runbook

End-to-end recipe for standing up the BFA pilot on **DigitalOcean only**: App Platform hosts the embedded admin + worker, DO Spaces hosts the CDN frames, DO Managed Postgres holds app data.

This is the unbranded-build path (`APP_BRAND=bfa`). The same Git repo deploys two completely separate Shopify apps: SDL's existing app on `app.spectrumdesignlab.com`, and BFA's new one on a fresh App Platform URL. Updates flow to both with one `git push`.

Audience: SDL operator (Adam). For the merchant-facing version of capture/upload/publish steps, see [merchant-onboarding.md](merchant-onboarding.md).

**Pilot-specific values (already decided):**
- Merchant: Bar Fridges Australia
- Shopify admin: <https://admin.shopify.com/store/bar-fridges-au>
- myshopify domain: `bar-fridges-au.myshopify.com` (use for CORS allowlist + Partner app Distribution)
- Storefront custom domain: `bar-fridges-australia.com.au`
- Partner app `client_id`: `36f4ac369f6f2bea02b16d9016dc5bb2` (committed in [shopify.app.bfa.toml](../shopify.app.bfa.toml))
- DO region (all resources — Spaces, Postgres, App Platform): **SYD**
- Repo strategy: SDL keeps source ownership; BFA's App Platform builds from `Spectrum-Design-Lab/sdl-3d-hotspots`.

---

## What you're building

```
GitHub repo (main)
   │
   ├── build SDL image  (APP_BRAND=sdl) ──► Unraid / wherever ──► SDL dev store
   │                                         (existing setup)
   │
   └── build BFA image  (APP_BRAND=bfa) ──► DO App Platform ────► BFA store
                                                  │
                                                  ├── DO Managed Postgres
                                                  └── DO Spaces bucket (CDN)
```

One Partner Dashboard app per brand. One database per deployment. One bucket per deployment. The shared piece is the source code.

---

## Prerequisites checklist

Before starting:

- [ ] Access to BFA's DigitalOcean account (or a fresh team they own)
- [ ] A DNS record under your control for the App Platform URL (e.g. `app.bfa.example.com` CNAME → App Platform default URL). Optional — App Platform gives you `bfa-3d-hotspots-xxxxx.ondigitalocean.app` for free.
- [ ] Access to BFA's Shopify store as a staff member with "Apps and channels" permission, OR a transfer agreement that they will install the app on their store
- [ ] Your Shopify Partner account (the unbranded app gets registered under YOUR partner account — you keep ownership, BFA just installs it)

---

## Step 1 — Create the BFA Shopify Partner app

The pilot needs its **own** Partner Dashboard registration (separate `client_id`, separate scopes consent, separate webhook URLs).

1. Sign in to <https://partners.shopify.com> with your SDL Partner account.
2. **Apps** → **Create app** → **Create app manually**.
3. **App name**: `BFA 3D Hotspots` (or whatever brand label you want merchants to see during install).
4. **App URL**: leave blank for now — you'll come back after App Platform gives you a URL in Step 4.
5. **Allowed redirection URL(s)**: same — fill in later.
6. **App distribution**: **Custom distribution** (single merchant) — you'll get an install link to send BFA.
7. Click **Create app**. Note the **Client ID** and **Client secret** from the **Configuration** tab — you'll need them in Step 4.
8. Under **App setup** → **Protected customer data access** — skip; this app doesn't request customer data.

Leave this tab open; you'll come back to fill in the URLs after App Platform deploys.

---

## Step 2 — Set up DO Spaces (the CDN bucket)

This is the merchant's bucket — owned by BFA, billed to BFA's DO account. Follow the existing walkthrough verbatim:

→ **[merchant-onboarding.md — Part 2 / Option A (DigitalOcean Spaces)](merchant-onboarding.md#option-a--digitalocean-spaces-recommended)** (sections A.1 through A.4)

Notes specific to this pilot:

- **Bucket name**: `bfa-3d-hotspots` (or whatever — globally unique across DO Spaces).
- **Region**: pick whichever is closest to BFA's primary customer base. Region is permanent.
- **CORS Origin** entries to add — two separate rules:
  1. `https://bar-fridges-au.myshopify.com`
  2. `https://bar-fridges-australia.com.au`
  Without both, frames will fail to load on whichever origin is missing.
- **Save the Spaces access key + secret** immediately — DO shows the secret exactly once.

You'll wire these credentials into the app via the in-admin Settings → Storage page in Step 8, not via env vars. The encrypted-at-rest bucket credential goes in Postgres, keyed by `STORAGE_ENC_KEY`.

---

## Step 3 — Create DO Managed Postgres

1. DO control panel → **Databases** → **Create Database Cluster**.
2. **Engine**: PostgreSQL 16+.
3. **Plan**: **Basic — $15/mo (1 GB RAM, 10 GB disk)** is fine for one pilot. Scale up later if needed.
4. **Datacenter**: **same region as the App Platform app** (Step 4). Cross-region adds latency on every query.
5. **VPC**: pick (or create) the same VPC the App Platform app will use — gives you free private networking and removes the need to whitelist trusted sources.
6. **Database cluster name**: `bfa-3d-hotspots-db`.
7. Click **Create Database Cluster**. Wait ~5 min.
8. Cluster page → **Overview** → **Connection details** → switch the dropdown to **Connection string** → **Public network** (until App Platform is created) → copy the URI. Looks like:
   ```
   postgresql://doadmin:<pw>@bfa-3d-hotspots-db-do-user-xxxxx.k.db.ondigitalocean.com:25060/defaultdb?sslmode=require
   ```
9. Save this string — it's the `DATABASE_URL` for Step 4. You'll swap it to the private-VPC URL once App Platform is provisioned.

pg-boss creates its own tables in the same database. No separate DB needed.

---

## Step 4 — Deploy on DO App Platform

App Platform builds Docker from a GitHub repo on push.

### 4a. Make sure GitHub repo access is configured

App Platform needs to read the repo. Two options:
- **Easier**: keep the source in your existing `Spectrum-Design-Lab/sdl-3d-hotspots` repo and grant App Platform read access — DO's GitHub integration handles this.
- **Cleaner separation**: fork the repo into a BFA-owned GitHub org so BFA's App Platform team has direct access. Slightly more annoying because every update means a fork-sync.

Recommend keeping it in your existing repo for now — you control updates and can pull them at your pace.

### 4b. Create the App Platform app

1. DO control panel → **Apps** → **Create App**.
2. **Service Provider**: **GitHub** → authorize the repo `Spectrum-Design-Lab/sdl-3d-hotspots` (or your fork).
3. **Branch**: `main`. **Source directory**: `/`. **Autodeploy**: leave **on** (every push to main rebuilds).
4. DO detects the Dockerfile and offers a **Web Service** by default. Accept it.
5. **Edit** the service spec before continuing:
   - **Resource type**: Web Service. **Instance size**: Basic — $12/mo (1 GB RAM). Scale up only if the capture worker starts thrashing.
   - **HTTP port**: `3000` (matches `EXPOSE 3000` in the Dockerfile and `PORT=3000` env var).
   - **Run command**: leave default — Dockerfile's `CMD` already invokes `npm run docker-start` which spawns both the web tier AND the pg-boss worker in the same container.
   - **Build command**: leave default. App Platform reads the Dockerfile.
   - **Dockerfile build args**: add **`APP_BRAND=bfa`**. This is the critical line — without it the container builds with SDL branding. ([Dockerfile:8](sdl-3d-hotspots/Dockerfile#L8) wires the build-arg into `VITE_APP_BRAND`, which Vite inlines at build time.)
6. **Environment variables** (mark each as Secret unless noted; values from Steps 1–3):

   | Key | Value | Notes |
   |---|---|---|
   | `SHOPIFY_API_KEY` | `<client_id from Step 1>` | Not secret per se but treat as one |
   | `SHOPIFY_API_SECRET` | `<client_secret from Step 1>` | **Secret** |
   | `SHOPIFY_APP_URL` | `https://${APP_DOMAIN}` | Use the App Platform variable so it picks up the right hostname automatically |
   | `SCOPES` | `write_metaobject_definitions,write_metaobjects,write_products,read_files,write_files,write_app_proxy` | Must match `shopify.app.bfa.toml` exactly when you create it in Step 5 |
   | `DATABASE_URL` | `<connection string from Step 3>` | **Secret**. Use the private VPC URL once available. |
   | `STORAGE_ENC_KEY` | `<openssl rand -hex 32>` | **Secret**. Generate fresh — DO NOT reuse SDL's. Losing it bricks every stored bucket credential. Back up to a password manager. |
   | `PORT` | `3000` | Plain |
   | `NODE_ENV` | `production` | Plain |
   | `APP_BRAND` | `bfa` | Plain. Belt-and-braces — already set as a build-arg, but App Platform also surfaces this as a runtime env so [brand.ts](sdl-3d-hotspots/app/lib/brand.ts) picks it up if Vite ever fails to inline. |
   | `DEPLOYMENT_NAME` | `bfa-pilot` | Plain. Shows up in `/api/health` for ops triage. |
   | `SENTRY_DSN` | (optional) | Add later if you want BFA errors flowing into Sentry; can be the same DSN as SDL with `SENTRY_ENVIRONMENT=bfa-pilot` to split events. |

7. **App name**: `bfa-3d-hotspots`.
8. **Region**: same as Postgres + Spaces.
9. **Create Resources**. First build takes ~5–10 min.
10. Once green, copy the **Live App URL** (e.g. `https://bfa-3d-hotspots-xxxxx.ondigitalocean.app`). This is your `SHOPIFY_APP_URL`.
11. (Optional) Add a custom domain via App Platform → Settings → Domains → `app.bfa.example.com`. App Platform handles the TLS cert automatically.

### 4c. Go back to the Shopify Partner app and fill in URLs

In the Partner Dashboard app you created in Step 1:

- **App URL**: `https://<your-app-platform-domain>`
- **Allowed redirection URL(s)**: `https://<your-app-platform-domain>/api/auth`
- **Save**.

---

## Step 5 — Add `shopify.app.bfa.toml` to the repo

This is the only Shopify-CLI-level config the BFA app needs. It tells `shopify app deploy` which Partner app to push the Theme App Extension under.

Create `shopify.app.bfa.toml` (mirror of `shopify.app.toml` with BFA's identifiers):

```toml
client_id = "<client_id from Step 1>"
name = "bfa-3d-hotspots"
application_url = "https://<your-app-platform-domain>"
embedded = true

[build]
automatically_update_urls_on_dev = false

[webhooks]
api_version = "2026-04"

  [[webhooks.subscriptions]]
  topics = [ "app/uninstalled" ]
  uri = "/webhooks/app/uninstalled"

  [[webhooks.subscriptions]]
  topics = [ "app/scopes_update" ]
  uri = "/webhooks/app/scopes_update"

[access_scopes]
scopes = "write_metaobject_definitions,write_metaobjects,write_products,read_files,write_files,write_app_proxy"

[app_proxy]
url = "/proxy/sdl3d"
prefix = "apps"
subpath = "sdl3d"

[auth]
redirect_urls = [ "https://<your-app-platform-domain>/api/auth" ]
```

The `app_proxy` block keeps the existing `/apps/sdl3d` storefront path so the TAE viewer can reach the app for live-fetch mode. Don't rename the subpath — would force re-publishing every product config that uses app-proxy mode (rare for this pilot since metafield mode is the default).

Commit it but **do not** check in `client_id` if your repo is public. For a private repo this is fine. If the repo becomes public later, move `client_id` out and pull it from env at deploy time.

```bash
git add shopify.app.bfa.toml
git commit -m "chore(deploy): add BFA pilot shopify.app config"
git push origin main
```

App Platform will autobuild on push.

---

## Step 6 — Deploy the Theme App Extension under the BFA app

The TAE is shared code but registered per Shopify Partner app. You need to push it once under the BFA app's `client_id` so BFA's store can see the block in their Theme Customizer.

From your local working copy:

```bash
# Point the Shopify CLI at the BFA app config
npm run shopify -- app config use shopify.app.bfa.toml

# Build + ship the TAE assets (viewer.js, viewer-3d.js, viewer-360.js, viewer.css, liquid block)
npm run deploy

# Switch back to the SDL config so your next `npm run dev` / deploy targets SDL
npm run shopify -- app config use shopify.app.toml
```

`npm run deploy` runs `shopify app deploy` which:
1. Reads the active `shopify.app.*.toml`.
2. Bundles `extensions/product-3d-viewer/` (assets + liquid + locale).
3. Uploads + creates a new app version under that Partner app.
4. Prompts you to **release** the version — say yes.

Until you do this once per app, BFA's storefront has no theme block to add.

You'll re-run this any time you change anything under `extensions/` or `tae-src/`. The web tier on App Platform redeploys automatically on git push; TAE is the manual step.

---

## Step 7 — Install on BFA's Shopify store

1. Partner Dashboard → BFA app → **Distribution** → copy the **Install link** (custom-distribution apps don't appear in the App Store).
2. Send the install link to BFA.
3. BFA clicks → consents to scopes → app appears in their **Apps & sales channels** list as "BFA 3D Hotspots" (per Step 1 naming).
4. BFA opens the app — they see the onboarding wizard. Step 4 of the wizard says "Add the **3D product viewer** block to your theme" — note it's brand-neutral (the liquid schema name shipped that way; see [brand.ts](sdl-3d-hotspots/app/lib/brand.ts) for why).
5. BFA goes to **Online Store** → **Themes** → **Customize** → product template → **Add block** → finds "3D product viewer" under "Apps" → places it.

---

## Step 8 — Wire BFA's bucket into the app

In BFA's embedded admin:

1. **Settings** → **Storage** → **Connect bucket**.
2. **Provider**: DigitalOcean Spaces.
3. **Space URL**: paste their full DO Space origin (e.g. `https://bfa-3d-hotspots.fra1.digitaloceanspaces.com`). The form auto-extracts endpoint + region + bucket.
4. **Access Key ID** + **Secret Access Key**: paste from Step 2.
5. **Public base URL**: leave blank to use the raw Space, OR set to a CDN/custom-domain URL.
6. **Mark as default** — yes (only one bucket, no per-product overrides needed for this pilot).
7. **Save**.

The credentials are encrypted with `STORAGE_ENC_KEY` before hitting Postgres. From this point on, every capture upload from BFA's admin lands in their bucket; the metafield URLs the app writes point straight at their bucket.

---

## Step 9 — Run a smoke test

Drive one product end-to-end before handing off:

1. **Editor** → pick a product.
2. **Add media** → **Upload raw capture** → drop a small folder of test frames (24–72 photos). Worker should:
   - Show a progress card with frame count + validation report.
   - Upload to BFA's Space (verify by opening the Space in DO panel — frames appear under `<product-id>/`).
3. Add 1–2 hotspots, set titles + body.
4. **Publish**. Check the Settings → Sync Activity log shows SUCCESS.
5. Open the product PDP on the storefront — the 3D product viewer block should render with the 360° sequence and hotspots.

If any step fails, check `/api/health` for env-var presence and the **Failed captures** card on the Dashboard for worker errors.

---

## Step 10 — Hand off to BFA

After smoke test passes, send BFA:

- The link to **[merchant-onboarding.md — Part 4 (Upload a product capture)](merchant-onboarding.md#part-4--upload-a-product-capture) onward**. They can ignore Parts 1–3 (you've already done them).
- Where to find the embedded admin (Apps → BFA 3D Hotspots in their Shopify admin).
- Who to ping when they get stuck (you, presumably).

They do not need:
- DigitalOcean credentials (the app talks to their bucket via the credentials stored encrypted in the app DB)
- App Platform access
- Postgres access
- Shopify Partner access

If they want to take over hosting later, the migration path is: dump Postgres → restore on their infra → swap `SHOPIFY_APP_URL` in Partner Dashboard → reinstall.

---

## Updates flow

When you push to `main`:

1. Both Unraid (SDL) and App Platform (BFA) detect the push.
2. Unraid rebuilds with `APP_BRAND=sdl` (default).
3. App Platform rebuilds with `APP_BRAND=bfa` (set as a build-arg in Step 4b).
4. Both containers restart with the new code.

Caveats:
- **Schema changes**: Prisma migrations run on container start via `npm run setup` (in [scripts/start.js](sdl-3d-hotspots/scripts/start.js)). Both DBs migrate independently — no coordination needed.
- **TAE changes**: NOT automatic. After any change under `extensions/` or `tae-src/`, you must:
  ```bash
  npm run shopify -- app config use shopify.app.toml  && npm run deploy   # SDL
  npm run shopify -- app config use shopify.app.bfa.toml && npm run deploy # BFA
  npm run shopify -- app config use shopify.app.toml                       # switch back
  ```
- **Breaking changes**: deploy to SDL first, validate on the dev store, THEN let App Platform auto-pull. If you need to pause BFA's autodeploy, App Platform → Settings → toggle Autodeploy off; manually trigger from the Deployments tab when ready.

---

## Cost summary

| Component | Plan | Monthly |
|---|---|---|
| App Platform (Basic) | 1 vCPU / 1 GB RAM | $12 |
| Managed Postgres (Basic) | 1 GB RAM / 10 GB | $15 |
| DO Spaces | 250 GB + 1 TB transfer | $5 |
| **Total** | | **~$32/mo** |

If BFA needs more than ~50 products with 360° captures, bump App Platform to Pro ($25/mo) for the worker headroom.

---

## Rollback

If a deploy breaks BFA's app:

1. App Platform → **Deployments** tab → find the previous green deploy → **Rollback**.
2. Verify the embedded admin loads.
3. Investigate, fix, push.

The DB is forward-compatible across one or two recent versions (Prisma migrations don't auto-revert). If a migration is the cause of the break, you'll need to either fix-forward or restore Postgres from DO's automated backups (daily, retained 7 days on Basic plan).

---

## Useful links

- Existing generic onboarding doc: [merchant-onboarding.md](merchant-onboarding.md)
- Brand module: [app/lib/brand.ts](../app/lib/brand.ts)
- Dockerfile (where `APP_BRAND` becomes `VITE_APP_BRAND`): [Dockerfile](../Dockerfile)
- TAE liquid block (schema `name` is brand-neutral): [extensions/product-3d-viewer/blocks/product-3d-viewer.liquid](../extensions/product-3d-viewer/blocks/product-3d-viewer.liquid)
- SDL app config (for reference): [shopify.app.toml](../shopify.app.toml)
