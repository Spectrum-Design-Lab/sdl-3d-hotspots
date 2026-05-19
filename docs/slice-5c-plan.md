# Slice 5C — Polaris migration + per-page UX rework

> **STATUS: ✅ SHIPPED + STAGING-VALIDATED 2026-05-19.** All 14 PRs (#0
> through #6 plus sub-PRs 5a–5k) on `main`; smoke tests clean. The
> plan below documents the original intent; what actually shipped is
> recorded in commit history (`64aa66f..643333d`) and summarized in
> the "Shipped" section at the end of this doc. Slice 6 candidates
> rolled forward into the "Out of scope" section.
>
> Original planning header (kept for posterity): Author SDL + Claude,
> 2026-05-13. Picks up after Slice 5B (`6f600ec..057819d`, validated
> on staging). Goal: ship the Polaris adoption *as* a UX rework, page
> by page. Component swap alone is not the deliverable — every page
> should feel better after its migration commit than before.

## Why this exists

The app ships with a hand-rolled CSS system (`.sdl-card`, `.sdl-btn`, custom
dark-mode tokens) that's drifted visually from Shopify admin. Three concrete
costs:

1. **Visual mismatch with Shopify admin.** Merchants context-switch from native
   Shopify UI into our embedded surface and notice the gap — different fonts,
   spacings, focus rings, button shapes. Polaris closes this gap for free.
2. **Accessibility gaps.** Custom `<button>`s with no aria-state, color-only
   focus indicators, no keyboard nav for our list components. Polaris bakes
   these in.
3. **App Store readiness.** A Polaris-based app passes Shopify's design
   guidelines with no extra work. Hand-rolled CSS requires a separate audit
   pass before listing.

We deferred this from Slice 5A/5B because Polaris adoption is a multi-week
lift and a different shape of work (UX/component) than the storage backend
changes. 5C is that work.

**Important framing**: a page does not "ship" just because every `<button>`
became `<Button>`. Each page-migration PR must include at least one concrete
UX improvement called out in the PR description. See the per-page sections
below for the locked-in improvements.

## Decisions already locked

Came out of the Slice 5 planning conversation (2026-05-13) and confirmed
during 5C kickoff. Not open for re-litigation; raise on a follow-up slice if
something changes.

1. **Full `@shopify/polaris` adoption**, not Polaris-aesthetic-only. We import
   the real components and let them own layout, color, typography, and focus
   styling. No bespoke `Card` wrappers; no `.sdl-card` polyfills.

2. **One PR per page, in a fixed order.** Settings → Storage → Presets →
   Dashboard/Home → Editor (chrome only, not the 3D canvas) → CSS cleanup.
   Order is "smallest blast radius first" — Settings/Storage/Presets land
   the primitive patterns (Page, Card, Form, Toast, EmptyState), Dashboard
   scales them up (ResourceList + Tabs + Modal), and the Editor's three-
   column chrome lands last when every component pattern is already
   battle-tested.

3. **PR #0 lands the substrate**: install Polaris, wire `AppProvider`, add
   the CSS import, set up theme tokens. No page changes in PR #0 — every
   page still renders with its existing hand-rolled CSS until its own PR
   lands. Mixed-state in `main` is fine for this slice; the alternative is
   one giant PR.

4. **Dark mode handling.** Polaris ships its own theming (`@p-color-bg-*`
   tokens, light/dark variants). The existing `data-theme="dark"` attribute
   and `shop.darkMode` Prisma column stay; the dark-mode toggle on the
   Settings page rewrites `body.classList` to switch between Polaris light
   and dark themes. No double theming.

5. **Editor's 3D canvas is not Polaris.** `<model-viewer>` and the image
   sequence canvas stay outside the Polaris component tree — wrap them in a
   `Card` for the surrounding chrome, but the canvas itself keeps its
   existing CSS for sizing and overlays. Hotspot overlays stay as-is.

6. **No new feature work in 5C.** Visual changes + UX wins called out per
   page. New flows (auto-publish toggle, top-bar storage selector) are
   Slice 6.

7. **Hand-rolled CSS gets ripped, not kept.** Final commit deletes
   `.sdl-card`, `.sdl-btn`, `.sdl-subtle-card`, `.sdl-input`, `.sdl-label`,
   `.sdl-text-muted`, `.sdl-badge`, `.sdl-mb-*` etc. once no page references
   them. Editor-specific styles (`.sdl-editor`, viewer/hotspot overlays)
   stay.

## Migration order — PR-by-PR

### PR #0 — Polaris substrate

**Goal**: install Polaris and wrap the app shell. Every page still renders
identically; this PR doesn't change any merchant-visible surface.

**Changes**:
- `package.json`: add `@shopify/polaris` (latest 12.x line) and
  `@shopify/polaris-icons`. Already have `@shopify/polaris-types`.
- `app/root.tsx` (or `app/routes/app.tsx`, whichever owns the AppBridge
  provider): wrap children in `<AppProvider i18n={en}>` from
  `@shopify/polaris`. Import `@shopify/polaris/build/esm/styles.css` once at
  the layout root.
- `app/styles/polaris-bridge.css` (new, tiny): a few CSS overrides for the
  iframe body so Polaris' default `--p-color-bg` paints behind our content
  on first paint (avoid the white-flash before AppBridge resolves).
- No route file changes. The existing `.sdl-card`/`.sdl-btn` classes
  continue to win at specificity because Polaris styles ship as classes,
  not as direct selectors on our `<section>` / `<button>` elements.

**Smoke**:
- `npm run build` clean. Vite picks up the Polaris CSS without complaint.
- Every existing page renders unchanged (snapshot visually against the
  screenshots saved in `docs/screenshots/pre-5c/`).
- DevTools network panel shows the Polaris CSS bundle loaded once at
  layout level, no duplicate fetches.

### PR #1 — Settings page (the proof-of-concept)

Current page is the simplest surface — five stacked sections, a few forms,
no list/table UI. Right shape to land the patterns we'll repeat on every
later page.

**Polaris components**:
- `Page` with `title="Settings"` and `subtitle="App configuration, metafield
  setup, and debug information."` (replaces the bespoke header).
- `Layout` + `Layout.Section` to stack the cards.
- `Card` (no more `.sdl-card`) for each section, with `title` / `subtitle`
  passed in the standard Polaris way.
- `Button` (primary / secondary), `TextField` (Logo URL), `Form` wrapping
  fetcher submissions.
- `Toast` from `Frame` for save-success notifications (replaces the inline
  "Logo saved." card that lingers until next navigation).
- `Badge` for metafield definition status (`created` / `exists` /
  `error`).

**UX wins locked in for this PR** (called out in the PR description, each
testable independently):

1. **App info → DescriptionList instead of five stacked pill cards.**
   Stats grid is denser and matches Shopify's own admin pattern (settings
   pages, billing summary). Saves ~250px of vertical space.
