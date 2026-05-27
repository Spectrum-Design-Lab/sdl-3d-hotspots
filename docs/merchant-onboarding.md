# Merchant Onboarding — SDL 3D Hotspots

This guide walks a Shopify merchant from a fresh install through publishing an interactive 360° (or 3D model) viewer on a product page.

> **What SDL provides vs. what you provide**
> SDL provides the software: the embedded admin app for placing hotspots, the capture-processing pipeline that turns raw turntable photos / GLB files into web-ready assets, and the storefront viewer block. **Your store, your Shopify products, your storage, and your hotspot configuration are yours.** SDL does not host your assets — frames are uploaded into a CDN bucket *you own* (DigitalOcean Spaces, AWS S3, Cloudflare R2, or Bunny), and the URLs are written into your products' `sdl_3d.*` metafields.
>
> As of the unified-app release you run the capture pipeline yourself — uploads happen inside the embedded admin and a background worker processes them against your bucket. No SDL operator in the middle.

The setup has five parts. Once you've done parts 1–3 (one-time), parts 4–5 repeat per product.

| Part | What you do | One-time or per-product? |
| --- | --- | --- |
| [1. Install the app](#part-1--install-the-sdl-3d-hotspots-app) | Click the install link, accept scopes | One-time per store |
| [2. Set up a CDN bucket](#part-2--set-up-a-cdn-bucket) | Create a Space/bucket, generate keys, set CORS | One-time per store |
| [3. Connect the bucket in the app](#part-3--connect-your-bucket-to-the-app) | Paste credentials, run the connection test | One-time per store |
| [4. Capture & upload your first product](#part-4--upload-a-product-capture) | Upload ZIP / folder / frames, wait for the worker | Per product |
| [5. Add the viewer block to your theme](#part-5--add-the-viewer-block-to-your-theme) | Pick a template, add SDL 3D viewer block | One-time per theme, then per-product if you use per-product templates |

---

## Part 1 — Install the SDL 3D Hotspots app

During the pilot the app is in custom-distribution mode. SDL will send you a one-click install link that looks like:

```
https://{your-store}.myshopify.com/admin/oauth/redirect_from_cli?client_id=...
```

1. Click the install link while signed into your Shopify admin.
2. Review the requested permissions:
   - **Products** — read product titles and variants for the picker
   - **Files** — read and write Shopify Files (used for 3D model GLBs and the on-Shopify icon library)
   - **Metafields** — read and write product metafields under the `sdl_3d` namespace (this is the only namespace the app touches)
   - **Metaobject definitions** — used by the bucket-connection setup
   Click **Install**.
3. You'll land on the app's onboarding wizard inside the embedded admin. Walk through it (5 quick steps) or **Skip for now** — you can always revisit from the app's dashboard.

After installation the app appears under **Apps** in your Shopify admin sidebar as **SDL 3D Hotspots**.

> **Tip — keep the install link.** If you ever uninstall and reinstall, the same install link works (Shopify just re-runs the OAuth flow). Your product data, bucket configuration, and hotspot drafts persist in the app's database — uninstall only revokes the API token, it doesn't delete anything.

---

## Part 2 — Set up a CDN bucket

The app uploads processed 360° frames and 3D model files to a bucket *you control*, then stores the public URLs in your products' `sdl_3d.*` metafields. Pick one provider below and follow that walkthrough. **DigitalOcean Spaces is the recommended starting point** — flat pricing ($5/mo for 250 GB + 1 TB transfer), works out of the box with this app, no AWS-style billing surprises.

### Option A — DigitalOcean Spaces (recommended)

#### A.1. Create a Space

1. Sign in to <https://cloud.digitalocean.com/>. If you don't have an account, create one (you'll need a payment method on file).
2. From the top nav, choose **Spaces Object Storage**.
3. Click **Create Spaces Bucket** (older UI: **Create a Space**).
4. **Datacenter region**: pick one close to your customers. Common picks:
   - `nyc3` — New York (US East)
   - `sfo3` — San Francisco (US West)
   - `ams3` — Amsterdam (EU)
   - `fra1` — Frankfurt (EU)
   - `sgp1` — Singapore (APAC)
   - `syd1` — Sydney (APAC)
   You can't change this later — frames are tied to the regional URL. Pick once.
5. **Enable CDN**: leave **off** for now. The Spaces CDN works but adds a different domain and a small extra cost; you can enable it later via the Space's Settings tab. The app works fine pointed at the raw Space.
6. **Restrict file listing**: leave **on** (default). The app doesn't need bucket-listing permission.
7. **Name your bucket**: must be globally unique across all DigitalOcean Spaces. A pattern like `<your-brand>-sdl3d` is safe. Lowercase letters, numbers, hyphens. Example: `acme-sdl3d`.
8. **Project**: pick one or use the default. Cosmetic only.
9. Click **Create Spaces Bucket**.

You should land on the new Space's **Files** tab — empty for now.

#### A.2. Generate an access key

The app needs an access key + secret to upload to your Space. These are **separate** from your DigitalOcean account password.

1. In the DO control panel left nav, click **API**.
2. Switch to the **Spaces Keys** tab (not the personal access tokens tab — those are different).
3. Click **Generate New Key**.
4. **Name**: `sdl-3d-hotspots` (or anything that helps you recognise it later).
5. (If you see scope/permission options) grant access **only** to the bucket you just created — principle of least privilege. If your DO account doesn't show a scope picker, the key will get full Spaces access; that's fine for a single-tenant pilot.
6. Click **Generate Key**.
7. **Copy both the Access Key ID and Secret immediately**. The Secret is shown **once** and DigitalOcean will not display it again. Paste them somewhere safe (a password manager). If you lose the Secret, generate a new key and delete the old one — there's no recovery.

#### A.3. Configure CORS on the bucket

CORS tells the storefront browser it's allowed to fetch images from your Space. Without it the viewer shows broken images.

1. From the Spaces list, click into your bucket.
2. Open the **Settings** tab.
3. Scroll to **CORS Configurations** and click **Add**.
4. Fill in:
   - **Origin**: `https://{your-store}.myshopify.com` (replace with your actual myshopify domain — *and* add another rule for your custom storefront domain if you have one, e.g. `https://shop.acme.com`)
   - **Allowed Methods**: check **GET** (and **HEAD** if shown). Leave PUT/POST/DELETE *unchecked* — the app uses signed URLs for writes, which don't need CORS.
   - **Allowed Headers**: leave the default (`*`) or set explicitly to `Content-Type` if you prefer tighter rules.
   - **Access Control Max Age**: `3600` (1 hour) is fine.
5. Click **Save CORS Configuration**.

Repeat the add for each storefront origin (myshopify domain + custom domain). DigitalOcean lets you add multiple rules.

> **What you're configuring**: this only governs the storefront *reading* frames. The app's *upload* path uses pre-signed PUT URLs which carry their own authorization and bypass CORS preflight. So CORS only needs to allow reads.

#### A.4. (Optional) Public base URL via CDN or custom domain

If you enable the Spaces CDN in step A.1 (or attach a custom CNAME), the public URL will look like `https://acme-sdl3d.fra1.cdn.digitaloceanspaces.com/...` or `https://cdn.acme.com/...` instead of the raw `https://acme-sdl3d.fra1.digitaloceanspaces.com/...`. Both work — the app lets you set a **Public Base URL** override in Part 3 if you want the storefront to load from the CDN/custom domain while the worker keeps uploading directly to the bucket.

Skip this for now if you're not sure. You can switch later.

### Option B — AWS S3

Use S3 if you're already on AWS. The setup is conceptually identical but the wording differs.

1. **Create a bucket** in the S3 console. Pick a region close to your customers (e.g. `us-east-1`, `eu-west-1`). Disable **Block all public access** (or at minimum disable "Block public access via ACL" — the app sets `public-read` ACL on frames).
2. **Create an IAM user** with programmatic access. Attach a policy like:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["s3:PutObject", "s3:GetObject", "s3:PutObjectAcl"],
         "Resource": "arn:aws:s3:::<your-bucket>/*"
       },
       {
         "Effect": "Allow",
         "Action": ["s3:HeadBucket"],
         "Resource": "arn:aws:s3:::<your-bucket>"
       }
     ]
   }
   ```
   Save the access key ID + secret.
3. **CORS** on the bucket (Permissions → CORS):
   ```json
   [
     {
       "AllowedOrigins": ["https://{your-store}.myshopify.com"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   Add additional entries for any custom storefront domains.
4. Optional: front the bucket with CloudFront and use the CloudFront URL as the **Public Base URL** in Part 3.

### Option C — Cloudflare R2

R2's main appeal is zero egress fees.

1. In the Cloudflare dashboard, **R2 → Create bucket**. Bucket names are R2-account-scoped (not globally unique).
2. Open the bucket → **Settings** → **Public access**:
   - Easiest: enable **R2.dev subdomain** for a quick public URL. Fine for pilots.
   - Production: attach a custom domain (e.g. `cdn.acme.com`) under **Custom Domains**.
3. **R2 → Manage R2 API Tokens** → **Create API token**. Permissions: **Object Read & Write** scoped to your bucket. Copy the Access Key ID + Secret. The endpoint shown is `https://<accountid>.r2.cloudflarestorage.com` — note it down.
4. **CORS** on the bucket → **Settings** → **CORS Policy**: same shape as the S3 JSON above.

### Option D — Bunny.net Storage

1. **Storage** → **Add Storage Zone**. Pick a primary region. Note the **Hostname** (e.g. `storage.bunnycdn.com`) and your zone's **Username** and **Password** under **FTP & API Access**.
2. Bunny exposes objects via a **Pull Zone** (their CDN). Create a Pull Zone backed by the Storage Zone — the Pull Zone's hostname (e.g. `acme-sdl3d.b-cdn.net`) is what you'll use as the **Public Base URL**.
3. CORS on a Bunny Pull Zone is configured under the Pull Zone → **Headers** → add `Access-Control-Allow-Origin` header with your storefront domain(s). Wildcards work but be specific in production.

---

## Part 3 — Connect your bucket to the app

In the SDL 3D Hotspots app:

1. Open the **Apps → SDL 3D Hotspots** in your Shopify admin.
2. Navigate to **Settings → Storage** (or the **Storage** link in the left sidebar).
3. Click **Add storage connection**.
4. **Provider**: pick the one you set up in Part 2.
5. Fill the credential fields:

   For **DigitalOcean Spaces**:
   - **Space URL**: paste the full origin from your DO control panel, e.g. `https://acme-sdl3d.fra1.digitaloceanspaces.com`. The form will auto-extract endpoint (`fra1.digitaloceanspaces.com`), region (`fra1`), and bucket (`acme-sdl3d`) into the separate fields — you can override if needed.
   - **Access key ID** / **Secret access key**: the credentials from step A.2.
   - **Public base URL** (optional): leave blank to use the raw Space URL. Set to your CDN or custom-domain URL (e.g. `https://acme-sdl3d.fra1.cdn.digitaloceanspaces.com` or `https://cdn.acme.com`) if you enabled either.

   For **AWS S3**:
   - **Endpoint**: `s3.<region>.amazonaws.com` (e.g. `s3.us-east-1.amazonaws.com`)
   - **Region**: e.g. `us-east-1`
   - **Bucket**: your bucket name
   - **Access key ID** / **Secret access key**: the IAM user credentials
   - **Public base URL** (optional): your CloudFront URL if you set one up

   For **Cloudflare R2**:
   - **Endpoint**: `<accountid>.r2.cloudflarestorage.com`
   - **Region**: `auto`
   - **Bucket**: your R2 bucket name
   - **Access key ID** / **Secret access key**: the R2 API token credentials
   - **Public base URL**: the R2.dev subdomain or your custom domain (R2 needs this — unlike DO/S3 the raw endpoint isn't publicly readable)

   For **Bunny Storage**:
   - **Endpoint**: `storage.bunnycdn.com` (or your regional variant)
   - **Region**: your zone region
   - **Bucket**: your storage zone name
   - **Access key ID** / **Secret access key**: storage zone Username / Password (Bunny treats the password as the secret)
   - **Public base URL**: the Pull Zone URL (e.g. `https://acme-sdl3d.b-cdn.net`)

6. Click **Test connection**. The app will run a `HeadBucket` against your credentials and report success or the exact error message (most common failures: wrong region/endpoint, mistyped key, bucket doesn't exist yet, IAM policy too restrictive).
7. Once the test goes green, click **Save**. You can connect multiple buckets if you want different ones per use case, but most merchants just keep one.

> **Credentials are encrypted at rest.** The app encrypts your access key/secret with AES-256-GCM before writing them to its database. The encryption key (`STORAGE_ENC_KEY`) lives in the deployment's environment file, not in source control. If you ever need to rotate, generate a new Spaces key on DO, paste it into the same storage connection, and **Save** — the old credential row is overwritten in place.

---

## Part 4 — Upload a product capture

The unified app handles capture intake end-to-end — no CLI, no SDL operator.

1. In the app, open **Editor**.
2. Use the product picker on the left rail to pick the product you want to enable.
3. The **Media** panel will show empty slots for either a **3D model file** (GLB) or a **360° image sequence**. Pick the one matching your capture.
4. Click **Upload** in the relevant slot. Three input modes are supported:
   - **ZIP archive** — frames inside any folder structure; the app's scanner is tolerant of common naming conventions (`0001.jpg`, `frame_001.png`, etc.) and validates the bytes via JSZip *before* uploading, so a malformed ZIP fails fast without burning bandwidth.
   - **Folder** — drag a folder of frames in (or use the picker if your browser supports `webkitdirectory`).
   - **Individual files** — pick frames manually.
5. (Optional) **Folder name** — give this capture a slug (e.g. `pdp-hero-360`) for friendlier URLs and easier discovery in your bucket. Must be unique within your shop. If left blank, the capture ID (a uuid) is used as the prefix.
6. **Validation** runs immediately and reports hard-fail issues (mixed extensions, frames missing, too few frames) and soft warnings (unusual frame count, inconsistent dimensions). Hard failures block upload; soft warnings let you proceed if you know what you're doing.
7. Once the upload completes, a pg-boss worker picks the job up:
   - Re-validates the uploaded payload server-side
   - Samples frames to a target count (default 36 — configurable per capture)
   - Converts to web-optimized JPEG via sharp
   - Uploads processed frames + a manifest to `<your-bucket>/sdl-3d/processed/<captureId|folderName>/`
   - Writes the public URLs into `sdl_3d.imageSequence360` on the matching product
8. The Editor's capture panel polls and shows status. Typical processing time: 20–60 seconds for a 36-frame turntable on a 2-core worker.
9. Cancel anytime — the **Cancel** button kills the worker between processing steps (usually within one batch).

If the job fails, it appears in the **Failed captures** section on the Settings/Dashboard with the error and a Retry button.

> **Where things go in your bucket:**
> - `sdl-3d/raw/<captureId|folderName>/...` — your raw upload (private)
> - `sdl-3d/processed/<captureId|folderName>/frame-001.jpg` etc. — web-ready frames (public-read, immutable cache headers)
> - `sdl-3d/processed/<captureId|folderName>/manifest.json` — frame ordering + metadata
>
> Frame keys are content-addressed (capture IDs / folder names don't get reused), so the immutable `Cache-Control` is safe — browsers and any CDN in front of your bucket cache them indefinitely.

After a successful publish you can:
- Place hotspots (click-to-place on 3D, drag-on-canvas / "+" affordance on 360 timeline)
- Configure viewer settings (camera, lighting, background, auto-rotate)
- Save as draft or publish to the storefront (publishing writes the `sdl_3d.*` metafields on the Shopify product)

---

## Part 5 — Add the viewer block to your theme

Shopify themes use either a single product template or per-product templates. These steps work for both.

1. In Shopify admin, open **Online Store → Themes**.
2. Click **Customize** on your live (or a draft) theme.
3. In the top centre, switch the template selector from "Home page" to **Products → Default product** (or pick a specific product template if you've created custom ones).
4. In the **Sections** panel on the left, find the **Product information** section and click **Add block** beneath it (the exact location varies by theme; some themes let you add the block as a top-level section instead — both work).
5. Search for **SDL 3D viewer** and add it.
6. Configure block settings (right-hand panel):
   - **Viewer height**: 360–1100 px. 720 is a good starting point.
   - **Force horizontal-only rotation**: On if your captures are 360° turntable (most cases). Off for free-rotation 3D models.
   - **Show fullscreen**: On to give customers a fullscreen toggle.
   - **Viewer type**: Leave on **Auto** — it'll pick 3D model or 360° image sequence based on what data the product has.
7. Click **Save** in the top-right.

### Verify it renders on the storefront

You have two ways to preview, depending on whether you saved to the live theme or a draft:

- **Live theme**: open `https://{your-store}.myshopify.com/products/{product-handle}` in a new browser tab — replace `{product-handle}` with a product you've published in Part 4. The viewer should appear on the PDP.
- **Draft theme**: from **Online Store → Themes**, find your draft, click the **…** (more actions) menu on its card, and choose **Preview**. Shopify opens a shareable preview URL — append `/products/{product-handle}` to land on a configured product.

Then check:

1. The SDL viewer appears instead of (or alongside, depending on theme) the standard product image.
2. **For 360° image sequences**: drag left/right to rotate. The first frame should appear within 1–2 seconds; remaining frames load progressively in the background.
3. **For 3D models**: orbit with mouse drag, scroll/pinch to zoom, click hotspots if any are configured.
4. Click the **fullscreen** icon (if enabled) to confirm fullscreen mode works.

If everything looks right and you've been working on a draft, **publish the theme** to ship it to customers.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Storage connection test fails with "InvalidAccessKeyId" / "SignatureDoesNotMatch" | Mistyped key or wrong region | Re-paste keys; confirm region matches the Space's datacenter exactly (DO uses short codes like `fra1`, AWS uses `eu-central-1`). |
| Connection test fails with "NoSuchBucket" | Bucket name typo or bucket not created in the same region as the endpoint | Verify bucket exists in the DO/S3/R2 dashboard and that the endpoint region matches. |
| Connection test fails with "AccessDenied" | IAM policy too restrictive (S3) or DO Spaces key scoped to a different bucket | Loosen the policy to include `s3:HeadBucket`, `s3:PutObject`, `s3:GetObject`, `s3:PutObjectAcl`; or regenerate a DO Spaces key with the correct bucket scope. |
| Upload completes but processing fails | Worker can't reach the bucket (network/firewall) or capture has a hard-validation issue not caught client-side | Check the failed-captures panel — it shows the worker's exact error. For network issues, confirm the Docker host can reach the endpoint hostname. |
| Viewer area is empty / shows just a spinner on storefront | Product doesn't have `sdl_3d.*` metafields published yet | Open the product in the SDL 3D Hotspots app; if it shows as a draft, click **Publish**. |
| Storefront frames don't load — broken images in DevTools, CORS error in console | Bucket CORS rule missing for the storefront origin | Add the storefront origin (e.g. `https://acme.com` AND `https://acme.myshopify.com`) to the bucket's CORS configuration. CORS is read-only here — only GET/HEAD needed. |
| Frames load on `*.myshopify.com` but break on the custom storefront domain | CORS rule covers myshopify but not the custom domain | Add a second CORS rule for the custom domain. |
| Block missing from the section list | Theme App Extension didn't deploy or you're customising the wrong theme | Confirm the app shows as installed under **Apps**. Try removing and re-adding the block. If it still isn't there, contact SDL — the TAE may need a redeploy. |
| Wrong viewer type (3D shown when you wanted 360, or vice versa) | `sdl_3d.viewer_type` metafield mismatch | Open the product in the SDL 3D Hotspots app and switch the viewer type at the top of the editor, then publish. |
| Hotspots in wrong positions after re-uploading a capture | Hotspots are tied to specific frame numbers; if a product was re-captured with a different frame count, keyframe positions drift | Open the product in the SDL 3D Hotspots app — drag hotspots back into place on the new frames and re-publish. The 360 editor's keyframe view shows where each hotspot is anchored. |

---

## What lives where (for context)

**You own and control:**
- **Your Shopify store** and product catalog.
- **Your CDN bucket** (DigitalOcean Spaces / S3 / R2 / Bunny) — all 360° frames and 3D models live here. SDL never hosts your assets.
- **Your `sdl_3d.*` product metafields** — the URLs and configuration that drive the viewer are written onto your products.
- **Your hotspots** — placed and edited by you in the SDL 3D Hotspots app embedded in your Shopify admin.
- **The theme block** — where the viewer appears on your PDP, how tall it is, whether fullscreen is on.

**SDL provides (software):**
- **The SDL 3D Hotspots app** — embedded admin editor + capture-processing worker bundled in one deploy.
- **The Theme App Extension** — the storefront viewer block itself (viewer.js / viewer-3d.js / viewer-360.js, served from Shopify's CDN once SDL deploys an updated TAE version).

If you ever stop using SDL, the assets in your bucket and the metafields on your products stay yours — the storefront viewer keeps rendering as long as the URLs resolve and the theme block is in place. You can also uninstall the embedded admin app and the storefront viewer will continue working from the published metafields.

---

## Where to get help

- **App-specific issues** (block missing, viewer broken, hotspot editor odd): contact SDL.
- **Bucket setup or CDN questions** (CORS, custom domains, IAM): SDL can help you debug the connection-test output and the storefront DevTools network tab.
- **Hotspot edits, viewer settings, capture uploads, publish to storefront**: do these yourself in the **SDL 3D Hotspots** app under your Shopify admin's **Apps** menu.
- **Shopify theme/admin issues** (can't find the customizer, theme bugs, payment): use Shopify Help.
- **Storefront performance** (frames slow to load): forward your storefront URL and a sample product to SDL. Tuning options include adjusting frame count in the pipeline, enabling the bucket's CDN, or moving to a CDN-fronted provider (R2 with public.r2.dev or a custom domain, or DO Spaces with CDN enabled).
