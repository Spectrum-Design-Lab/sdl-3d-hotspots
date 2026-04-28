# Merchant Onboarding — SDL 3D Hotspots

This guide walks a Shopify merchant through enabling the **SDL 3D viewer** on their product pages. By the end, a customer browsing a configured product will see an interactive 360° (or 3D model) viewer instead of the standard product image gallery.

> **Pilot note**: SDL handles the capture processing, hosting, and metafield publishing for you. Your job in this guide is to (1) install the app, and (2) drop a single block onto the product page template in your theme.

---

## Prerequisites

- A Shopify store (any plan that supports custom apps and Theme App Extensions — that's all current plans).
- Admin access — you'll need to install the app and edit a theme.
- One product in your catalog where SDL has already published 360° data (you'll know this is done when SDL confirms the product is "bound and published" — the product will have `sdl_3d.*` metafields visible in its admin metafields panel).

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

1. From the customizer, click **Preview** (eye icon top-right) and navigate to a product page that SDL has published 360° data for.
2. You should see the SDL viewer instead of (or alongside, depending on theme) the standard product image.
3. **For 360° image sequences**: drag left/right to rotate. The first frame should appear within 1–2 seconds; remaining frames load progressively in the background.
4. **For 3D models**: orbit with mouse drag, scroll/pinch to zoom, click hotspots if any are configured.
5. Click the **fullscreen** icon (if enabled) to confirm fullscreen mode works.

If everything looks right, **publish the theme** (or your theme draft) to ship it to customers.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Block missing from the section list | Theme App Extension didn't deploy or you're customising the wrong theme | Confirm the app shows as installed under **Apps**. Try removing and re-adding the block. |
| Viewer area is empty / shows just a spinner | Product doesn't have `sdl_3d.*` metafields published yet | Confirm with SDL that this product was bound and published. Check **Products → {product} → Metafields** in admin — `sdl_3d.image_sequence` (for 360) or `sdl_3d.model_file` (for 3D) should be set. |
| Viewer renders but frames don't load | Frame URLs unreachable or blocked by CORS | Open browser DevTools → Network. Look for failed image requests. If they're from a non-Shopify host (e.g. `digitaloceanspaces.com`), check that origin allows requests from your storefront domain. SDL configures this once at setup. |
| Wrong viewer type (3D shown when you wanted 360, or vice versa) | `sdl_3d.viewer_type` metafield mismatch | Check the metafield value in admin — should be `image_360` (lowercase) for turntable captures or `model_3d` for GLB models. SDL can re-publish to fix. |
| Hotspots in wrong positions | Hotspots are bound to specific frames; if SDL re-uploaded with a different frame count, positions can drift | SDL re-syncs hotspots after a re-process. Reach out and they'll publish a fresh hotspot set. |

---

## What lives where (for context)

You manage:
- **The theme block** — where the viewer appears on your PDP, how tall it is, whether fullscreen is on.
- **App install** — connecting/disconnecting the app from your store.

SDL manages:
- **Capture processing** — turning your raw 360° photoshoot into web-ready frames.
- **Hosting** — frames are served from a CDN (DigitalOcean Spaces by default).
- **Product binding & publishing** — linking each capture to the right Shopify product and writing the metafields.
- **Hotspot configuration** — placing clickable hotspots on the model/sequence, configuring their content.

If you need a new product captured, a hotspot edited, or anything re-published, contact SDL.

---

## Where to get help

- **App-specific issues** (block missing, viewer broken, metafields odd): contact SDL directly.
- **Shopify theme/admin issues** (can't find the customizer, theme bugs, payment): use Shopify Help.
- **Storefront performance** (frames slow to load): forward your storefront URL and a sample product to SDL. Performance tuning may involve switching CDN provider or adjusting frame sizing.