2. **Company logo → DropZone alongside the URL field.** Merchants can drag
   a PNG/JPG in and we'll Shopify-stage upload it, then write the staged
   URL back into the URL field. URL-paste path stays for advanced users.
   Replaces an unusual "paste any public image URL" pattern with the same
   flow merchants already know from product images.
3. **Appearance → ChoiceList (RadioButton group) "Light / Dark / System"
   instead of a toggle button.** "System" is new and reads `prefers-color-
   scheme`. Shows a live color swatch next to each choice so merchants see
   the effect before saving.
4. **Onboarding section grows a "Last completed" timestamp** read from
   `Shop.onboardingCompletedAt` (existing column we don't currently
   surface). Helps merchants remember they've actually been through the
   wizard.
5. **Metafield definitions → ResourceList with status badges.** Instead
   of stacked subtle cards, render a Polaris `ResourceList`. After
   running setup, the results toast appears + the list rerenders with
   updated badges. Visually closer to Shopify's own metafield-definition
   admin.

**Out of scope for PR #1** (deferred to PR #2 of 5C or to Slice 6):
- The `darkMode` toggle's interaction with Polaris theming — wired but
  the "System" option's auto-switch on `prefers-color-scheme` change is
  best-effort, not a guaranteed behavior. If `matchMedia` reports a
  change after page load, we don't live-switch; merchant re-renders by
  navigating.
- Logo uploads writing through to a Shopify staged upload — for the first
  pass, DropZone can be a UI-only "drop here, then we paste the resulting
  data URL into the URL field." Full staged-upload integration is a one-
  hour follow-up; not blocking the PR.

