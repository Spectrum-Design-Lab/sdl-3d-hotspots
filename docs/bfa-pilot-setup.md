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

The bucket is owned by BFA, billed to BFA's DO account. SDL's existing `sdl-cdn` bucket is the working template — this BFA setup mirrors its config.

### 2a. Create the bucket

1. DO control panel → **Spaces Object Storage** → **Create Bucket** (top-right).
2. **Choose a datacenter region** → **Sydney · Datacenter 1 · SYD1**.
3. **Choose a Storage type** → **Standard Storage** (Cold has 30-day minimum retention — bad fit for re-uploads).
4. **Content Delivery Network (CDN)** → leave **Enable CDN UNCHECKED**. CDN can be enabled later from Settings if BFA wants global edge caching; not needed for v1.
5. **Choose a unique Spaces Bucket name** → `bfa-3d-hotspots`. Lowercase, hyphens only, 3–63 chars. Globally unique across DO — pick a fallback (`bfa-3d-hotspots-au`?) if taken.
6. **Project** → `first-project` is fine (or create a `bfa-3d-hotspots` project to group resources).
7. Click **Create Spaces Bucket**.

The bucket's endpoint is now `https://bfa-3d-hotspots.syd1.digitaloceanspaces.com` — note it down; you'll paste it into the in-admin Settings → Storage form in Step 8.

### 2b. Tighten bucket settings

Click into the new bucket → **Settings** tab.

1. **File Listing** → **Edit** → **Disable**. The app never lists bucket contents; disabling is a free security win — without it, anyone with the bucket URL could enumerate every uploaded frame.
2. **Object Versioning** + **Access Logs** → leave Disabled (both are API-only toggles, neither is needed).
3. **CDN** → leave whatever you set in 2a.

### 2c. Create a scoped access key

Still on the bucket's Settings page → scroll to **Access Keys** section → **Create Access Key**.

1. **Access Key Name**: `bfa-3d-hotspots-app-key`.
2. **Scope**: this bucket only.
3. **Permissions**: **Read/Write/Delete** (the app needs delete to clean up superseded captures).
4. Click **Create Access Key**.
5. **Copy the Access Key ID AND Secret Access Key immediately into BFA's password manager.** The Secret is shown exactly once — if lost, generate a new key and delete the old one. There is no recovery flow.

Creating the key from the bucket's own Settings (rather than the global API → Spaces Keys page) auto-scopes it to just this bucket — principle of least privilege.

### 2d. Configure CORS

Still on the bucket's Settings page → **CORS Configurations** → **Add**.

Add **three rules** total. Each row in the CORS table is a separate "Add" click.

| # | Origin | Methods | Headers | Max Age |
|---|---|---|---|---|
| 1 | `https://bar-fridges-au.myshopify.com` | GET, HEAD | `*` | 3000 |
| 2 | `https://bar-fridges-australia.com.au` | GET, HEAD | `*` | 3000 |
| 3 | (your App Platform URL — **add after Step 4 completes**) | GET, PUT, HEAD, POST | `*` | 3000 |

