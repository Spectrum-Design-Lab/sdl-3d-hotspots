# SDL 3D Hotspots - Shopify App

## Project Overview

Shopify embedded admin app that lets merchants attach interactive 3D product viewers with clickable hotspots to products. Supports two viewer modes: **3D model viewer** (GLB via `<model-viewer>`) and **360 image sequence viewer** (turntable photography). Built with React Router 7, Prisma (PostgreSQL), and Shopify App Bridge. Storefront rendering via Theme App Extension.

## Tech Stack

- **Frontend:** React 18 + React Router 7 (flat routes)
- **Backend:** Node.js with React Router server runtime
- **Database:** PostgreSQL via Prisma ORM
- **Shopify:** App Bridge React 4.2, shopify-app-react-router 1.1
- **Storefront:** Theme App Extension with `<model-viewer>` web component
- **Build:** Vite 6.3
- **Testing:** Vitest (82 unit tests across schemas, shared, validation, serialization)

## Key Commands

```bash
npm run dev          # Start dev server (runs prisma migrate deploy + react-router dev)
npm run build        # Production build
npm run setup        # prisma generate + prisma migrate deploy
npm run deploy       # shopify app deploy
npx vitest           # Run unit tests
```

## Project Structure

```
app/
  routes/
    app.tsx                    # Main layout with nav (Home, Editor, Presets, Settings)
    app._index.tsx             # Dashboard + onboarding wizard (conditional)
    app.sdl3d.editor.tsx       # Main 3D/360 editor (loader only, no action)
    app.sdl3d.presets.tsx      # Preset management UI (loader only)
    app.sdl3d.settings.tsx     # App settings + metafield setup (loader only)
    app.sdl3d.setup.tsx        # Metafield definition setup (standalone)
    api.sdl3d.config.tsx       # API: saveDraft, publish, pull, copyConfig, setViewerType
    api.sdl3d.files.tsx        # API: upload, select, search, loadMore (models/posters/sequences)
    api.sdl3d.presets.tsx      # API: create, delete, rename, saveAsPreset
    api.sdl3d.onboarding.tsx   # API: completeOnboarding, skipOnboarding, resetOnboarding
    api.sdl3d.settings.tsx     # API: ensureMetafields
    auth.login/route.tsx       # OAuth login
    auth.$.tsx                 # OAuth catch-all
    proxy.sdl3d.tsx            # App proxy for storefront config API
    webhooks.*.tsx             # Webhook handlers (uninstall, scope update)
  components/
    Sdl3dEditorPreview.tsx     # 3D model preview with model-viewer, click-to-place, drag
    Sdl3dEditorSidebar.tsx     # Product search, active product card, actions
    Sdl3dEditorUI.tsx          # Shared UI: Badge, SectionCard, ActionButton, theme palettes
    Sdl3dHotspotEditor.tsx     # 3D hotspot CRUD, drag reorder, inline edit, batch actions
    Sdl3dHotspot360Editor.tsx  # 360 hotspot editor with keyframe system
    Sdl3dImageSequencePreview.tsx  # 360 preview with drag-to-rotate, progressive loading
    Sdl3dViewerSettingsEditor.tsx  # Viewer settings form
    StorefrontPreview.tsx      # Live storefront preview (device frames, background override)
    preview-hotspot-node.ts    # Hotspot DOM node helper
    useHotspotDrag.ts          # Shared drag hook for both viewer types
    useUndoRedo.ts             # Undo/redo state management hook
  lib/
    sdl3d-editor-actions.server.ts  # Legacy action handlers (superseded by API routes, can be deleted)
    sdl3d-files.server.ts      # Shopify file upload (staged uploads), paginated file listing
    sdl3d-graphql.server.ts    # Shared adminGraphql<T> helper, ensureShop
    sdl3d-image-sequence.server.ts  # 360 image batch upload, sequencing
    sdl3d-metafields.server.ts # Metafield definitions (sdl_3d namespace)
    sdl3d-schemas.ts           # Zod schemas for viewer settings, hotspots, config export
    sdl3d-serialization.server.ts  # DB <-> JSON conversion
    sdl3d-shared.ts            # Types (ViewerSettings, Hotspot360), defaults, safeJsonParse
    sdl3d-sync.server.ts       # Bidirectional metafield sync (publish/pull)
    sdl3d-validation.ts        # Client-side validation for settings, hotspots, publish readiness
    model-viewer-utils.ts      # model-viewer type helpers
    shopify.server.ts          # Shopify app config, auth, session storage
    db.server.ts               # Prisma singleton
  styles/
    dashboard.css              # Dashboard page styles
    editor.css                 # Editor page styles
    onboarding.css             # Onboarding wizard styles
extensions/
  product-3d-viewer/
    blocks/product-3d-viewer.liquid  # Storefront block (metafield + app proxy modes)
    assets/viewer.js           # Storefront viewer (model-viewer + 360 image sequence + hotspots)
    assets/viewer.css          # Viewer styling
prisma/
  schema.prisma               # 8 models: Session, Shop, ProductCache, ProductConfig, Hotspot, Asset, Preset, SyncRun
```

