# SDL 3D Hotspots - Progress Tracker

## V1 Implementation Plan Phases

### Phase 1: Cleanup and Fixes
- [x] Step 1.1 - Fix API version mismatch
- [x] Step 1.2 - Remove scaffold demo from home page (replaced with dashboard)
- [x] Step 1.3 - Remove scaffold additional page
- [x] Step 1.4 - Clean shopify.app.toml scaffold remnants
- [x] Step 1.5 - Update navigation

### Phase 2: Dashboard
- [x] Step 2.1 - Build dashboard route

### Phase 3: Missing V1 Features
- [x] Step 3.1 - Copy config from another product (sidebar dropdown, copies settings + hotspots + 360 data)
- [x] Step 3.2 - Export config JSON (client-side download with ConfigExport type)
- [x] Step 3.3 - Import config JSON (file picker, validation via isValidConfigExport, populates editor state)
- [x] Step 3.4 - Presets page + editor integration (route, CRUD, save/load/apply in editor action bar)
- [x] Step 3.5 - Settings page (app info, metafield setup, stats; replaces setup route in nav)

### Phase 4: Editor Refactoring
- [x] Step 4.1 - Extract action handlers (-> sdl3d-editor-actions.server.ts)
- [x] Step 4.2 - Extract shared UI components (-> Sdl3dEditorUI.tsx)
- [x] Step 4.3 - Extract product search sidebar (-> Sdl3dEditorSidebar.tsx)
- [x] Step 4.4 - Deduplicate GraphQL helpers (-> sdl3d-graphql.server.ts)

### Phase 5: Storefront App-Managed Mode
- [x] Step 5.1 - Create storefront config API (app proxy at /apps/sdl3d, returns published config JSON)
- [x] Step 5.2 - Update theme extension for app mode (Liquid app container, JS fetch + dynamic viewer init)

### Phase 6: Quality and Polish
- [x] Step 6.1 - Fetcher-based publish/pull actions (actionFetcher with inline loading, removed Form-based pull/publish)
- [x] Step 6.2 - Error boundaries (editor, dashboard, presets, settings routes)
- [x] Step 6.3 - File list pagination (cursor-based load-more for model and poster file lists)
- [x] Step 6.4 - Loading states (useNavigation for upload/select buttons, fetcher-based for publish/pull/load-more)

### Phase 7: 360 Image Sequence Viewer
- [x] Step 7.1 - Data model for 360 viewer (schema + metafields + shared types)
- [x] Step 7.2 - 360 image upload, sequencing, and auto viewer-type detection from file type
- [x] Step 7.3 - 360 viewer component (admin preview with drag-to-rotate, scrubber, auto-rotate)
- [x] Step 7.4 - Hotspot tracking on image sequence (keyframe system with interpolation + visibility range)
- [x] Step 7.5 - 360 storefront viewer (viewer.js + Liquid conditional rendering)
- [x] Step 7.6 - Editor viewer type switcher (toggle, conditional UI, auto-save integration)

### Phase 8: Complete UI Rebuild
- [x] Step 8.1 - Design system foundation (component library + tokens)
- [x] Step 8.2 - Editor layout rebuild (collapsible sidebar, sticky action bar, breadcrumbs)
- [x] Step 8.3 - Preview panel improvements (floating toolbar, edit/view modes)
- [x] Step 8.4 - Hotspot editor rebuild (drag reorder, inline edit, batch actions)
- [x] Step 8.5 - Dashboard and navigation rebuild

### Phase 9: Click-and-Drag Hotspots
- [x] Step 9.1 - Drag hotspots on 3D model viewer (admin-only, grab cursor, Escape cancel)
- [x] Step 9.2 - Drag hotspots on 360 image viewer (pointer drag with 4px threshold, Shift axis lock, Escape cancel)
- [x] Step 9.3 - Drag interaction UX polish (cursor feedback, Escape cancel, camera-controls disabled during drag)

### Phase 10: In-Page Preview Development
- [x] Step 10.1 - Live storefront preview component (StorefrontPreview.tsx)
- [x] Step 10.2 - Side-by-side editor + preview layout (Edit/Preview tabs in main panel)
- [x] Step 10.3 - Preview mode controls (device frames, background override)

---

## Recommendations Backlog
- [x] Move from SQLite to PostgreSQL (provider switch, fresh baseline migration, Dockerfile updated)
- [x] Add proper API layer (5 API routes: config, files, presets, onboarding, settings — route actions removed)
- [x] Undo/redo stack for hotspot operations (useUndoRedo hook, Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y)
- [x] Keyboard shortcuts for editor (H/Delete/D/Tab/Space/Ctrl+S/Escape)
- [x] Zod schemas for metafield JSON validation (sdl3d-schemas.ts, types inferred from schemas)
- [x] Automated testing (Vitest unit tests -- 82 tests across schemas, shared, validation, serialization)
- [x] Image sequence CDN optimization (progressive frame loading, Shopify CDN responsive sizing)
- [x] Onboarding wizard for first-time merchants (5-step guided wizard, dashboard redirect, skip option)
- [x] Hotspot style templates (6 styles: card, tooltip, dot, badge, icon-only, panel — CSS variants for storefront + editor + 360 preview, per-hotspot style selector in both editors)
- [x] Auto-suggest product image as poster (shop logo as loading poster, product featured image as error fallback, auto-suggest UI in editor, fallback in storefront viewer.js + liquid template)
- [x] Rate limiting awareness for Shopify API (retry-with-backoff in adminGraphql wrapper, throttle delays in image sequence upload + metafield definition loops)
- [x] Error recovery in sync (publish: per-chunk retry with rollback to previous values on failure; pull: Prisma transaction for atomic DB writes)
- [x] Lazy-load model-viewer (npm import for editor via Vite, local asset copy for storefront extension — zero CDN dependency; v4.2.0)
- [x] DB query parallelization in editor loader (2-phase Promise.all: 8 queries in Phase 1, 3 in Phase 2)

---

## Pre-Plan (Completed Before V1 Plan)
- [x] Shopify app scaffold with React Router 7
- [x] Prisma schema with all 8 models + migrations
- [x] OAuth and session handling
- [x] Product search in editor
- [x] Model assignment (upload + select from Shopify files)
- [x] Poster image assignment
- [x] Hotspot CRUD with click-to-place on 3D model
- [x] Capture camera orbit/target from viewer
- [x] Viewer settings editor (all fields)
- [x] Horizontal-only rotation option
- [x] Auto-save with 1200ms debounce
- [x] Draft/published status tracking
- [x] Publish config to metafields (sync)
- [x] Pull metafields to draft (sync)
- [x] Metafield definition setup page
- [x] Theme App Extension (metafield mode)
- [x] Storefront model-viewer with hotspots
- [x] Storefront hotspot click -> camera animation
- [x] Dark/light theme in editor
- [x] Validation for settings, hotspots, and publish readiness
- [x] Webhook handlers (uninstall, scope update)

---

## Rollout Phases (Post-V1)

### Phase A - Polished Internal Prototype
- Real Shopify install on dev store
- Full embedded UI
- One product block working end-to-end
- App-managed data flow

### Phase B - Metafield Sync and Read Mode
- Metafield definitions created automatically
- Sync actions (publish/pull)
- Theme block auto mode

### Phase C - Merchant Quality of Life
- Presets
- Copy from product
- Import/export
- Full publish flow

### Phase D - Commercial Prep
- Billing integration
- Onboarding flow
- Documentation
- Support tooling
