# TAE bundle — share `@spectrum-design-lab/shared` with the storefront

> **STATUS: PLANNED.** Author SDL + Claude, 2026-05-22. Slice 8/9
> transitional tech-debt PR. Eliminates the parallel JS copies in
> `extensions/product-3d-viewer/assets/viewer*.js` by turning the TAE
> assets into a real bundled artifact pulling from
> `@spectrum-design-lab/shared`. One PR, scoped tight.

## Why

Slice 8 added four parallel pairs in eight months (icon presets,
video URL classification, animation enum, 360 interpolation). Each
shared concept lives in two files — `app/lib/*.ts` (admin) and
`extensions/product-3d-viewer/assets/*.js` (storefront) — and every
PR that touches a shared concept hand-syncs both. Drift is one
forgotten edit away. The icon PR (#4) already left a comment
referencing a non-existent `icons.js` file as a placeholder — proof
that the plan to dedupe was written down but not done.

Cost of staying with parallel copies grows with every shared
concept added. Slice 9 will add more (storefront keyboard nav,
hotspot grouping). Better to close this debt before the parallel
surface widens.

## Decisions locked

Confirmed at plan kickoff; not open for re-litigation unless a
later step surfaces a concrete reason.

1. **Single shared package, no split.** Icon constants + video
   classification + animation enum go into the existing
   `@spectrum-design-lab/shared`. No new browser-safe sibling
   package. Trade-off: shared carries Zod, so TAE bundle MUST NOT
   import any schema — only constants + pure utility functions.
   Enforced by a bundle-size guard in CI (build fails if any TAE
   output > 30 KB raw).

2. **Build output is git-ignored.** `extensions/product-3d-viewer/assets/viewer.js`,
   `viewer-3d.js`, `viewer-360.js` become generated artifacts.
   Predeploy script regenerates them so `shopify app deploy` always
   ships fresh output. Means `git blame` on these files stops being
   useful for storefront debugging — accepted cost. CSS
   (`viewer.css`) and `model-viewer.min.js` (vendored) stay
   hand-edited and committed.

3. **All three sources convert to TS in one PR.** Not staged. `viewer.ts`,
   `viewer-3d.ts`, `viewer-360.ts` all land in the same PR with the
   build step. Bigger blast radius but only one round of staging-test.
   If something breaks, revert the PR — the previous hand-edited
   `viewer*.js` files are recoverable from git history.

4. **IIFE output format, ES2018 target.** Matches existing pattern
   (`window._sdl3d` global set by `viewer.js`, read by the other
   two). ES2018 is conservative — covers Safari 12+, all current
   evergreen browsers. No transpilation to ES5 — TAE assets serve
   storefront customers, not IE11.

5. **esbuild is the bundler.** Already a transitive dep in the
   project (via Vite + react-router-build). No new toolchain. One
   invocation per output file via a `build:tae` npm script.

6. **`viewer.js` stays under 10 KB.** Shopify's
   `AppBlockJavaScript` rejects blocks with the main JS > 10 KB.
   Currently 9.8 KB hand-written; the bundled version must stay
   below. Strategy: keep `viewer.js` minimal — just the bootstrap +
   shared utilities (`window._sdl3d.ce`, `sa`, `mkFs` etc). Imports
   from `@spectrum-design-lab/shared` happen in `viewer-3d.ts` and
   `viewer-360.ts` only (no cap on those files). If a shared
   constant is only needed in one viewer, import it there.

7. **Bundle-size guard.** New script `scripts/check-tae-size.js`
   runs after `build:tae`. Asserts:
   - `viewer.js` < 9.5 KB (500 byte buffer under the 10 KB cap)
   - `viewer-3d.js` < 30 KB
   - `viewer-360.js` < 30 KB
   Fails CI on regression. Catches accidental schema imports
   (Zod adds ~12 KB minified).

8. **Source layout.** New directory:
   ```
   extensions/product-3d-viewer/src/
     viewer.ts          # bootstrap + shared utils on window._sdl3d
     viewer-3d.ts       # 3D model viewer (model-viewer wrapper)
     viewer-360.ts      # 360 image sequence viewer
     types.ts           # local types not worth promoting to shared
   ```
   Assets directory continues to hold:
   ```
   extensions/product-3d-viewer/assets/
     viewer.css         # hand-edited, committed
     model-viewer.min.js  # vendored, committed
     viewer.js          # GENERATED — gitignored
     viewer-3d.js       # GENERATED — gitignored
     viewer-360.js      # GENERATED — gitignored
   ```

9. **No new functionality.** This PR refactors only. No bug fixes,
   no enhancement, no behaviour change. If something looks broken,
   it was broken before and gets fixed in a separate PR.

## Implementation order

Step-by-step. Each step is a single commit; PR is the whole stack
landed together.

### Step 1 — Promote constants into `@spectrum-design-lab/shared`

In `sdl-platform/packages/shared/`:

- Add `src/hotspot-icons.ts`:
  - Move `HOTSPOT_ICON_KEYS`, `HOTSPOT_PRESET_ICONS`, `classifyIcon`,
    `presetIconSvg`, `presetIconLabel` from
    `sdl-3d-hotspots/app/lib/hotspot-icons.ts`.
  - Pure constants + pure functions. No Zod, no schemas.
- Add `src/video-classify.ts`:
  - Move `classifyVideoUrl` (currently in `app/lib/sdl3d-shared.ts`).
  - Pure regex check. No Zod.
- Add `src/animations.ts`:
  - `HOTSPOT_ANIMATIONS = ["none", "pulse", "bounce", "glow",
    "ripple", "wiggle"] as const`.
  - `HotspotAnimation` type.
- Update `src/index.ts` exports to re-export the new modules.
- Bump version: `0.2.1` → `0.3.0`.
- Build: `npm run build` in `packages/shared/`.
- Republish (or relink — depends on how `sdl-3d-hotspots/`
  resolves it; check `package-lock.json` first).

### Step 2 — Update admin imports

In `sdl-3d-hotspots/`:

- `app/lib/hotspot-icons.ts` becomes a thin re-export:
  ```ts
  export * from "@spectrum-design-lab/shared/hotspot-icons";
  ```
  (or delete the file and update all importers to use the shared
  path directly — preferable, removes one level of indirection).
- `app/lib/sdl3d-shared.ts` re-exports `classifyVideoUrl` from
  shared.
- Confirm no admin file has its own inline copy of these
  constants. Grep for `HOTSPOT_PRESET_ICONS`, `classifyVideo`.

### Step 3 — Add the build step

In `sdl-3d-hotspots/`:

- Create `extensions/product-3d-viewer/src/` directory.
- Add `package.json` script `build:tae`:
  ```json
  "build:tae": "npm run build:tae:viewer && npm run build:tae:3d && npm run build:tae:360",
  "build:tae:viewer": "esbuild extensions/product-3d-viewer/src/viewer.ts --bundle --format=iife --target=es2018 --minify --outfile=extensions/product-3d-viewer/assets/viewer.js",
  "build:tae:3d": "esbuild extensions/product-3d-viewer/src/viewer-3d.ts --bundle --format=iife --target=es2018 --minify --outfile=extensions/product-3d-viewer/assets/viewer-3d.js",
  "build:tae:360": "esbuild extensions/product-3d-viewer/src/viewer-360.ts --bundle --format=iife --target=es2018 --minify --outfile=extensions/product-3d-viewer/assets/viewer-360.js"
  ```
- Add `predeploy` script that runs `build:tae` before
  `shopify app deploy`:
  ```json
  "deploy": "npm run build:tae && shopify app deploy"
  ```
- Update `npm run build` to include `build:tae` so local
  development always has fresh TAE assets.
- Add `scripts/check-tae-size.js` — bundle-size guard (see
  decision 7). Wire into `build:tae` as a post-step.
- Update `.gitignore`:
  ```
  extensions/product-3d-viewer/assets/viewer.js
  extensions/product-3d-viewer/assets/viewer-3d.js
  extensions/product-3d-viewer/assets/viewer-360.js
  ```
- Run `git rm --cached` on the three files so they leave git
  tracking. Local builds regenerate them.

### Step 4 — Convert sources to TS

Three parallel mini-steps, one per file:

#### `viewer.ts`
- Take existing `viewer.js` content as starting point.
- Replace `var` with `const`/`let`, add type annotations.
- Keep the `window._sdl3d = { ce, sa, mkFs, sFb, mkSidebar }`
  pattern — it's the contract `viewer-3d.ts` / `viewer-360.ts`
  rely on.
- No imports from shared in this file (size budget).

#### `viewer-3d.ts`
- Take existing `viewer-3d.js` content as starting point.
- Replace inline `PRESET_ICONS` with:
  ```ts
  import { HOTSPOT_PRESET_ICONS, classifyIcon } from "@spectrum-design-lab/shared";
  ```
- Same `window._sdl3d` consumption pattern.
- Strip the "parallel copy — must mirror" comments.

#### `viewer-360.ts`
- Same treatment as `viewer-3d.ts`.
- Pull in `classifyVideoUrl` from shared.
- Pull in interpolation helpers if/when promoted (out of scope
  for v1 of this PR — see "Out of scope" below).

### Step 5 — Verify + smoke

- `npm run build` from `sdl-3d-hotspots/` produces all three
  bundled assets. Size-guard passes.
- `npx tsc --noEmit` clean.
- `npx vitest run` clean (no behavioural change).
- `npm run dev` — open editor, place hotspots, verify icon
  picker still works (admin imports validated).
- `npm run deploy -- --config staging` — predeploy runs
  `build:tae`, fresh bundles ship to staging.
- Staging storefront: open a product with hotspots in both 3D
  and 360 modes; confirm icons render, animations work, popup
  videos play.
- If clean, push + production deploy.

## Edge cases & invariants

1. **`viewer.js` size cap.** Hard 10 KB limit from Shopify. The
   bundle-size guard is the fence; if a future change pushes it
   over, the guard fails and forces a split (move logic into
   `viewer-3d` or `viewer-360`, or lazy-load a helper module).

2. **Zod leakage.** If a future contributor adds
   `import { HotspotSchema } from "@spectrum-design-lab/shared"`
   to a TAE source, Zod gets bundled. The bundle-size guard
   catches it. Document the rule in `src/README.md`: "TAE sources
   import constants + pure utility fns only. Never schemas."

3. **Shared package version mismatch.** If `sdl-platform` and
   `sdl-3d-hotspots` resolve different versions of shared
   (npm vs workspace link), the TAE bundle could ship a different
   icon set than the admin expects. Verify both resolve to the
   same version after Step 1 publish. `npm ls @spectrum-design-lab/shared`
   in both repos.

4. **Source maps.** esbuild emits `--sourcemap` optionally. Skip
   for production builds (size cost), enable in dev via a
   `build:tae:dev` variant. Storefront debugging without source
   maps means looking at minified IIFE, which is harsh — but
   that's no worse than today's hand-written single-file IIFE.

5. **CI integration.** If CI runs `npm run build`, the TAE step
   runs there too. Ensure `@spectrum-design-lab/shared` is
   resolvable in CI (published to registry, or workspace link
   set up correctly).

6. **`shopify app deploy` from a stale tree.** Running deploy
   without `build:tae` first ships stale assets. The `predeploy`
   hook covers `npm run deploy`. But running
   `shopify app deploy` directly (skipping npm) bypasses it.
   Mitigate with a `shopify.app.toml` `before_deploy` hook if
   Shopify supports it, otherwise document the convention in
   `CLAUDE.md`.

7. **Existing icons.js placeholder reference.** Several code
   comments reference `extensions/product-3d-viewer/assets/icons.js`
   as if it exists. It doesn't. After this PR, the comments
   should be removed entirely — the build step IS the
   resolution.

## Build / typecheck checklist

```bash
cd sdl-platform/packages/shared
npm run build                     # produces dist/ for the new modules
npm test                          # constants + utilities have tests

cd ../../../sdl-3d-hotspots
npm install                       # picks up shared 0.3.0
npx tsc --noEmit                  # clean — TS sources typecheck
npm run build:tae                 # produces fresh TAE bundles
node scripts/check-tae-size.js    # size guard passes
npm run build                     # full build (admin + TAE)
npx vitest run                    # no test regressions
```

## Staging smoke checklist

1. Editor admin loads, icon picker shows 14 presets — same set
   as before the PR.
2. Pick a custom icon (Shopify file GID) → save → reload →
   still selected. Resolves to URL at publish.
3. Add a hotspot with animation `"pulse"` → publish → storefront
   shows pulsing dot.
4. Hotspot with `mediaVideoUrl` YouTube + Vimeo + .mp4 — all
   three render in the popup.
5. 360 viewer: drag-rotate, hotspot keyframes interpolate.
6. Network tab: `viewer.js` < 10 KB, `viewer-3d.js` and
   `viewer-360.js` reasonably sized (< 30 KB each).
7. Console: no errors. `window._sdl3d` populated as before.

## Backout strategy

Single-PR revert restores the hand-edited JS files from git
history. Step 1's shared-package version bump is non-destructive
(0.3.0 → 0.2.1 revert in `sdl-3d-hotspots/package.json` is the
only follow-up). Admin imports re-target the local
`app/lib/hotspot-icons.ts` after revert.

If only Step 3/4 breaks (build step), keep Step 1+2 (admin
imports from shared work fine standalone) and revert the build
infrastructure. Parallel JS copies stay in place; the cleanup
moves to a future PR.

## Out of scope

Saved for follow-up PRs after the bundle pattern is proven:

- **360 interpolation logic** — currently lives in `viewer-360.js`
  as the "main" parallel pair flagged in Slice 7 PR #6.
  Promoting it to shared would be Step 6 of this PR but it's
  more complex than constants (it interacts with frame state).
  Land it in a follow-up PR once the build pattern is in.
- **`metafield-sync` resolver as shared code** — admin-side
  `sdl3d-sync.server.ts` resolves GIDs to URLs at publish.
  Storefront doesn't see GIDs (resolved before write) so this
  isn't a parallel pair, but a future "live GID resolution"
  feature would create one.
- **Editor preview animation rendering** — Slice 8 PR #3
  decision #9 locked editor preview as static. If that decision
  is reversed in Slice 9, the animation CSS needs to ride
  along — and the bundled keyframes could be shared.
- **TAE TypeScript runtime types** — exporting types from shared
  to the TAE feels natural but isn't load-bearing for the
  bundle itself. Skip unless a concrete consumer asks.
- **Source map generation for production** — debug-mode only.
- **Tree-shaking audit** — esbuild's default tree-shaking is
  good enough; if bundles balloon, revisit.
