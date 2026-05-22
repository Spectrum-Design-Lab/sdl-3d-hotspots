# Slice 8 — Editor polish, viewer settings, hotspot rework

> **STATUS: IN FLIGHT.** Author SDL + Claude, 2026-05-21. Picks up after
> Slice 7 (`a699a0a..43d7ec9`, 9 commits, no schema changes). Slice 8
> is broader than 7 — three sub-clusters of work running in parallel
> rather than a single thematic arc. Two sub-clusters are already
> done (quick wins, viewer-settings); this doc primarily formalizes
> the third (hotspot editor rework + animations + media), with the
> still-open small items captured in the backlog section at the end.

## What's already shipped in Slice 8

For context — these landed before this plan was written, working
from the "Out of scope for Slice 7" backlog in
[docs/slice-7-plan.md](slice-7-plan.md). They appear here so future
slice rollups can see Slice 8 as one cohesive set without spelunking
git history.

### Sub-cluster A — Quick wins (`e55d704..cf9c9f4`)

Small high-value items that didn't need their own slice doc:

- **PR #1** (`e55d704`+`d363a70`) — silence storefront diagnostic on
  live storefronts. The "3D viewer is not enabled for this product."
  string only renders inside `request.design_mode` now. Customers see
  zero-height when the merchant has the block on a product without a
  configured viewer.
- **PR #2** (`75c2abe`) — editor "Delete this config" button with
  navigation-after-delete handling. Carried forward from Slice 6's
  out-of-scope.
- **PR #3** (`d00b86f`+`cf9c9f4`) — presets page fixes:
  count/list mismatch repaired (3D vs 360 hotspots fed to the right
  rendering surface), per-row Edit Modal for title/body/colour
  changes, and a filter ChoiceList at the top of the page for
  `All | 3D Model | 360° Spin`.

Plus one TAE housekeeping commit:

- **`9b65ba6`** — trim `viewer.js` below the 10 KB AppBlockJavaScript
  threshold so the asset-block budget doesn't fail validation. Pure
  size cleanup, no behaviour change.

### Sub-cluster B — Viewer settings polish (`d2600f4..2da8a9c`)

Three PRs landing related viewer-settings improvements:

- **PR #1** (`d2600f4`) — gate viewer-settings fields by viewer type.
  3D-only fields hide under IMAGE_360 mode with a "Shown for 3D
  models only." subtitle so merchants know the values aren't deleted.
- **PR #2** (`69bf42d`) — `autoRotateSpeed` + `autoRotateDirection`
  in viewer settings. Inspector exposes RangeSlider for speed +
  segmented ButtonGroup for direction, only visible when `autoRotate`
  is on. TAE parallel patches both viewers.
- **PR #3** (`2da8a9c`) — shop-level default background colour with
  per-product override. New `Shop.defaultViewerBackgroundColor`
  column (migration `20260521170000_shop_default_bg_color`); publish
  resolves `productOverride ?? shopDefault ?? hardcoded` and writes
  the result into the product metafield. Editor TextField shows the
  shop default as placeholder + "Reset to default" button.

### Sub-cluster C — Hotspot editor rework + animations + media

**This doc's primary scope.** Five PRs, ~6–8 days, larger than the
other two sub-clusters combined. Detailed plan below.

## Why the hotspot rework exists

Slice 7 cleaned up the editor's outer chrome (topbar, tabs,
publish-status). Merchant testing immediately surfaces that the
*inner* hotspot editor is now the dense surface — every hotspot row
shows every field, all the time, with no escape hatch for the merchant
who only wants three labelled dots. Plus four feature requests pile up
on the same surface:

1. **Hotspot rows show every field at all times.** Title, body, color,
   style, icon, CTA label/url, focus orbit, position pickers — for
   3D — plus keyframes for 360. Merchant cognitive load is "decide on
   eight things to add a hotspot." Most edits are title + body +
   colour. A Simple/Advanced toggle at the InspectorSection level
   removes ~70% of the chrome for the common case.
2. **No animation on hotspot dots.** Statically-painted dots on a
   product image disappear into busy photography. Merchants want
   subtle motion — pulse, ripple, glow — to draw the eye. Today's
   storefront and editor render dots with no animation field.
3. **Icon library is fixed at ~6 preset names.** Merchants who want
   their brand's iconography or domain-specific symbols (e.g. spec-
   sheet icons for industrial products) can't add custom assets.
4. **Hotspot body is plain text only.** Merchants ask for "an image
   inside the popup" or "a YouTube video showing the part in use" —
   prose alone can't carry product detail at the level merchants
   expect from a 3D viewer experience.
5. **Hotspot row chrome is already at its visual limit.** Even
   *before* adding animation pickers + custom-icon pickers + media
   slot pickers, the row's expanded panel scrolls. Cramming five more
   controls into it without a layout pass is a regression on top of
   Slice 7's chrome win.

Five surfaces; ~6–8 days if no surprises. Order is "foundation
first" — row layout and Simple/Advanced toggle land before the new
field PRs slot into the redesigned chrome.

## Decisions locked

Confirm at PR-1 kickoff; not open for re-litigation unless a
later PR surfaces a concrete reason.