**Files that change in PR #1**:
- `app/routes/app.sdl3d.settings.tsx` — full rewrite.
- `app/routes/api.sdl3d.settings.tsx` — add a `saveDarkModeChoice`
  intent that accepts `"light" | "dark" | "system"` (the existing
  `saveDarkMode` boolean intent stays for back-compat until PR #5
  removes it).
- `prisma/schema.prisma` — `Shop.darkModeChoice String @default("light")`
  optional, plus a small migration. `Shop.darkMode` boolean column stays;
  PR #5 dual-writes then drops it.
- `app/styles/editor.css` — no removals yet (other pages still consume
  the classes). PR #5 handles the cleanup.

### PR #2 — Storage page

Just refactored in 5B. The list-of-providers structure maps directly onto
Polaris `ResourceList` with item actions for `Edit` / `Delete` / `Set as
default`. The inline edit panel becomes a Polaris `Modal`. The "+ Add
provider" button moves to the `Page` header as a `primaryAction`.

**UX wins**:
- Inline edit moves into a Modal — keeps merchants on one screen, no
  panel-pushes-the-list-down jank.
- Each row gets a "Last tested OK" / "Test failed" / "Not tested" Badge
  with color (success / warning / subdued).
- Delete confirmation moves to Polaris `ConfirmAction` (cleaner than
  `window.confirm`).
- Default badge becomes Polaris `Badge tone="success"` instead of a
  bespoke green span.

### PR #3 — Presets page

Smaller than expected once we saw the staging reference — the page is
primarily an empty-state surface today (merchants rarely save more than
a handful of presets). When non-empty, it's straight CRUD.

**Polaris components**:
- `Page` with `title="Hotspot Presets"` and `backAction={{ url: "/app/sdl3d/editor", content: "Editor" }}` (replaces the "Back to Editor" link in the corner — Polaris renders it as a chevron-prefixed link consistent with the rest of admin).
- `EmptyState` for the zero-state, with the existing "Select hotspots in the editor → Save as Preset" instruction as the body and an action button linking back to the editor.
- `ResourceList` (when non-empty) with row actions: Apply, Rename, Delete. Rename becomes `EditableText` inline.
- `Modal` for SaveAsPreset confirmation if the merchant lands here mid-flow.

**UX wins**:
- The current zero-state is a single subtle card that's easy to miss. Polaris `EmptyState` is purpose-built for this — illustration + heading + body + CTA. Merchants who hit Presets before saving any actually understand what to do.
- In-place rename via `EditableText`. Click the name, type, blur to save. No modal round-trip.
- Preset cards (when non-empty) show a color-swatch row of the 4–6 most-distinctive viewer settings — quick visual diff between similar presets.

### PR #4 — Dashboard / home + onboarding wizard

Mid-complexity. The current page (per staging reference) has five
distinct regions: hero card with "Open Editor" CTA, four stat cards,
search + status-filter tabs, product resource list, right sidebar with
Recent Sync Activity + Quick Actions. Plus the onboarding wizard modal
that shows on first visit when `shop.onboardingComplete = false`.

**Polaris components**:
- `Page` with `title="SDL 3D Hotspots"`, `subtitle="Manage 3D product viewers and interactive hotspots."`, and `primaryAction={{ content: "Open Editor", url: "/app/sdl3d/editor" }}` — replaces the bespoke hero card entirely. The hero card collapses into the standard Polaris page header.
- `InlineGrid columns={4}` of `Card` blocks for the four stats (Products configured, Published, Enabled on storefront, Recent syncs). Each card uses `BlockStack` with a large `Text variant="heading2xl"` for the number and a muted `Text variant="bodySm"` for the label.
- `Layout` with `Layout.Section` (main, two-thirds) + `Layout.Section variant="oneThird"` (sidebar).
- Main column: `Filters` component (search input + status tabs as filters) followed by `ResourceList` with custom item rendering — `Thumbnail` (the "3D" badge becomes a custom icon for products with a model file, else a plain placeholder), product GID as the title, hotspot count + mode + date as the subtitle, status badges in the item's accessibilityLabel + right-side tags.
- Sidebar: two `Card`s. "Recent Sync Activity" becomes a small `ResourceList` with `Badge` for the success/failure status. "Quick Actions" becomes a `BlockStack` of `Button` rows or a `CalloutCard`.
- Status badges (DRAFT/PUBLISHED, Disabled/Enabled) become Polaris `Badge` with appropriate `tone` (success for Published/Enabled, info for DRAFT, subdued for Disabled).
- **Onboarding wizard**: rewrite from the current bespoke fixed-position panel into a Polaris `Modal` series. Each step is its own Modal with `secondaryActions=[{content: "Skip", onAction}]` and `primaryAction={{content: "Next"}}`. `ProgressBar` at the top of the Modal shows step N of M.