## Database Models

- **Session** - Shopify OAuth sessions
- **Shop** - Merchant install records (shopDomain, planName, onboardingComplete)
- **ProductCache** - Cached product metadata from Shopify
- **ProductConfig** - Config per product (viewerType MODEL_3D|IMAGE_360, sourceMode APP|METAFIELD, status DRAFT|PUBLISHED, model/poster files, viewer settings JSON, imageSequenceJson, frameCount)
- **Hotspot** - Individual hotspots (position XYZ, normal XYZ, focus target/orbit, title, body, color, style, CTA)
- **Asset** - Uploaded files (kind MODEL_3D|IMAGE, Shopify file GIDs)
- **Preset** - Saved viewer configs (name, viewer settings JSON, hotspots JSON)
- **SyncRun** - Sync audit log (direction, status, message)

## Shopify Metafield Namespace: `sdl_3d`

Product metafields managed by the app:
- `sdl_3d.enabled` (boolean) - Viewer toggle
- `sdl_3d.mode` (single_line_text) - "app" or "metafield"
- `sdl_3d.viewer_type` (single_line_text) - "model_3d" or "image_360"
- `sdl_3d.model_file` (file_reference) - GLB asset
- `sdl_3d.poster_file` (file_reference) - Poster image
- `sdl_3d.viewer_settings` (json) - Camera, lighting, behavior config
- `sdl_3d.hotspots` (json) - Hotspot array for storefront rendering
- `sdl_3d.imageSequence360` (json) - 360 image sequence frames

## API Scopes

`write_metaobject_definitions, write_metaobjects, write_products, read_files, write_files`

## Coding Conventions

- Server-only modules use `.server.ts` suffix
- Shared types/utilities in `sdl3d-shared.ts`, Zod schemas in `sdl3d-schemas.ts`
- 3D coordinates use "Xm Ym Zm" string format (e.g., "0.012m 0.034m 0.025m")
- Camera orbit uses "Xdeg Ydeg Z%" format
- 360 hotspots use keyframe system with percentage-based x,y coordinates and linear interpolation
- CSS custom properties for theming (light/dark via root class)
- Auto-save with 1200ms debounce in editor
- Dirty detection via JSON snapshot comparison
- Hotspot IDs use `hs_` prefix with timestamp
- Undo/redo via `useUndoRedo` hook (Ctrl+Z / Ctrl+Shift+Z)
- Editor keyboard shortcuts: H (add hotspot), Delete, D (duplicate), Tab (cycle), Space (auto-rotate), Ctrl+S, Escape

## Data Flow