Rules 1 + 2 are storefront origins (browsers fetching frames during shopping). Rule 3 is the admin upload origin (the embedded admin runs in the merchant's browser inside Shopify, but the actual XHRs that PUT files to the bucket come from the App Platform domain — they need PUT + POST). You can come back and add rule 3 the moment App Platform gives you a live URL in Step 4.

> **Why CORS matters here**: without rule 1 or 2, storefront browsers refuse to load `<img>` tags from the bucket and the viewer renders broken images. Without rule 3, the admin's upload flow fails preflight and merchants can't add captures.

### 2e. Where these credentials end up

You're NOT pasting the bucket key into App Platform env vars. The access key + secret get entered through the embedded admin's **Settings → Storage** form in Step 8 — the app encrypts them with `STORAGE_ENC_KEY` and stores them in Postgres. This is the same flow BFA would use themselves if they ever needed to rotate or add another bucket.

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

### 4b. Walk the App Platform "Create App" wizard

DO's wizard reveals all settings on one tall page. The order below matches the order to fix them in — quick UI changes first, then the slow blockers (Postgres provisioning), then the bulk env-var paste at the end so you only review the spec once before hitting submit.

> **Do not hit "Create Resources" until every item below is done.** App Platform starts billing + building immediately on submit; a half-configured spec wastes a build cycle.

1. DO control panel → **Apps** → **Create App** → **GitHub** → authorize `Spectrum-Design-Lab/sdl-3d-hotspots` → branch `main` → source directory `/` → **Autodeploy: on**.
2. DO auto-detects the Dockerfile and creates a default Web Service component. You now land on the spec page.

#### Quick UI fixes (do these first)

3. **Resource name** (top card, says `sdl-3d-hotspots` by default since DO names it after the repo) → click **Edit** → rename to **`bfa-3d-hotspots`**.
4. **Deployment settings → Run command** (defaults to "No run command defined") → click **Edit** → set to **`npm run docker-start`**. Matches the Dockerfile's CMD; explicit value removes ambiguity in the spec.
5. **Network** → confirm **Public HTTP port = 3000**, **HTTP request routes = 1** (root). No change needed; these come from the Dockerfile.
6. **Size**: confirm **Basic Shared CPU → $12/mo (1 GB RAM)**. Containers: 1. Autoscale: off. Scale up to Pro only if the capture worker starts thrashing.
7. **Datacenter region** → **Sydney (SYD1)**.
8. **App name** (Finalize section) — replace the auto-generated placeholder (something like `starfish-app`) with **`bfa-3d-hotspots`**.

#### Slow blocker: provision Postgres before continuing

9. **Database** card shows "Add a database". You need a `DATABASE_URL` before env vars can be filled in. Two paths:
   - If Step 3 (Managed Postgres) is already done → click **Attach DigitalOcean database** → pick `bfa-3d-hotspots-db`.
   - If not → open Step 3 in a new tab, provision (~5 min), come back here.
   - **Never click "Create dev database"** — those are ephemeral and lose all merchant data on every redeploy.
10. **VPC** → check the **Connect app to VPC network** box → pick the same VPC your Postgres lives in. This unlocks the private DB hostname (faster + no public DB egress + no firewall rule needed).

#### Environment variables (bulk paste at the end)

11. **Environment variables** card (component-level — under Network, NOT the "App-level environment variables" card lower down) → click **Edit** → add every row in the table below. App Platform's UI lets you toggle **Scope** (Run / Build / Run+Build) and **Encrypt** per row.

   | Key | Value | Scope | Encrypt |
   |---|---|---|---|
   | `APP_BRAND` | `bfa` | **Run and Build Time** | No |
   | `SHOPIFY_API_KEY` | `36f4ac369f6f2bea02b16d9016dc5bb2` | Run Time | No |
   | `SHOPIFY_API_SECRET` | (from password manager) | Run Time | **Yes** |
   | `SHOPIFY_APP_URL` | `${APP_URL}` | Run Time | No |
   | `SCOPES` | `write_metaobject_definitions,write_metaobjects,write_products,read_files,write_files,write_app_proxy` | Run Time | No |
   | `DATABASE_URL` | (private VPC connection string from Postgres) | Run Time | **Yes** |
   | `STORAGE_ENC_KEY` | (from `openssl rand -hex 32`, in password manager) | Run Time | **Yes** |
   | `NODE_ENV` | `production` | Run Time | No |
   | `PORT` | `3000` | Run Time | No |
   | `DEPLOYMENT_NAME` | `bfa-pilot` | Run Time | No |
   | `SENTRY_DSN` | (optional) | Run Time | **Yes** |

   Critical rows: **`APP_BRAND` scope MUST be "Run and Build Time"** — that's what tells App Platform to pass `--build-arg APP_BRAND=bfa` to `docker build`. Without Build-Time scope, the Dockerfile's `ARG APP_BRAND=sdl` default fires and you ship the SDL build by accident. `SHOPIFY_APP_URL = ${APP_URL}` uses App Platform's auto-substituted variable — it'll resolve to your real domain post-deploy.

   Leave the "App-level environment variables" card empty — single-component apps don't need app-level scope.

#### Submit

12. Triple-check the Summary panel on the right (size, region, env-var count, DB attached). Hit **Create Resources**.
13. First build takes ~5–10 min. Watch the **Activity** tab for the Docker build log; common failures (missing env vars, build-arg typos) show up here.
14. Once **Live**, copy the URL from the app's overview page (e.g. `https://bfa-3d-hotspots-xxxxx.ondigitalocean.app`).
15. (Optional) Add a custom domain via **Settings → Domains** → `app.bfa.example.com`. App Platform handles the TLS cert automatically.

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