**UX wins**:
1. **Onboarding modal series replaces the bespoke wizard.** Polaris handles `aria-modal`, focus-trap, return-focus, and Escape-to-close out of the box — current wizard has none of these. Big a11y win.
2. **Filters component unifies search + status tabs.** Today they're two separate controls; Polaris `Filters` combines them into a single search bar with chip-style filter pills below, matching how Shopify's own product list filters work.
3. **Stat cards become accessible.** Each card gets a proper `aria-label` from Polaris; today they're `<div>`-based with no semantic meaning.
4. **Sidebar collapses on mobile.** Polaris `Layout` is responsive — current bespoke flex layout breaks on `<1024px`.
5. **"Open Editor" CTA moves to the page header.** Consistent with every other Shopify admin page's primary action placement; today it's inside the hero card which is visually heavier than it needs to be.
6. **Resource list rows surface configuration state at a glance.** Today the row shows GID + hotspot count + mode + date + two status badges, all roughly equal-weight. Polaris ResourceList lets us put the product title as the dominant element, GID + date as muted subtitle, and tags + badges as right-aligned accessory content — clearer hierarchy.

**Out of scope for PR #4**:
- Product *title* resolution from Shopify (memory note: Slice 5A already resolves titles in the loader). Loader stays as-is; the ResourceList just renders what's there.
- Bulk actions across products (publish-many, disable-many) — Slice 6 candidate.

### PR #5 — Editor chrome (not the canvas)

The big one — splits into three sub-PRs based on the staging reference,
which shows three distinct chrome regions plus a status bar:

**5a — Top bar**:
- "Browse product" button, product display ("PRODUCT The Collection Snowboard: Hydrogen"), mode display ("MODE 360° Spin"), ready/saved status pills, Save draft / Publish buttons.
- Becomes Polaris `Page` header with `breadcrumbs` (Browse product), title (product name), `Badge` row for product/mode/status pills, `primaryAction={{ content: "Publish" }}` and `secondaryActions=[{content: "Save draft"}]`. Status pills become `Badge` with `tone` (ready=success, saved=info).
- **UX win**: save-status indicator currently lives as a small text pill. Promote to a Polaris `Banner` (dismissible, non-blocking) when transitioning between states — merchants always know whether their last edit is on disk.

**5b — Setup wizard column (left)**:
- "Setup" panel with 5 steps (Product / Media / Viewer / Hotspots / Publish), each with a green checkmark or open circle.
- Becomes a Polaris `Navigation` or custom `ResourceList` with `Icon` for checkmarks (`CheckIcon`, `CircleIcon`). Above the list, add a `ProgressBar` showing completion percentage based on `completedStepCount / 5`.
- **UX win**: progress bar quantifies "how far along this product is" — merchants currently parse the checklist visually. Bonus: makes the wizard-style flow scannable from the dashboard's resource list (could surface % complete per product in 5d follow-up).
- **UX win**: clicking a step in the wizard scrolls/focuses the relevant Inspector section. Today clicking the wizard items is decorative — making them functional is a one-liner with Polaris `Navigation` item `onClick`.