1. Merchant selects product in editor
2. Uploads/selects 3D model (GLB) or 360 image sequence via Shopify staged uploads
3. Configures viewer settings + hotspots (click-to-place or drag on model/images)
4. Auto-saves draft to app DB every 1200ms
5. Publishes draft -> syncs config to Shopify product metafields
6. Theme App Extension reads metafields on storefront -> renders model-viewer or 360 viewer with hotspots
7. Alt: App proxy mode fetches config from app DB directly (for app-managed mode)

## V1 Scope

### Included
- Embedded admin app with dashboard + onboarding wizard
- Product picker, model/image assignment
- Hotspot CRUD with click-to-place and drag-and-drop repositioning
- 3D model viewer (GLB via model-viewer) and 360 image sequence viewer
- Hotspot keyframe tracking on 360 images with interpolation
- Capture camera orbit/target, horizontal-only rotation
- App-managed mode and metafield sync mode
- Storefront rendering via Theme App Extension (both viewer types)
- Copy config, import/export JSON, presets, settings
- Draft/published state, undo/redo, keyboard shortcuts
- Live storefront preview with device frames
- Progressive CDN image loading for 360 sequences

### Not in V1
- AR-specific merchant controls
- Animation-aware surface hotspots (3D model animations)
- Analytics
- Localization/translation UI
- Bulk operations across hundreds of products
- Pricing/billing
- Marketplace polish for public app launch

## Remaining Backlog

- [x] Add proper API layer (5 API routes: config, files, presets, onboarding, settings)
- [x] Hotspot style templates (tooltip, minimal dot, badge, icon-only, panel)
- [x] Auto-suggest product image as poster
- [x] Rate limiting awareness for Shopify API
- [x] Error recovery in sync (retry/rollback partial writes)
- [x] Lazy-load model-viewer (bundle locally or versioned CDN)
- [x] DB query parallelization in editor loader

See [PROGRESS.md](PROGRESS.md) for full implementation history and completed items.

## Data Model Reference

### Viewer Settings JSON Shape
```json
{
  "autoRotate": true,
  "cameraControls": true,
  "cameraOrbit": "0deg 75deg 105%",
  "cameraTarget": "0m 0m 0m",
  "fieldOfView": "auto",
  "minCameraOrbit": null,
  "maxCameraOrbit": null,
  "exposure": 1,
  "environmentImage": null,
  "skyboxImage": null,
  "poster": null,
  "interactionPrompt": "auto",
  "rotationMode": "free",
  "horizontalLock": false,
  "lockedPolarAngle": "75deg",
  "hotspotStyle": "card",
  "showFullscreen": true,
  "showArButton": false,
  "backgroundColor": "#0b1020"
}
```

### 3D Hotspot JSON Shape (Storefront)
```json
[
  {
    "id": "hs_01",
    "sortOrder": 1,
    "visible": true,
    "title": "USB-C input",
    "body": "45W PD input for power and data.",
    "icon": "plus",
    "style": "card",
    "color": "#3b82f6",
    "position": "0.012m 0.034m 0.025m",
    "normal": "0m 1m 0m",
    "focusTarget": "0.012m 0.034m 0.025m",
    "focusOrbit": "20deg 72deg 85%",
    "ctaLabel": null,
    "ctaUrl": null
  }
]
```

### 360 Image Sequence Hotspot JSON Shape
```json
[
  {
    "id": "hs_01",
    "sortOrder": 1,
    "visible": true,
    "title": "USB-C Port",
    "body": "45W PD input for power and data.",
    "style": "card",
    "color": "#3b82f6",
    "visibleFrameStart": 0,
    "visibleFrameEnd": 18,
    "keyframes": [
      { "frame": 0, "x": 45.2, "y": 62.1 },
      { "frame": 9, "x": 72.8, "y": 58.3 },
      { "frame": 18, "x": 95.1, "y": 61.0 }
    ],
    "ctaLabel": null,
    "ctaUrl": null
  }
]
```

### Theme App Extension Block Settings
- `viewer_height` - Range 360-1100px (default 720px)
- `force_horizontal_lock` - Checkbox
- `show_fullscreen` - Checkbox
- `viewer_type` - Select (auto / model_3d / image_360)
