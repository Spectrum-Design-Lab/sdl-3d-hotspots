# Merchant Onboarding — SDL 3D Hotspots

This guide walks a Shopify merchant through enabling the **SDL 3D viewer** on their product pages. By the end, a customer browsing a configured product will see an interactive 360° (or 3D model) viewer instead of the standard product image gallery.

> **What SDL provides vs. what you provide**
> SDL provides the software: the embedded admin app for placing hotspots, and the capture-processing pipeline that turns raw turntable photos / GLB files into web-ready assets. **Your store, your Shopify products, your storage, and your hotspot configuration are yours.** SDL does not host your assets — frames are uploaded into a CDN bucket *you own* (DigitalOcean Spaces, AWS S3, Cloudflare R2, or Shopify Files), and the URLs are written into your products' `sdl_3d.*` metafields.
>
> **During the pilot**, SDL operates the capture pipeline on your behalf — you hand over raw captures, SDL runs them through the pipeline against your bucket and your Shopify products. Hotspot placement is done by you in the embedded admin app (this guide gets you there).

---

## Prerequisites

- A Shopify store (any plan that supports custom apps and Theme App Extensions — that's all current plans).
- Admin access — you'll need to install the app and edit a theme.
- A CDN bucket you control to host the frames. Anything S3-compatible works: **DigitalOcean Spaces**, **AWS S3**, **Cloudflare R2**, **Bunny**, etc. Smaller catalogs can use **Shopify Files** instead — no separate provider needed. SDL will guide you on bucket setup and CORS during pilot kick-off.
- One product in your catalog where SDL has run a capture through the pipeline and published metafields (you'll know this is done when the product has `sdl_3d.*` metafields visible in its admin metafields panel — the frame URLs in `sdl_3d.image_sequence` should point at your bucket).

---

## Step 1 — Install the SDL 3D Hotspots app

The app is currently in custom-distribution mode for the pilot. SDL will send you an install link that looks like:

```
https://{your-store}.myshopify.com/admin/oauth/redirect_from_cli?client_id=...
```

1. Click the install link while signed into your Shopify admin.
2. Review the requested permissions (read products, read/write files, read/write metafields, read/write metaobject definitions). Click **Install**.
3. You'll land on the app's onboarding wizard inside the embedded admin. Walk through it (5 quick steps) or click **Skip for now** — you can always revisit it from the dashboard.

After installation, the app appears under **Apps** in your Shopify admin sidebar as **SDL 3D Hotspots**.

---

## Step 2 — Add the SDL 3D viewer block to your product page

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

---

## Step 3 — Verify it renders on the storefront

You have two ways to preview, depending on whether you saved to the live theme or a draft:

- **Live theme**: open `https://{your-store}.myshopify.com/products/{product-handle}` in a new browser tab — replace `{product-handle}` with a product SDL has published 360° data for. The viewer should appear on the PDP.
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
| Block missing from the section list | Theme App Extension didn't deploy or you're customising the wrong theme | Confirm the app shows as installed under **Apps**. Try removing and re-adding the block. |
| Viewer area is empty / shows just a spinner | Product doesn't have `sdl_3d.*` metafields published yet | Confirm with SDL that this product was bound and published. Check **Products → {product} → Metafields** in admin — `sdl_3d.image_sequence` (for 360) or `sdl_3d.model_file` (for 3D) should be set. |
| Viewer renders but frames don't load | Frame URLs unreachable or blocked by CORS | Open browser DevTools → Network. Look for failed image requests. If they're from your CDN bucket (e.g. `*.digitaloceanspaces.com`, `*.r2.cloudflarestorage.com`, `*.amazonaws.com`), check that the bucket's CORS rule allows GETs from your storefront domain. SDL helps you set this once during bucket setup. |
| Wrong viewer type (3D shown when you wanted 360, or vice versa) | `sdl_3d.viewer_type` metafield mismatch | Open the product in the SDL 3D Hotspots app and switch the viewer type at the top of the editor, then publish. (Or fix the metafield directly in admin — `image_360` for turntable, `model_3d` for GLB.) |
| Hotspots in wrong positions | Hotspots are tied to specific frames; if a product was re-captured with a different frame count, keyframe positions can drift | Open the product in the SDL 3D Hotspots app — drag hotspots back into place on the new frames and re-publish. The 360 editor's keyframe view shows where each hotspot is anchored. |

---

## What lives where (for context)

**You own and control:**
- **Your Shopify store** and product catalog.
- **Your CDN bucket** (DigitalOcean Spaces / S3 / R2 / Bunny / Shopify Files) — all 360° frames and 3D models live here. SDL never hosts your assets.
- **Your `sdl_3d.*` product metafields** — the URLs and configuration that drive the viewer are written onto your products.
- **Your hotspots** — placed and edited by you in the SDL 3D Hotspots app embedded in your Shopify admin.
- **The theme block** — where the viewer appears on your PDP, how tall it is, whether fullscreen is on.

**SDL provides (software):**
- **The SDL 3D Hotspots app** — the embedded admin editor for hotspots, viewer settings, and publishing.
- **The capture-processing pipeline** — tooling that ingests raw turntable photos / GLB files, validates and resamples frames, converts to web-optimized images, uploads them to your bucket, and writes the `sdl_3d.*` metafields onto the matching Shopify product.

**SDL operates (during the pilot, on your behalf):**
- Running the capture pipeline against your bucket and your Shopify products. You provide the raw captures and product list; SDL processes and publishes.
- Initial CDN bucket setup (CORS, structure, credentials).

If you ever stop using SDL, the assets in your bucket and the metafields on your products stay yours — the storefront viewer keeps rendering as long as the URLs resolve and the theme block is in place.

---

## Where to get help

- **App-specific issues** (block missing, viewer broken, hotspot editor odd): contact SDL.
- **New captures or re-processing**: contact SDL — pipeline operations are SDL-run during the pilot.
- **Hotspot edits, viewer settings, publish to storefront**: do these yourself in the **SDL 3D Hotspots** app under your Shopify admin's **Apps** menu.
- **Shopify theme/admin issues** (can't find the customizer, theme bugs, payment): use Shopify Help.
- **Storefront performance** (frames slow to load): forward your storefront URL and a sample product to SDL. Tuning options include adjusting frame sizing in the pipeline or moving to a different CDN provider.