**5c — Inspector panel (right) + bottom status bar**:
- Four collapsible sections (Media / Viewer / Hotspots / Publish), each with its own form fields. Bottom status bar shows "Ready to publish" / "No issues" + readiness indicator.
- Inspector sections become Polaris `Card` with `Collapsible` and a header that toggles it. Each section's existing form fields swap to Polaris primitives (TextField, Select, Checkbox, ColorPicker, RangeSlider for camera orbit).
- Bottom status bar becomes a sticky Polaris `Banner` (`tone="success"` for ready, `tone="warning"` for issues with a list of unresolved items, `tone="critical"` for hard errors).
- **UX win**: the Inspector's "Media" section currently has "Enabled on storefront" buried below the file pickers. Move to its own Polaris `Card` at the top of the Inspector — it's the single most-toggled control and shouldn't require scrolling. (Verified pattern in screenshot — the toggle is visible but only because no other content is loaded.)
- **UX win**: bottom status bar surfaces validation errors inline. Today the bar says "No issues" or "Ready to publish" but doesn't itemize what's failing if there are issues. Polaris `Banner` lists each unresolved item with a deep-link into the Inspector section that owns it.

The 3D viewer canvas and hotspot overlays stay non-Polaris per Decision
#5. Each sub-PR is independently shippable; landing all three is what
"PR #5 complete" means.