1. **Row layout: inline-expand panel, grouped subsections.** Each
   hotspot row stays a card; the expanded body groups fields into
   labelled subsections via Polaris `BlockStack` headers:
   - **Content** — title, body, color, icon (+ "Add image" /
     "Add video" slot triggers in Advanced).
   - **Appearance** — style variant, animation (Advanced only).
   - **Layout** — position pickers (3D) or keyframes (360);
     focus orbit gated to Advanced.
   - **Behavior** — CTA label/url (Advanced only).

   This replaces the current ad-hoc Collapsible "Position & Camera" +
   "Advanced" split inside each row. Subsection headers are
   non-collapsible by default; the whole row stays one Collapsible
   gate. Decided over tabs-inside-row (too much chrome) and
   side-panel-detail-editor (too many navigation levels for a list
   of 3–10 hotspots).

2. **Mode preference: per-shop, default Simple.** New column
   `Shop.hotspotEditorMode String @default("simple")` (one migration,
   single source for all the sub-cluster's mode-gated fields). Saves
   on toggle via a fetcher; no re-render storm. **Decided per-shop
   over per-product** — a merchant's preference for chrome density
   doesn't change per-product, and per-product would mean the toggle
   travels with the active product card, which is more confusing
   than a stable section-level control.

3. **Simple-mode field set** (visible in both 3D and 360 editors):
   - title, body, color
   - position pickers (3D) / keyframes (360) — the *minimum* a
     hotspot needs to be visible somewhere; can't be hidden
   - visible toggle + delete

   **Advanced-mode field set** (Simple PLUS):
   - icon (incl. custom-icon picker)
   - style variant Select
   - animation Select
   - mediaImageUrl + mediaVideoUrl pickers
   - ctaLabel + ctaUrl
   - focus orbit / camera target (3D only)
   - visibleFrameStart / visibleFrameEnd (360 only) — see note 4
   - numeric position / keyframe coords (360 only)

4. **Frame visibility range stays Advanced** because the *default*
   for a hotspot is "visible across all frames" — merchants rarely
   need to scope. Simple mode merchants get the full-range default
   and never see the controls. The full-range default already lives
   in `blankHotspot360` and won't change.

5. **Animation library v1 — five values, idle trigger, CSS-only.**
   - `animation: "none" | "pulse" | "bounce" | "glow" | "ripple" | "wiggle"`,
     default `"none"`. Default preserves current behaviour for
     existing hotspots.
   - **Trigger style: idle (always animating).** Most visible default;
     per-hotspot trigger style (idle vs hover vs intersect) is a v2
     if merchants ask.
   - CSS `@keyframes` blocks live in
     `extensions/product-3d-viewer/assets/viewer.css`. Each viewer
     (.js) sets `data-sdl3d-anim="<value>"` on the dot element;
     CSS selects on the attribute.
   - **`prefers-reduced-motion: reduce` disables all animations.**
     Wrap the keyframe rules inside the media query. Accessibility-
     sensitive customers see static dots. Editor preview honours
     the same media query (`@media` in CSS-modules-equivalent — or
     a `useMediaQuery` hook if React-side gating is cleaner).

6. **Custom icons reuse the existing `icon` string field.** No field
   rename. Storefront and editor detect:
   - Preset name (value in known-preset set) → render inline SVG
     from the bundled library.
   - GID (starts with `gid://shopify/`) → resolve through staged
     file URL like the model_file path does.
   - Absolute URL (starts with `https://`) → render `<img>` directly.

   **Collision risk**: a preset name overlap with a real URL is
   impossible because preset names don't have `://` or `gid://`. The
   detection is unambiguous via prefix.

7. **Icon picker UI: two Polaris `Tabs` inside the existing icon
   selector** — "Preset" and "Custom". Preset tab shows ~14 named
   icons (`plus, minus, info, warning, star, heart, check, x, arrow-
   up, arrow-down, arrow-left, arrow-right, play, settings`) rendered
   as inline SVG swatches in a 7-column grid. Custom tab is a
   single `FileTriggerCard` (re-using the Slice 5C pattern) that
   opens `FileBrowserModal` in IMAGE mode. Selecting a file writes
   its GID to `icon`. Live preview swatch above the tabs shows the
   currently-selected icon at render size. Sizing copy: "32×32 SVG
   recommended; raster images render at 32×32 (display); larger
   files cost bandwidth, smaller files pixelate."

8. **Media slots: typed fields, slot-style rendering.**
   - `mediaImageUrl: string | null` — Shopify GID or absolute URL.
     Editor uses a `FileTriggerCard` mirroring the existing model/
     poster pickers.
   - `mediaVideoUrl: string | null` — URL only (no Shopify Files
     wrapper). Three providers detected by URL pattern:
     - YouTube (`youtube.com/watch?v=`, `youtu.be/`) → render
       `<iframe>` with `youtube.com/embed/<id>`
     - Vimeo (`vimeo.com/<id>`) → `<iframe>` with `player.vimeo.com/video/<id>`
     - Direct `.mp4` / `.webm` → `<video controls>`
   - Storefront popup layout: media (top, max-height 240px or 16:9
     aspect) → title → body → CTA. Same order on both viewers.
   - **No Markdown / WYSIWYG body for v1.** Inline-prose styling is
     the stretch goal carried forward from Slice 7. Plain `<p>` for
     body text continues to be the contract.

9. **No animation rendering in the editor canvas preview.** Hotspot
   editor's preview surface stays static. **Reason**: the editor is
   for *editing* — moving animated targets is harder, and merchants
   need to see colour/title clearly while placing. The standalone
   `StorefrontPreview` route gives them the animated view when they
   want to see it.

10. **Schema changes are minimal**: two migrations total across
    the sub-cluster. PR #2 adds `Shop.hotspotEditorMode`; PR #3
    adds `Hotspot.animation` (nullable; `null` = "none"). 360
    hotspots stay JSON-blob and don't need a column; 3D hotspots
    are stored relationally (one `Hotspot` row per hotspot) so any
    field that needs to round-trip through the publish path lands
    as a column. PRs #4 and #5 add no new columns — icon GID detection
    reuses the existing `icon` string; media slots ride in the 360
    JSON blob and (TBD) either the existing relational columns or a
    small `metadataJson` blob for 3D — locked at PR #5 kickoff.
    Existing rows tolerate missing fields with defaults.

## Migration order — PR-by-PR

PRs within this sub-cluster are numbered with the "hotspots" prefix
to match the viewer-settings sub-cluster's pattern:
`Slice 8 hotspots PR #1`, `#2`, etc.

### Hotspots PR #1 — Row layout redesign

Foundation. Touches only chrome; no field changes. Lands first so
later PRs slot their new controls into the right subsection without
re-doing the layout.

**Changes**:
- Reshape the per-row expanded Collapsible body in both
  `Sdl3dHotspotEditor.tsx` (3D) and `Sdl3dHotspot360Editor.tsx` (360):
  - Replace the inner "Position & Camera" + "Advanced" Collapsibles
    with non-collapsible subsection headers: **Content**,
    **Appearance**, **Layout**, **Behavior**.
  - Subsection header = Polaris `Text variant="headingXs"` +
    `Box paddingBlockStart="200" paddingBlockEnd="100"`.
  - Fields inside each subsection laid out with Polaris `BlockStack
    gap="200"`. Two-column field grids (e.g. ctaLabel + ctaUrl
    side-by-side) use `InlineGrid columns={2} gap="300"`.
- Top-of-section: a section-level header InlineStack with the
  "Add hotspot" Button on the right. The Simple/Advanced toggle
  control lands here in PR #2; this PR leaves a `null` placeholder.
- Row collapsed-state row chrome stays as-is from Slice 5C/7
  (`.sdl-hs-row*` classes + Polaris tokens). No CSS rewrites unless a
  subsection header conflicts visually.
- `dragIndex` / drag-reorder behaviour unchanged.

**UX wins**:
1. Expanded rows scan top-to-bottom in field-meaning order, not in
   "primary fields then collapsible advanced" order. Merchant doesn't
   have to click two carets to see CTA URL.
2. Subsection headers act as visual landmarks for the merchant
   scanning a long row. Today's flat list of TextFields blurs.
3. Foundation for the Simple/Advanced gate in PR #2 — subsections
   become the natural hide/show units.

**Files**:
- `app/components/Sdl3dHotspotEditor.tsx` — strip inner Collapsibles,
  add subsection BlockStacks.
- `app/components/Sdl3dHotspot360Editor.tsx` — same reshape.
- `app/styles/editor.css` — possibly small additions if subsection
  header spacing needs a tweak; prefer Polaris tokens via Box props.

**Out of scope**:
- Field additions (defer to #3–#5).
- The Simple/Advanced toggle itself (PR #2).
- 3D detail-editor pane vs 360 inline-expand difference — both
  surfaces just use subsections; the structural split between 3D
  (separate detail editor panel) and 360 (inline expand) stays as-is
  for v1. Unifying them is a Slice-9 candidate.

### Hotspots PR #2 — Simple/Advanced editor mode

Foundation continuation. Introduces the Shop preference and gates
field visibility. Lands the toggle UI; all current fields stay
present (no field deletions). The "Advanced-only" gate becomes
load-bearing in PRs #3–#5 when new fields slot exclusively into
Advanced.

**Changes**:
- **Schema**: add `hotspotEditorMode String @default("simple")` to
  `Shop` in `prisma/schema.prisma`. New migration
  `20260522000000_shop_hotspot_editor_mode` (placeholder date —
  adjust on commit).
- **API**: new intent `setHotspotEditorMode` on `api.sdl3d.settings.tsx`
  (or extend an existing intent — whichever fits cleaner). Body:
  `{ mode: "simple" | "advanced" }`. Updates `Shop.hotspotEditorMode`.
- **Loader**: editor route reads `shop.hotspotEditorMode` and passes
  it as a prop into both hotspot editors.
- **UI**: section-level `ButtonGroup segmented` toggle at the top
  of the Hotspots InspectorSection: `Simple | Advanced`. Polaris
  `ChoiceList` is the alternative but ButtonGroup is more compact
  for a binary toggle.
- **Gating**: each hotspot editor accepts an `editorMode` prop. In
  Simple mode:
  - Hide subsections "Appearance" and "Behavior" entirely.
  - In "Content", hide the icon picker; keep title/body/color.
  - In "Layout", hide focus orbit (3D); hide visibleFrameStart /
    visibleFrameEnd + numeric coord fields (360); keep position
    pickers / keyframe scrubber drag.
- **Tooltip / explainer**: a Polaris `Tooltip` on the Advanced
  segment of the toggle: "Show all hotspot fields — icons, animations,
  media, CTAs, focus camera." One-line, no second-paragraph
  pedagogy.

**UX wins**:
1. New merchants in Simple mode see ~3 fields per hotspot row
   expanded (title, body, color) — vs ~8 today. Faster path to
   "labelled dot" workflow.
2. Power users flip to Advanced once and stay. Per-shop preference
   means it doesn't reset per session.
3. Hidden values persist quietly. A merchant who set a focus orbit
   in Advanced, then flipped to Simple, keeps the value — flipping
   back surfaces it unchanged.

**Files**:
- `prisma/schema.prisma` — Shop column add.
- `prisma/migrations/<timestamp>_shop_hotspot_editor_mode/migration.sql`.
- `app/lib/sdl3d-shared.ts` — `HotspotEditorMode` union type export.
- `app/lib/sdl3d-graphql.server.ts` — extend `ensureShop` return shape
  if it doesn't already surface `hotspotEditorMode`.
- `app/routes/api.sdl3d.settings.tsx` — `setHotspotEditorMode` intent.
- `app/routes/app.sdl3d.editor.tsx` — loader threading + section-level
  toggle UI.
- `app/components/Sdl3dHotspotEditor.tsx` — accept `editorMode`,
  apply gates.
- `app/components/Sdl3dHotspot360Editor.tsx` — same.

**Out of scope**:
- New fields. PRs #3–#5 add them; Simple/Advanced just gates which
  show.
- A per-product override. If a merchant wants Advanced for one
  product but Simple for another, they flip. Cheap operation.

### Hotspots PR #3 — Hotspot animations

Lands the first net-new field. Touches the Zod schema, the editor
ChoiceList, the storefront CSS, and **both** TAE viewer JS files.

**Changes**:
- **Schema (Zod)**: add `animation` to `HotspotSchema` and
  `Hotspot360Schema` in `@spectrum-design-lab/shared`. Union
  `"none" | "pulse" | "bounce" | "glow" | "ripple" | "wiggle"`,
  default `"none"`. Optional input (existing rows get the default).
- **Editor**: under the "Appearance" subsection (Advanced only),
  add a Polaris `Select`:
  ```
  Animation: [None ▾]
            None
            Pulse
            Bounce
            Glow
            Ripple
            Wiggle
  ```
  No live-preview in the editor canvas (per locked decision #9);
  the storefront-preview route shows it.
- **Storefront CSS**
  (`extensions/product-3d-viewer/assets/viewer.css`):
  ```css
  @media (prefers-reduced-motion: no-preference) {
    .sdl3d-hotspot[data-sdl3d-anim="pulse"] {
      animation: sdl3d-pulse 1.6s ease-in-out infinite;
    }
    /* ...one block per animation... */
    @keyframes sdl3d-pulse { /* ... */ }
    /* ...one block per animation... */
  }
  ```
  Five keyframe blocks; sizes chosen to be visible but not noisy
  (no large translations, no opacity-to-zero — the dot has to stay
  clickable). Concrete tuning per animation gets locked at PR
  kickoff with a Polaris swatch palette comparison.
- **Storefront JS** — parallel patches:
  - `extensions/product-3d-viewer/assets/viewer-3d.js`: when
    creating each hotspot button, set
    `el.dataset.sdl3dAnim = hotspot.animation ?? "none"`.
  - `extensions/product-3d-viewer/assets/viewer-360.js`: same
    pattern, inside the existing dot-placement code path.
- **Editor preview** — no animation rendering (per locked
  decision #9). Subsequent CSS work is storefront-side.

**UX wins**:
1. Hotspots draw the eye on product photography. Subtle motion is
   the standard interaction-design cue for "click me."
2. Five-animation library covers the common idiomatic options
   without ballooning the CSS or the choice space.
3. `prefers-reduced-motion` honoured = no motion-sickness regression.

**Files**:
- `sdl-platform/packages/shared/src/sdl3d-schemas.ts` — add `animation`
  to the shared Zod schemas. Bump package version, republish if your
  TAE build pulls from the registry; otherwise local-link refresh.
- `app/components/Sdl3dHotspotEditor.tsx` — Animation Select in
  Appearance subsection.
- `app/components/Sdl3dHotspot360Editor.tsx` — same.
- `extensions/product-3d-viewer/assets/viewer.css` — 5 keyframes +
  attribute selectors.
- `extensions/product-3d-viewer/assets/viewer-3d.js` — set
  `data-sdl3d-anim` on hotspot creation.
- `extensions/product-3d-viewer/assets/viewer-360.js` — same.

**Out of scope**:
- Per-hotspot trigger control (idle vs hover vs intersect). v2.
- Animation easing/duration customization. v2.
- Editor preview rendering animations. Locked decision #9.

### Hotspots PR #4 — Custom icons

Extends the icon picker to support merchant-uploaded icons. No
schema changes — `icon` is already a string field; semantics expand
to include URL/GID values.

**Changes**:
- **Editor**: replace the existing icon Select / swatch row with a
  new `Sdl3dIconPicker` component. Two Polaris `Tabs`:
  - **Preset** — 14 named icons in a 7-column grid of swatches.
    Selecting writes the preset name (e.g. `"plus"`) to `icon`.
  - **Custom** — `FileTriggerCard` opening `FileBrowserModal` in
    IMAGE mode (mirroring the existing model/poster pickers).
    Selecting writes the file GID to `icon`.
  - Live preview swatch above the tabs shows the currently-selected
    icon rendered at 32×32 (its storefront render size).
- **Preset library expansion**: bundle inline SVG paths for 14
  icons. Today the rendering logic lives inside the storefront JS
  and editor preview; both share the same constant table. New
  file `app/lib/hotspot-icons.ts` exporting the preset name → SVG
  path constant. Storefront has a parallel copy at
  `extensions/product-3d-viewer/assets/icons.js` (or inline in the
  viewer JS files); same content, parallel-patch convention.
- **Storefront detection** in both viewer JS files:
  ```js
  function iconHtml(value) {
    if (!value) return "";
    if (value.startsWith("gid://shopify/")) {
      // resolved URL must be threaded through; use placeholder for v1
      return `<img src="${gidToUrl(value)}" alt="" />`;
    }
    if (value.startsWith("http")) {
      return `<img src="${value}" alt="" />`;
    }
    return PRESET_ICONS[value] || PRESET_ICONS.plus;
  }
  ```
- **GID resolution**: a hotspot icon stored as a Shopify file GID
  needs its URL resolved at publish time (similar to how the model
  file GID is resolved). Add to `sdl3d-sync.server.ts` publish
  step: walk hotspots, for any `icon` starting with `gid://`,
  resolve via Files Admin API, write the resolved URL into the
  metafield payload. Editor display: query the file in the loader
  and pass URL to the picker preview.
- **Editor**: when `icon` is a GID, fetch resolved URL on loader
  side and pass into the icon picker via a `iconResolvedUrl` prop.
  Live preview shows the resolved image.

**UX wins**:
1. Brand-specific icons. A merchant selling kitchen knives can use
   their own blade silhouette instead of "plus."
2. Preset library covers the long tail. 14 named icons cover the
   common "warning" / "info" / "play video" / "settings" cases.
3. The same `icon` field handles both — no schema split, no
   confusing dual-source.

**Files**:
- `app/lib/hotspot-icons.ts` — preset name → SVG path table (14
  entries).
- `app/components/Sdl3dIconPicker.tsx` — new Tabs-based picker.
- `app/components/Sdl3dHotspotEditor.tsx` — use the picker.
- `app/components/Sdl3dHotspot360Editor.tsx` — same.
- `app/lib/sdl3d-sync.server.ts` — resolve hotspot-icon GIDs to
  URLs during publish.
- `extensions/product-3d-viewer/assets/icons.js` (new) — parallel
  SVG table for storefront.
- `extensions/product-3d-viewer/assets/viewer-3d.js` — call
  `iconHtml`.
- `extensions/product-3d-viewer/assets/viewer-360.js` — same.

**Out of scope**:
- Icon search / filter. 14 icons fit in one viewport row × 2; no
  search needed.
- Icon recolouring. The hotspot `color` field already tints the
  dot's background; icon foreground stays as-uploaded (custom) or
  takes `currentColor` (preset SVGs use `fill="currentColor"`).
- 360 hotspot adds `icon` to the schema. Today
  `Hotspot360Schema` doesn't include `icon`. Adding it is a one-
  line Zod field add + the 360 viewer JS reading and rendering it.
  Worth including in this PR so the picker isn't 3D-only.

### Hotspots PR #5 — Typed media slots

Adds `mediaImageUrl` and `mediaVideoUrl` to hotspot popups. Largest
storefront-side change in the sub-cluster — both viewers must learn
to render the new popup layout.

**Changes**:
- **Schema (Zod)**: add `mediaImageUrl: z.string().nullable().optional()`
  and `mediaVideoUrl: z.string().nullable().optional()` to
  `HotspotSchema` and `Hotspot360Schema`. Both default to `null`.
- **Editor** — under the "Content" subsection (Advanced only), add
  two new pickers below the body TextField:
  - **Image**: `FileTriggerCard` opening `FileBrowserModal` in
    IMAGE mode. Selected file GID writes to `mediaImageUrl`. Live
    preview thumbnail (max 80×80) below the trigger.
  - **Video**: plain `TextField` for a URL (no Shopify Files
    integration — videos are typically external). Validation: if
    non-empty, must match `youtube.com|youtu.be|vimeo.com|\.(mp4|webm)$`.
    Inline error if not.
- **Storefront popup layout** — both viewer JS files render the
  hotspot popup in this order:
  ```
  +---------------------+
  | media (16:9, 240max)|
  +---------------------+
  | Title               |
  | body prose...       |
  | [CTA Button]        |
  +---------------------+
  ```
  Media slot height capped at 240px to keep the popup compact;
  width matches popup width. If both image AND video set, video
  wins (rare combination; future merchant feature: order or hide
  both).
- **Video provider detection** (parallel-patched in both viewer JS
  files):
  ```js
  function videoEmbedHtml(url) {
    const yt = url.match(/(?:youtu\.be\/|youtube\.com\/watch\?v=)([\w-]+)/);
    if (yt) return `<iframe src="https://www.youtube.com/embed/${yt[1]}" ...></iframe>`;
    const vm = url.match(/vimeo\.com\/(\d+)/);
    if (vm) return `<iframe src="https://player.vimeo.com/video/${vm[1]}" ...></iframe>`;
    if (/\.(mp4|webm)$/i.test(url)) return `<video src="${url}" controls></video>`;
    return ""; // unsupported; render nothing
  }
  ```
- **GID resolution for mediaImageUrl** — same approach as the icon
  PR: publish-time resolution in `sdl3d-sync.server.ts` walks
  hotspots and replaces GIDs with URLs in the metafield payload.
- **CSS additions** in `viewer.css`:
  - `.sdl3d-hotspot-popup__media` — the media container.
  - `.sdl3d-hotspot-popup__media img` — max-height: 240px.
  - `.sdl3d-hotspot-popup__media iframe`,
    `.sdl3d-hotspot-popup__media video` — 16:9 aspect.

**UX wins**:
1. Hotspot popups carry product detail beyond prose — a USB-C port
   hotspot can show a close-up photo; an installation hotspot can
   show a 30-second YouTube clip.
2. Predictable layout. No Markdown means the storefront popup
   renders identically across merchants. Decided over RTE for
   pilot scope (see Slice 7 stretch goal).
3. URL-only video keeps the storefront from hosting heavy assets.
   YouTube/Vimeo do the encoding + delivery.

**Files**:
- `sdl-platform/packages/shared/src/sdl3d-schemas.ts` — add two
  fields to both schemas.
- `app/components/Sdl3dHotspotEditor.tsx` — image picker + video
  TextField in Content subsection.
- `app/components/Sdl3dHotspot360Editor.tsx` — same.
- `app/lib/sdl3d-validation.ts` — validate video URL pattern.
- `app/lib/sdl3d-sync.server.ts` — resolve mediaImageUrl GIDs at
  publish.
- `extensions/product-3d-viewer/assets/viewer.css` — popup media
  styles.
- `extensions/product-3d-viewer/assets/viewer-3d.js` — render media
  in popup.
- `extensions/product-3d-viewer/assets/viewer-360.js` — same.

**Out of scope**:
- Media caption / position controls (`mediaPosition`,
  `mediaCaption`). v2.
- Both-image-and-video supported. v2 if asked.
- RTE / Markdown body. Slice 7 stretch goal, no commitment.
- Live media render in editor canvas preview. Per locked
  decision #9 — editor preview stays static.

## Edge cases & invariants

1. **Existing hotspots survive every PR.** Each new field is
   optional with a sensible default in the Zod schema. Existing
   rows without `animation` / `icon` (in 360) / `mediaImageUrl` /
   `mediaVideoUrl` parse cleanly with the default applied.

2. **Custom icon GID resolution failure modes.** If a merchant
   uploads an icon, then later deletes the source file in Shopify
   Files, the GID resolution returns null. Editor: show a
   "Missing file — re-upload" warning Badge in the picker. Storefront:
   fall back to the `plus` preset icon so the dot still renders.

3. **Video URL false positives.** A URL like
   `https://example.com/page-about.mp4-formats.html` would match
   the `\.(mp4|webm)$/i` check on its substring if we're sloppy.
   Anchor the regex with `$` and ensure the dot-match is at the
   end of the URL path (or use `URL.parse(url).pathname` first).

4. **PR #2's mode toggle doesn't reset the row's expanded state.**
   A merchant with a row expanded, who flips Simple→Advanced, sees
   the new subsections appear inline. No row-collapse storm. The
   expand state lives in the editor component's local state by
   hotspot id; mode change doesn't touch it.

5. **PR #3's animation field defaulting to `"none"` is critical**
   so existing hotspots keep their static behaviour. New schema
   parser must treat missing field as `"none"`, not as required-
   error.

6. **PR #4's preset SVG library lives in two places (editor + TAE)**
   until the tech-debt PR (bundle `@spectrum-design-lab/shared` into
   the TAE build) lands. Each change to the preset list = parallel
   patch in both files. Add a top-of-file comment in
   `extensions/product-3d-viewer/assets/icons.js` flagging the
   parallel, mirroring the `viewer-360.js` interpolation parallel
   from Slice 7 PR #6.

7. **PR #5's storefront media render in 360 viewer popups** needs
   to handle the popup positioning correctly — the 360 popup sits
   inside the canvas's overlay layer, and tall popups (with a
   16:9 video) need to clamp height so they don't overflow the
   viewer. CSS `max-height: 80vh` on the popup container.

8. **Publish-time GID resolution adds latency.** Each hotspot with
   a custom icon or `mediaImageUrl` GID = one Files Admin API call
   at publish. For a product with 10 hotspots each with both =
   20 calls. Worth batching via a single `files(query:"id:...")`
   GraphQL with the IDs joined — caps at 1 call per publish. Build
   the batched resolver in PR #4 (icon GIDs) and extend in PR #5
   (mediaImageUrl).

9. **No schema versioning bump needed.** All adds are optional;
   the Zod parser is forward-compatible. `ConfigExportSchema`'s
   version field stays the same. If a future PR adds a *required*
   field or changes an existing field's shape, that's the time to
   bump.

## Build / typecheck checklist (per PR)

```bash
npx prisma generate            # PRs #2 + #3 have schema changes
npx prisma migrate dev         # PRs #2 + #3
npx tsc --noEmit
npm run build                  # CRITICAL — RR's .server import rule
npx vitest run                 # PRs #3, #4, #5 add schema tests
```

PR #3 adds:
- `sdl3d-schemas.test.ts` cases for animation enum acceptance +
  default-on-missing.

PR #4 adds:
- `hotspot-icons.test.ts` for preset library completeness (every
  named icon has an SVG entry).
- `sdl3d-sync.server.test.ts` cases for batched GID resolution.

PR #5 adds:
- `sdl3d-validation.test.ts` for video URL pattern acceptance/rejection.

## Staging smoke checklist (per PR)

Each PR is its own staging deploy + smoke. Generic shape: open the
editor, exercise the new control, publish, verify storefront.

### PR #1 (row layout)
1. Open editor → hotspot row expanded shows subsection headers
   (Content / Appearance / Layout / Behavior).
2. No visual regression on row collapsed state.
3. Drag-reorder still works.
4. Both 3D and 360 editor rows have the same subsection structure.

### PR #2 (Simple/Advanced)
1. Editor opens with Simple toggle selected (default).
2. Hotspot row in Simple mode shows ~3 visible fields when
   expanded (title, body, color).
3. Flip to Advanced → icon, style, animation slot (TBD), focus
   orbit, CTA reveal.
4. Reload editor → toggle remembers the choice (shop-level
   persistence).
5. Set focus orbit in Advanced, flip to Simple, flip back →
   value preserved.
6. Open a different product → toggle state same as previous
   product (shop-level).

### PR #3 (animations)
1. Open editor in Advanced mode → "Appearance" subsection has
   Animation Select.
2. Set animation to "pulse" → save → reload → still "pulse."
3. Publish → storefront viewer shows pulsing dot.
4. Try all 5 animation values; each renders distinctly.
5. Toggle browser `prefers-reduced-motion` → dots go static.
6. Editor preview canvas: dots stay static (per decision #9).

### PR #4 (custom icons)
1. Open editor in Advanced mode → hotspot icon picker shows
   Preset and Custom tabs.
2. Preset tab: 14 swatches in a 7-column grid; select one → live
   preview updates; save → reload → still selected.
3. Custom tab: open file picker → upload an SVG → select it →
   live preview shows the SVG; save → reload → still selected.
4. Publish → storefront dot renders the custom icon.
5. Delete the source file in Shopify Files → storefront
   gracefully falls back to "plus" preset; editor shows
   "Missing file — re-upload" badge.
6. 360 hotspot also gets an icon picker (PR adds `icon` to the
   360 schema); same flow works.

### PR #5 (media slots)
1. Open editor in Advanced mode → hotspot Content subsection has
   Image picker and Video URL field.
2. Image: pick a file → live preview thumb appears → save →
   reload → still set.
3. Video: paste a YouTube URL → save → reload; paste a Vimeo
   URL → save → reload; paste an .mp4 → save → reload.
4. Paste a bad URL (e.g. `https://example.com/foo`) → inline
   error shown; save blocked or graceful no-render on storefront.
5. Publish → storefront popup shows the media above the title.
6. Video plays in iframe (YouTube/Vimeo) or HTML5 controls (mp4).
7. Tall video popup doesn't overflow viewer (`max-height: 80vh`).
8. 360 hotspot popup renders the same layout.

## Backout strategy

Each PR is independently revertable. None depend on the others for
data shape (all additions are optional fields).

- **PR #1 (layout)** — pure UI; revert restores the inner
  Collapsibles.
- **PR #2 (Simple/Advanced)** — revertable if no later PR has
  shipped that *requires* the mode preference (PRs #3–#5 use it to
  gate fields but don't depend on it for data integrity; reverting
  PR #2 surfaces all fields by default — regression to current
  density, but no data loss). Migration is non-destructive (adds
  column); revert leaves the column orphaned, which is harmless.
- **PR #3 (animations)** — revertable; existing rows lose their
  `animation` field interpretation. The field stays in storage as
  noise. Storefront dots go static. No data loss.
- **PR #4 (custom icons)** — revertable; merchants with custom-icon
  GIDs in `hotspot.icon` see "plus" fallback on storefront after
  revert (preset library detection fails the prefix check). Editor
  loses the Tabs picker; reverts to the Select. Data preserved.
- **PR #5 (media slots)** — revertable; `mediaImageUrl` /
  `mediaVideoUrl` fields stay in storage as noise. Storefront
  popups stop rendering media. No data loss.

The migration in PR #2 is the only schema-level item; reverting
the column add would require its own migration step but isn't
needed in practice (orphaned columns are fine).

## Out of scope for the hotspot sub-cluster (Slice 8 backlog)

These items are still queued in Slice 8 but separate from the
hotspot rework cluster:

- **Storefront hotspots clip through the theme's top nav bar** — bug
  surfaced after the hotspot sub-cluster shipped. Hotspot dots
  rendered *over* the storefront's sticky theme header, breaking
  visual stacking. **Root cause**: `.sdl3d-block` had no stacking
  context of its own; hotspot dots use `transform` (3D projection
  for model-viewer slotted hotspots, `translate(-50%, -50%)` for
  360 dots) which creates a stacking context per dot. With the
  block at `z-index: auto` and the theme header at `z-index: auto`,
  source order determined paint — and the block (later in DOM)
  painted on top, dragging the dots with it.

  **Fix** (in `viewer.css`): give `.sdl3d-block` an explicit low
  stacking level so theme chrome with z-index ≥ 1 sits above it,
  and isolate the internal z-index ladder so dots can't escape:
  ```css
  .sdl3d-block {
    position: relative;
    isolation: isolate;
    z-index: var(--sdl3d-block-z, 0);
  }
  .sdl3d-block .sdl3d-viewer,
  .sdl3d-block .sdl3d-360-viewer,
  .sdl3d-block .sdl3d-app-viewer {
    isolation: isolate;  /* containment redundancy — see PR comment */
  }
  ```
  Adds `--sdl3d-block-z` CSS variable as a merchant escape hatch
  for themes with unusual stacking (e.g. negative-z elements in
  the header). Documented inline in `viewer.css`; no Theme
  Customizer setting added yet — wait until a second merchant hits
  the edge case before promoting it to UI. Standard playbook for
  embedded-app stacking: `isolation` + low explicit z-index + CSS
  var escape hatch, deliberately not entering a z-index arms race.
- **"Republish all products with default BG" bulk action** — closes
  the staleness footgun in viewer-settings PR #3 (shop-default BG
  resolved at publish-time). Settings page action button → walks
  every product with a published config → re-runs the publish path.
  Small UI, predictable backend. Slice 8 finisher.
- **Preset apply with per-hotspot dedup + delete confirmations** —
  decided spec is locked in the Slice 7 plan's out-of-scope
  section. Modal with checkbox list; duplicate detection via
  exact-title OR ≥70% Jaccard on tokenized body. Pair with single +
  bulk delete-confirmation Modals.
- **Per-product storage assignment column in the dashboard** —
  ResourceList column showing each product's last capture bucket +
  per-product override. Broader dashboard-density review needed
  first; defer until the hotspot cluster is in.
- **Bucket folder re-validation** — optional "Validate frames"
  button on the folder picker. Only if a merchant hits a
  malformed folder.
- **Bundle `@spectrum-design-lab/shared` into the TAE build** —
  architectural cleanup to eliminate the parallel JS copies in
  `viewer-360.js` (interpolation), `viewer-3d.js`, the
  non-existent-but-referenced `icons.js`, and the upcoming
  animation + media-slot parallel patches. Each Slice that adds
  shared semantics grows this debt; the bundle refactor is overdue
  but isn't blocking. Cluster boundary — ideally lands between
  Slice 8 and Slice 9. **Plan scoped in
  [docs/tae-bundle-plan.md](tae-bundle-plan.md)**: shared package
  picks up icon constants + video classify + animation enum,
  TAE assets become esbuild-bundled IIFE outputs from new
  `extensions/product-3d-viewer/src/` TS sources, build artifacts
  git-ignored. One PR, 5 steps, scope is refactor-only.
- **Catmull-Rom across the wrap** — PR #6 of Slice 7 falls back
  to linear when keyframes wrap. A merchant noticing the kink at
  the wrap point can trigger this work; not yet reported.
- **App Store listing assets**, **localization**, **billing UI**,
  **`auth.login` Polaris migration** — all Phase 2.

### Stretch goals (no slice assignment)

- **WYSIWYG rich-text body for hotspots** — Slice 7 carryover.
  Pulls in a TipTap-style RTE + DOMPurify allowlist on storefront
  render. Pairs with the typed-media-slots PR but is a separate
  scope.
- **Per-hotspot animation trigger style** (idle / hover / intersect) —
  v2 of the animations PR. v1 ships idle-only because it's the most
  visible default and merchants tend to want "draw the eye to the
  dot" not "draw the eye on hover."
- **Animation easing + duration custom** — v2 of animations. Five
  pre-baked options likely cover the pilot use cases; a free-form
  panel is a complexity-budget question for after pilot feedback.
- **Hotspot popup positioning** — today both viewers anchor popups
  at the dot. Smart anchoring (avoid clipping at viewer edges, flip
  to top vs bottom based on space) is a Slice 9 candidate if
  merchants report popups getting cut off.