**5d — AppBridge hydration cleanup (carried into PR #5 from PR #0 bisect):**
- Replace the raw `<s-app-nav>` / `<s-link>` web components in
  [app/routes/app.tsx](sdl-3d-hotspots/app/routes/app.tsx) with the
  React-component equivalents — `NavMenu` and `Link` from
  `@shopify/app-bridge-react`. The React components hydrate cleanly because
  they own their own DOM rather than relying on a browser custom-element
  upgrade that races React's hydration pass.
- Expected outcome: Firefox console clean of React `#418` / `#423` errors,
  embedded shell SSRs correctly, ~50–200ms first-paint improvement on
  perf-sensitive routes (especially the editor).
- Why this lives in PR #5 specifically: the editor is the page where lost
  SSR hurts most (largest React tree, most expensive client-render
  cascade). Fixing it here closes the loop the same PR that's most likely
  to regress on it. See [feedback_appbridge_hydration.md](C:/Users/Spectrum%20Design%20Lab/.claude/projects/c--dev-sdl-3d-hotspots/memory/feedback_appbridge_hydration.md) for full diagnosis.
- ~30 min of work; can land independently of 5a/5b/5c.

### PR #6 — CSS cleanup

Delete `.sdl-card`, `.sdl-btn` (and all modifiers), `.sdl-subtle-card`,
`.sdl-input`, `.sdl-label`, `.sdl-text-muted`, `.sdl-badge`, `.sdl-mb-*`,
the `data-theme` selectors. Keep `.sdl-editor` viewer-canvas / hotspot
overlay rules.

Run a `grep -r "sdl-card" app/` and similar for each class before deletion
— any remaining consumer means a page wasn't fully migrated and we revisit.

## Edge cases & invariants

1. **Embedded iframe body lock.** Memory note `feedback_shopify_body_lock.md`
   says embedded apps need a `:has()` lock + `position: fixed` to avoid
   double scrollbars. Polaris' `Frame` component handles its own scroll
   container; our existing body-lock CSS may fight with it. Verify on PR
   #0's substrate — if Frame's scroll container conflicts, our lock CSS
   wins by specificity and Polaris layouts break. Resolution: scope the
   `body { overflow: hidden }` rule to non-Polaris pages only during the
   migration, drop it entirely in PR #6.

2. **Polaris CSS bundle size.** Adds ~200KB gzipped. Acceptable; we already
   ship `model-viewer` (1MB) which dwarfs it. Consider a route-level dynamic
   import only if the dashboard route's first-byte latency regresses on
   staging.

3. **Server-side rendering of Polaris.** React Router 7 SSR + Polaris is
   supported but has historically had hydration mismatches around theme
   tokens. The `<AppProvider>` must be inside the route module, not in
   `root.tsx`, so the initial server HTML matches the client. Verify on
   PR #0 — first paint should not flash unstyled content.

4. **The `darkMode` boolean → `darkModeChoice` enum migration.** PR #1's
   migration adds the new column with default `"light"`. Loader reads both,
   prefers `darkModeChoice` if set, falls back to mapping
   `darkMode ? "dark" : "light"`. PR #5 dual-writes; PR #6 drops the
   boolean column. Three-PR migration matches the
   "schema-first, then code, then cleanup" pattern from 5B.

5. **Test-connection / save-credentials fetchers in Storage.** PR #2's
   Modal uses Polaris `Form`. `useFetcher` integrates cleanly via
   `<Form onSubmit={handleSubmit}>` where `handleSubmit` calls
   `fetcher.submit(formData, {...})`. Verified pattern in Polaris docs.

6. **App Store readiness audit.** After PR #5 lands, run Shopify's
   `app-design-review` tool (free, hosted at admin.shopify.com/apps/...)
   against staging. Failures get logged into Slice 6 / 7.

## Build / typecheck checklist (per PR)

```bash
npx prisma generate            # PR #1, #5 only — others have no schema changes
npx tsc --noEmit
npm run build                  # CRITICAL — RR's .server import rule
```

Polaris adds about 4–6 seconds to the Vite build. Acceptable.

## Staging smoke checklist (per PR)

Each PR is its own staging deploy + smoke. Generic shape:

1. Visual diff against the page's pre-5C screenshot. Should match the
   PR's "UX wins" callout — anything else is a regression.
2. All forms still submit successfully (save, test, delete intents).
3. Dark mode toggle still works (PR #1 verifies the new ChoiceList; later
   PRs verify the existing theme survives the migration).
4. Keyboard nav: Tab through the page, every focusable element gets a
   visible Polaris focus ring. No focus-traps unless explicitly desired
   (Modal).
5. Mobile breakpoint (Polaris `Page` is responsive by default — verify on
   `360x640` in DevTools).

## Backout strategy

Each page-migration PR is independently revertable. If PR #2 (Storage)
regresses on staging, revert it without touching PR #0 or PR #1 —
PR #2's diff is scoped to one route file and (probably) one component.

PR #0 (substrate) is the only one that's hard to revert cleanly because
later PRs depend on the AppProvider being mounted. Revertable until
PR #1 lands; after that, treat as load-bearing.

## Out of scope for 5C (notes for future slices)

- **Editor top-bar storage selector** — Slice 6, after 5C ships and the
  Polaris top-bar component exists.
- **Per-product or per-upload storage override** — Slice 6 if a merchant
  requests it. Not committed.
- **App Store listing assets** — separate Phase-2 track (icons,
  screenshots, listing copy). 5C is a prerequisite, not part of it.
- **Localization** — Polaris ships `i18n.en` only by default. Adding more
  locales is a separate slice.
- **Storefront-rendered viewer** — Theme App Extension stays on its own
  bespoke CSS. Polaris is admin-only.
- **Dashboard config deletion** — let merchants remove orphaned
  `ProductConfig` rows (especially those tagged "Deleted on Shopify" after
  the title-resolve flow) so they can start fresh on a product. Probable
  shape: a per-row "Remove" action surfaced when a row is flagged
  `productMissing`, plus a bulk "Delete all orphaned configs" action in
  the dashboard's ResourceList header. New API intent on
  `/api/sdl3d/onboarding` or a new `/api/sdl3d/configs` route. Slice 6
  candidate. Requested by user 2026-05-18 after PR #4's resolve fix
  exposed orphaned test rows on staging.
- **Reuse existing bucket folders for 360° sequences** — when a merchant
  has already uploaded a frame set to their object-storage bucket
  (via CLI, another shop's instance, or manually), let them point a
  product at that folder instead of re-uploading through the capture
  pipeline. Requires: (a) new `api.sdl3d.storage.tsx` intent
  `listBucketFolders(prefix)` returning a tree of frame-bearing
  prefixes; (b) editor inspector UI (under "Media") with a folder
  picker Modal that browses the default ShopStorage row; (c) a
  "use selected folder" path that writes the resulting frame URLs
  into `ProductConfig.imageSequenceJson` + `frameCount` without
  enqueuing a `processCapture` job. Slice 6 candidate. Requested by
  user 2026-05-18.

## Pre-5C reference screenshots

User provided staging screenshots during 5C plan kickoff (2026-05-13)
covering every page that will migrate. Save these into
`docs/screenshots/pre-5c/` before PR #0 lands so they're version-pinned
to the pre-5C visual state:

- `settings.png` — five stacked cards (App info / Company logo / Appearance / Onboarding / Metafield definitions). Currently rendered light theme.
- `storage.png` — single DigitalOcean Spaces provider row with DEFAULT badge, Edit/Delete buttons, "+ Add provider" below. (Slice 5B's list-of-providers layout.)
- `presets.png` — empty state ("No presets yet") + "Back to Editor" link in header corner. Most merchants will see this view; reference confirms PR #3's EmptyState focus is correct.
- `home.png` — hero card with "Open Editor", four KPI stat cards, search + All/Published/Drafts tabs, product resource list, right sidebar (Recent Sync Activity + Quick Actions).
- `editor-360.png` — three-column layout (Setup wizard left / 360° viewer canvas center / Inspector panel right) with top bar (Browse product / product / mode / status pills / Save draft / Publish) and bottom status bar ("No issues" / "Ready to publish").
- `editor-3d.png` — still to capture (same chrome as 360 but with `<model-viewer>` in the canvas region).
- `home-onboarding.png` — still to capture (first-visit state with the onboarding wizard panel visible). Run `intent=resetOnboarding` against the staging shop to surface it.

These are the visual baseline each PR's "UX wins" callout is measured
against. If a PR's smoke test diverges from the screenshot in any way
not explicitly called out in the PR description, treat that as a
regression and investigate.

## Shipped — final tally (2026-05-19)

All 14 PRs on `main`, every one validated on staging
(`spec-test-2.myshopify.com`). Commits:

| PR | SHA | Day | Scope |
| --- | --- | --- | --- |
| #0 substrate | `64aa66f` (+ `c975607`, `8d73838` follow-ups) | 2026-05-13 | Install Polaris 13.9.5, wire `AppProvider`, hydration cleanup |
| #1 Settings | `f0bf903` | 2026-05-18 | DescriptionList, ChoiceList, ResourceList of metafield defs |
| #2 Storage | `833c850` | 2026-05-18 | ResourceList of providers, Modal add/edit, Page primaryAction |
| #3 Presets | `6dc0757` | 2026-05-18 | EmptyState, ResourceList, inline rename, Collapsible expand |
| #4 Dashboard | `c40eca1` (+ `96eff38`, `182eee4`) | 2026-05-18 | Page header, InlineGrid stats, Filters, Thumbnail ResourceList, onboarding Modal series |
| #5a Editor top bar | `1e4ac79` | 2026-05-18 | Button + Badge primitives in existing topbar |
| #5b Editor wizard | `eea99ba` | 2026-05-18 | Card + ProgressBar + ActionList sidebar |
| #5c Editor inspector | `e1d1f64` | 2026-05-18 | InspectorSection (Card + Collapsible), "Storefront visibility" top card, bottom Banner with itemized errors + "Jump to" deep-links |
| #5d AppBridge swap | `5a0107b` | 2026-05-18 | `<NavMenu>` + `<a>` replaces `<s-app-nav>`/`<s-link>`; closes Firefox `#418`/`#423` |
| #5e Preset+Product modals | `df348bd` | 2026-05-18 | Polaris Modal + ResourceList + EmptyState |
| #5f FileBrowser chrome | `d43441c` | 2026-05-18 | Polaris Modal + TextField + ButtonGroup; grid/list toggle dropped |
| #5g FileBrowser inner grid + save-preset | `13c1d15` | 2026-05-18 | Polaris InlineGrid of `FileTile`/`FolderTile`; last `.sdl-modal*` extinct |
| #5h RawCaptureUploader | `76694d3` | 2026-05-19 | Card + Banner + ProgressBar + Spinner state machine UI |
| #5i ViewerSettingsEditor | `4608e92` | 2026-05-19 | TextField/Select/Checkbox swap |
| #5j HotspotEditor (3D) | `4a5fcff` | 2026-05-19 | Polaris fields + Collapsible inner sections; new `.sdl-hs-*` row tokens |
| #5k Hotspot360Editor | `3ff7fc1` | 2026-05-19 | Per-row Collapsible expand; legacy `.sdl-hotspot-*` CSS swept |
| **#6 final sweep** | `643333d` | 2026-05-19 | 6 stragglers migrated (FileTriggerCard, TopbarField, JsonAdvancedPanel, ErrorBoundary, BG controls, toast close); `sed -i` deletes 24 dead CSS blocks; `globals.d.ts` trimmed 13→4 `s-*`; **editor.css 1,948→1,287 lines (-34%)**; `[data-theme="dark"]` block deleted |

**End-state of `app/styles/editor.css`** (kept blocks only):
- `.sdl-editor*` shell + grid/sidebar/main/inspector/topbar/bottombar layout
- `.sdl-fb-tile*` / `.sdl-fb-folder*` — file-browser grid tiles (PR #5g)
- `.sdl-hs-row*` / `.sdl-hs-swatch*` / `.sdl-hs-section__trigger` — hotspot rows (PR #5j+#5k)
- `.sdl-ft*` — file-trigger cards (PR #6)
- `.sdl-inspector-section__trigger` — Card collapsible header (PR #5c)
- `.sdl-toast*` — notification toast (Polaris Toast needs Frame wrapper we don't have)
- `.sdl-main-tabs` / `.sdl-viewer-type-toggle` / `.sdl-mode-toggle*` — functional toggles inside viewer canvas (kept per viewer-overlay carve-out)
- `.sdl-preview*` / `.sdl-storefront-preview*` / `.sdl-360-preview*` / `.sdl-360-hotspot*` / `.sdl3d-hotspot*` — viewer canvas overlays + storefront-rendered hotspots (explicitly kept per Decision #5)

All non-overlay rules are built on Polaris design tokens (`--p-color-*`,
`--p-space-*`, `--p-border-*`, `--p-focus-ring-outline`) for visual
coherence with Shopify admin.

**Memory artifacts generated by this slice** (saved to
`~/.claude/projects/c--dev-sdl-3d-hotspots/memory/`):
- `feedback_appbridge_hydration.md` — Firefox `#418`/`#423` diagnosis (now closed by PR #5d).
- `feedback_polaris_event_gotchas.md` — Polaris `Button.onClick` has no event arg; Polaris `Box` has no `onClick`.
- `feedback_polaris_button_children_typed_as_string.md` (referenced) — `<Button>label {n}</Button>` doesn't compile; use template literals.
- `feedback_stale_tracking_ref.md` — `git push` "Already up to date" can lie; `git fetch origin` first.
- `feedback_runbook_placeholders.md` — never write `<PAT>` or `<YOUR-PAT>` placeholders in copy-paste deploy blocks; use `read -s -p` for secrets.
- `feedback_push_deploy_split.md` — Claude pushes from its Bash session; user runs Unraid deploy.

## Open follow-ups for whoever picks up next

Nothing blocking. All Slice 6 candidates are queued in the "Out of
scope for 5C" section above and in the `slice 6 candidates queued in
plan doc` bullet of memory's [unified_app_pivot](C:/Users/Spectrum%20Design%20Lab/.claude/projects/c--dev-sdl-3d-hotspots/memory/unified_app_pivot.md).
Top three by ROI:

1. **Dashboard config deletion** (requested 2026-05-18) — per-row
   "Remove" action surfaced when a config is flagged `productMissing`,
   plus a bulk "Delete all orphaned configs" action in the dashboard's
   ResourceList header. New API intent on `/api/sdl3d/configs` (or
   `/api/sdl3d/onboarding`). Small surface, high merchant-clarity win.
2. **Reuse existing bucket folders for 360° sequences** (requested
   2026-05-18) — let merchants point a product at frames already in
   their bucket, skipping the capture pipeline. Adds
   `listBucketFolders(prefix)` intent to `api.sdl3d.storage`,
   folder-picker Modal in editor inspector, and a write path that
   sets `ProductConfig.imageSequenceJson` + `frameCount` directly.
3. **Editor top-bar storage selector** — was deferred from 5B
   planning. Lets a merchant override the default storage row for the
   current capture without going to the Storage settings page.

Other queued candidates (lower priority): Logo DropZone with real
Shopify staged upload (PR #1 deferred), "System" theme option +
`darkModeChoice` column (PR #1 deferred), App Store listing assets
(separate Phase-2 track), localization (more than en).

Non-Slice-6 cleanup still possible inside the codebase: migrate the
`auth.login` route from `<s-page>`/`<s-section>`/`<s-text-field>`/
`<s-button>` to Polaris, then `globals.d.ts` can drop to 1 declaration
(`model-viewer` only). Worth it only if the OAuth login UX gets a
broader visual pass.
