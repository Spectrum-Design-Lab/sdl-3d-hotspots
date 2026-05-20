# Slice 7 — Editor IA rework + 360 workflow fixes

> **STATUS: PLANNING.** Author SDL + Claude, 2026-05-20. Picks up after
> Slice 6 (`8c7f282..7f58efc`, all three PRs validated on staging plus
> the preview-height viewport-cap fix). Seven PRs queued — four are
> editor information-architecture (topbar, tabs, Media consolidation,
> publish status), three are 360 workflow fixes (frame numbering,
> keyframe wraparound, typed keyframe coordinate editing). Order is
> "smallest blast radius first," with the upload-modal consolidation
> landing in the middle where it has the most room to flex.

## Why this exists

Slice 6 closed the last functional gaps in the plan doc; merchant
testing of the editor surfaces the next layer of friction. None of it
is a single bug — it's IA scattering attention across surfaces that
should consolidate, plus two semantic mismatches in the 360 workflow
that confuse merchants once they start placing hotspots:

1. **Editor top section is doing too much work.** Edit / Preview tabs,
   storefront-visibility toggle (buried in inspector), Mode display,
   and a separate background-colour control all compete for chrome
   that should be giving the canvas more room. The viewer canvas is
   the merchant's primary surface — every pixel of chrome above it is
   a tax on the actual editing flow.
2. **Three separate doorways for "get my 360 frames into this product."**
   `Sdl3dRawCaptureUploader` (zip → autoprocess → CDN),
   `Sdl3dBucketFolderPicker` (reuse existing CDN folder),
   `FileBrowserModal` (browse/upload Shopify Files). All written
   incrementally; result is the merchant has to know *in advance*
   which doorway matches their workflow. One unified upload Modal
   with a "where to save / where to source" choice removes the
   guessing.
3. **Bottom publish-status bar competes with the left Setup wizard.**
   Both surfaces want to tell the merchant "you're N of M steps to
   ship." Wizard is the more discoverable surface and the natural
   place for itemized errors with deep-link affordances.
4. **3D model selection requires a Modal trip.** Merchants who know
   their model's filename should be able to type to search inline
   instead of opening a separate browser.
5. **Frame numbering is 1-indexed in the scrubber and 0-indexed in
   the keyframe editor.** Merchant reads "Frame 1" on the scrubber,
   adds a keyframe meant for that frame, types `0` into the keyframe
   form (or types `1` and ends up actually editing frame 2). Verified
   in [app/components/Sdl3dImageSequencePreview.tsx:389](sdl-3d-hotspots/app/components/Sdl3dImageSequencePreview.tsx#L389) (`Frame {currentFrame + 1} / {frameCount}`) vs [app/components/Sdl3dHotspot360Editor.tsx:321](sdl-3d-hotspots/app/components/Sdl3dHotspot360Editor.tsx#L321) (`value={String(hotspot.visibleFrameStart)}` — raw 0-indexed).
6. **Keyframes can't wrap around a circular 360 sequence.** A hotspot
   visible on the rear of a product needs frames 70 → 71 → 72 → 1 → 2;
   today's `isHotspot360Visible` is `frame >= start && frame <= end`
   (linear range, no wrap) and `interpolateHotspotPosition` clamps
   before-first / after-last (no wrap). Verified in [app/lib/sdl3d-shared.ts:25](sdl-3d-hotspots/app/lib/sdl3d-shared.ts#L25).
7. **Keyframe positions are 0–100 percentages and only editable by
   dragging on the canvas.** Two compounding usability issues:
   percentages are abstract (merchants see "X: 45.2, Y: 62.1" and
   don't know what that means relative to anything physical), and
   precise placement is mouse-only — you can't nudge a hotspot 2px
   left without finding sub-pixel mouse precision. Merchants who
   want a hotspot exactly centred above a USB port need typed input.

Seven surfaces; ~4–5 days of work if no surprises.

## Decisions already locked

Came out of pilot-day-1 testing (2026-05-20). Confirm at PR-1 kickoff;
not open for re-litigation otherwise.

1. **Always-edit mode — no Edit / Preview tabs.** The hotspot
   click-to-place affordance is always available; the merchant never
   has to flip into a separate "preview" mode. The standalone
   `StorefrontPreview` route (Slice 5C PR #4) is the merchant's
   trusted "see what customers see" surface; the editor's
   embedded-preview tab duplicated it badly. UX win: one mental
   model — "I'm editing my product" — no mode-switching.
2. **One upload Modal, two tabs.** Tab 1 "Upload" (drop images or
   ZIP; choose save target: CDN-with-autoprocess or
   Shopify Files-direct). Tab 2 "Browse existing" (choose source: CDN
   bucket folders or Shopify Files). Tabs over wizard because
   merchants returning to swap frames shouldn't sit through a 3-step
   flow. The existing `Sdl3dRawCaptureUploader` and
   `Sdl3dBucketFolderPicker` cards in the inspector get deleted;
   `FileBrowserModal` morphs into the new modal (or gets replaced —
   architecturally we keep its file-listing innards but reshape the
   chrome).
3. **Storefront visibility moves to the topbar.** Polaris `Button`
   (toggle) or `Checkbox` (inline) between the Mode display and the
   storage Select. Replaces the current "Storefront visibility" Card
   that's the first thing in the inspector. Right column reclaims
   ~100px of vertical space.
4. **Viewer-type toggle (MODEL_3D ↔ IMAGE_360) moves from topbar
   into the Media inspector section.** The current topbar "Mode:
   360° Spin" pill is a *display* of a setting that lives elsewhere
   (it's set via `setViewerType` intent), but its placement implies
   it's a top-level switch. Moving it into Media puts it next to the
   thing it controls (which media you're uploading).
5. **Publish status → left sidebar.** The bottom `Banner` ("Ready
   to publish" / itemized errors) deletes; the Setup wizard's
   "Publish" step grows an inline error list with deep links to the
   relevant inspector section. Wizard already shows
   `5 of 5 steps complete` / `ProgressBar` — that's where merchants
   are looking for "what's left."
6. **Background-colour control moves from preview chrome to the
   Viewer inspector tab.** Today's `previewBg` state lives at the
   editor route level and floats as a control on the preview canvas;
   it's a viewer setting, so it belongs in viewer settings. Will
   actually persist now (currently it's editor-local state that
   resets on reload).
7. **Frame numbering: 1-indexed everywhere in the UI; storage
   stays 0-indexed.** Display = stored + 1; stored = display - 1.
   No schema change, no migration. Conversion happens at the form
   field / display layer. Range validation clamps to [1, frameCount]
   on input, [0, frameCount-1] on save.
8. **Keyframe wraparound: auto-detected by `start > end` in the
   visible-frame range.** No new boolean column; the wraparound
   behaviour kicks in when the merchant sets a start frame numerically
   higher than the end frame. The hotspot editor surfaces a visible
   "wraps around" Badge so merchants understand why their range
   reads "70 → 5" instead of being rejected as invalid.
   `interpolateHotspotPosition` learns a new optional
   `totalFrames` argument; when present and the keyframe range
   wraps, it interpolates around the shorter path.
9. **No new schema columns.** All seven PRs land without a migration.
   Frame indexing is UI-only. Wraparound reuses the existing
   `visibleFrameStart`/`visibleFrameEnd` ints. Background-colour
   goes into the existing `viewerSettingsJson` blob. Coordinate
   display is a UI-layer multiplier on the existing
   `keyframe.x` / `keyframe.y` floats.
10. **Keyframe coordinates display as integers 0–1000 (no unit
    suffix); storage stays as 0–100 floats.** Display = round(stored
    × 10); stored = display / 10, clamped to [0, 100]. The factor of
    10 gives merchants single-pixel-feeling precision (1001 stops
    rather than 101) without requiring resolution-dependent pixel
    coords. No `%` sign anywhere in the UI. Tooltip on the
    coordinate fields explains "0 = left/top edge, 1000 = right/
    bottom edge" once so the range is legible. Same conversion on
    every read/write path — the canvas drag handler converts mouse
    coords to display coords first, then to storage coords; the
    typed-input fields go straight display → storage.

## Migration order — PR-by-PR

### PR #1 — Topbar IA + storefront visibility toggle

Smallest blast radius. Reshapes the topbar without touching the
canvas or the inspector internals (beyond removing the storefront
visibility Card that now lives in the topbar).

**Changes**:
- Topbar gains a Polaris `Checkbox` labelled "On storefront" between
  the Mode display and the storage Select. Wired to the existing
  `enabled` boolean on `ProductConfig`; flips trigger an immediate
  save (same intent the existing inspector toggle uses).
- The "Storefront visibility" inspector Card (current first card in
  the right column, added in Slice 5C PR #5c) gets removed. Its body
  was just the same toggle plus subtitle text — moved to the topbar
  with the subtitle dropped (the Mode/badges row carries enough
  context).
- Topbar layout: `Browse product | Product: <name> | <ready/blocked
  Badge> | Mode: <type> | [On storefront ☑] | Storage: <select> |
  <override/default Badge> | <save-state Badge>`. Same flex
  container; one new control inserted, one moved-out.

**UX wins**:
1. Storefront toggle is one click from anywhere. Today merchants
   scroll the inspector to find it; now it's always visible.
2. Inspector right column starts with the Media card directly —
   removes ~100px of chrome before the first editable control.

**Files**:
- `app/routes/app.sdl3d.editor.tsx` — topbar JSX + storefront-toggle
  fetcher wiring. Remove the "Storefront visibility" InspectorSection
  card.

**Out of scope**:
- Removing the Mode display from the topbar (deferred to PR #3,
  which moves it into the Media inspector section).

### PR #2 — Remove Edit / Preview tabs; move background-colour

Independent of #1. No data-shape changes.

**Changes**:
- Delete the `mainTab` state and the Edit/Preview tab buttons in the
  middle column header. Canvas always renders in edit mode (click-to-
  place hotspots, drag to reposition).
- Move the `previewBg` control into the Viewer inspector tab as a
  Polaris `ColorPicker` or a small swatch row. Persist via
  `viewerSettings.backgroundColor` (the field already exists in the
  Zod schema per CLAUDE.md's "Viewer Settings JSON Shape").
- Update viewer rendering to consume `viewerSettings.backgroundColor`
  instead of the route-level `previewBg` state.
- The standalone `StorefrontPreview` route stays as the merchant's
  "see what customers see" surface; the editor no longer competes
  with it.

**UX wins**:
1. No mode-switching. Merchants describe their workflow as "I'm
   editing my product" — the UI now matches.
2. Background colour persists. Today it resets on reload because
   it's editor-local state; moving it into `viewerSettings` makes it
   part of the saved config.
3. Background colour applies to the storefront viewer too (since
   it's now in the saved settings, the Theme App Extension reads it).
   Free UX win.

**Files**:
- `app/routes/app.sdl3d.editor.tsx` — remove tab state + buttons;
  pipe `viewerSettings.backgroundColor` into preview components.
- `app/components/Sdl3dViewerSettingsEditor.tsx` — add the colour
  control. Field already exists in the schema, so no schema work.
- `app/components/Sdl3dEditorPreview.tsx` /
  `app/components/Sdl3dImageSequencePreview.tsx` — consume the new
  prop in place of `previewBg`.

**Out of scope**:
- Touching the storefront viewer's background handling. Already
  reads `viewerSettings.backgroundColor` from metafields per the
  existing schema — should "just work" once #2 starts writing the
  value.

### PR #3 — Media tab consolidation + unified upload Modal

The big one. Splits into two sub-PRs because the upload Modal is
substantial enough to warrant its own scope-fence.

**3a — Media inspector reshape**:
- Add Viewer-type toggle (Polaris `ChoiceList` or `ButtonGroup`)
  inside the Media inspector section at the top. Wired to the
  existing `setViewerType` intent.
- Remove the Mode display from the topbar (was kept in PR #1 for
  staging; now it lives in Media).
- For MODEL_3D mode, add an inline search `TextField` above the
  current `FileTriggerCard` "Model file" — types-to-filter the
  shop's existing GLB files (using the same listShopifyFiles
  data the picker uses). Selecting a result writes the GID without
  opening a separate Modal. The Browse trigger still exists for
  exploratory selection.
- For IMAGE_360 mode, the existing `FileTriggerCard` "360° Image
  Sequence" stays — but opening it now opens the new unified
  upload Modal (see #3b).

**3b — Unified upload Modal**:
- New component `Sdl3dMediaSourceModal` (or rename
  `FileBrowserModal` to it). Two Polaris `Tabs`:
  - **Upload**: drop zone for images or ZIP, plus a
    `ChoiceList` "Save to:" with options:
    - "CDN bucket (auto-process, recommended for raw turntables)"
      — runs the capture pipeline (current `signRawUpload` →
      `recordRawUpload` flow from `Sdl3dRawCaptureUploader`).
    - "Shopify Files (use as-is)" — current Shopify staged-upload
      flow from `FileBrowserModal`.
    Default depends on input: ZIP defaults to CDN-autoprocess;
    individual images default to Shopify Files.
  - **Browse existing**: another `Tabs` inside:
    - "Shopify Files" — current FileBrowserModal grid.
    - "CDN bucket folders" — current `Sdl3dBucketFolderPicker`
      list, scoped to the editor's storage selector (already
      wired from Slice 6 PR #3).
- Delete the standalone `Sdl3dRawCaptureUploader` and
  `Sdl3dBucketFolderPicker` Cards from the Media inspector section.
  Their entry points collapse into the upload Modal.

**UX wins for 3a/3b combined**:
1. **Viewer-type toggle next to the thing it controls.** Media tab
   is where you upload your media; type-of-media belongs there.
2. **3D model search inline.** Saves a Modal trip for the common
   case (merchant knows the filename).
3. **One front door for 360 frames.** Merchants stop having to
   match their workflow to one of three competing cards. The "save
   to" / "source from" choice surfaces the real architectural
   question (CDN bucket vs Shopify Files) at the right moment.
4. **Topbar simplifies.** Mode display gone; topbar reads
   `Browse | Product | ready/blocked | [On storefront] | Storage |
   save-state` — five elements + storage selector, down from
   seven.

**Files**:
- `app/routes/app.sdl3d.editor.tsx` — Media InspectorSection
  reshape; remove standalone Card renders; remove topbar Mode
  display.
- `app/components/Sdl3dMediaSourceModal.tsx` — new or renamed
  from `FileBrowserModal`. Largely composes the existing logic
  from `Sdl3dRawCaptureUploader`, `Sdl3dBucketFolderPicker`, and
  the file-browser body.
- `app/components/Sdl3dRawCaptureUploader.tsx` — delete (logic
  moves into the Upload tab of the Modal).
- `app/components/Sdl3dBucketFolderPicker.tsx` — delete (logic
  moves into the Browse-existing tab).
- `app/lib/sdl3d-shared.ts` — possibly small extraction of the
  upload flow's local state machine into a hook if it's reused
  across Modal tabs.

**Out of scope**:
- Changing what the storefront viewer reads. URLs end up in the
  same metafield (`sdl_3d.imageSequence360`) regardless of source;
  this PR is editor-internal IA only.
- New backend intents. All three flows already have their
  server-side handlers from prior slices; #3 is pure UI
  reshaping.

### PR #4 — Publish status → Setup wizard

Small surface. Pure UI movement.

**Changes**:
- Remove the bottom `Banner` from the editor middle column ("Ready
  to publish" / itemized errors).
- Augment the Setup wizard's "Publish" step (last item in the left
  sidebar) with an inline list of unresolved validation items when
  the step is incomplete. Each item is a Polaris `Link` that
  scrolls/focuses the relevant inspector section.
- When complete, the "Publish" step renders the green check it
  already does; no extra chrome.

**UX wins**:
1. Status lives where the merchant is reading next-steps anyway.
   Today's bottom bar repeats information the wizard already
   summarizes.
2. Errors gain deep-link affordances. Today's bottom bar enumerates
   issues as text; clicking them doesn't do anything. Sidebar
   versions are real navigation.
3. Middle column reclaims ~80px at the bottom (the bar plus its
   padding).

**Files**:
- `app/routes/app.sdl3d.editor.tsx` — remove bottom Banner; pass
  validation issues into the Sidebar.
- `app/components/Sdl3dEditorSidebar.tsx` — render the issue list
  under the "Publish" step.

**Out of scope**:
- Reshaping the wizard steps themselves. Just augmenting the
  Publish step's body.

### PR #5 — Frame numbering: 1-indexed UI everywhere

Workflow fix. No schema change, no IA change.

**Changes**:
- Add a small UI helper module (or just inline helpers in the
  components) for `frameToDisplay(stored: number) => stored + 1`
  and `frameFromDisplay(display: number) => display - 1`, with
  clamping to `[0, frameCount-1]` on save.
- Update `Sdl3dHotspot360Editor.tsx`:
  - `visibleFrameStart` / `visibleFrameEnd` TextField values
    converted to display values; on change, converted back to
    storage.
  - Keyframe row labels read `Frame {kf.frame + 1}` instead of
    raw `kf.frame`.
- Update `Sdl3dImageSequencePreview.tsx`:
  - Scrubber slider values stay 0-indexed internally (slider
    `value={currentFrame}` is fine — it's an index into the
    sequence array); the displayed label and `aria-label` stay
    `Frame {currentFrame + 1}`.
  - No change here actually — the preview is already 1-indexed in
    its readout. The fix is on the editor side.
- Validate input: typed values outside `[1, frameCount]` clamp
  before save.
- Update the placeholder `0` / `frameCount - 1` defaults in
  `blankHotspot()` to use 1-indexed display? **No** — defaults stay
  in storage units. Only what the merchant *sees* changes.

**UX wins**:
1. Scrubber and keyframe editor agree. Merchant types "1" for the
   first frame in both places.
2. No silent off-by-one when copying a frame number from the
   scrubber into the keyframe form.

**Files**:
- `app/components/Sdl3dHotspot360Editor.tsx` — display-layer
  conversions on the frame TextFields and keyframe row labels.
- `app/lib/sdl3d-shared.ts` — optional helpers (or keep them
  inline in the component if only one consumer).

**Out of scope**:
- The storefront viewer (`extensions/product-3d-viewer/assets/viewer-360.js`).
  It only reads frame indices from the metafield; never displays
  them to customers. No change needed.
- Database / metafield schema. Both stay 0-indexed.

### PR #6 — Keyframe wraparound for circular 360

Biggest semantic change of the slice. Touches both the visibility
check and the interpolation logic. Storage stays the same; only
*interpretation* of the ints changes.

**Changes**:
- `isHotspot360Visible(hotspot, frame, totalFrames)` — gain
  optional `totalFrames` arg. If `start > end` AND `totalFrames`
  is supplied, return `frame >= start || frame <= end` (wrap
  interpretation). Otherwise current linear behaviour.
- `interpolateHotspotPosition(keyframes, frame, opts?)` — gain
  optional `opts: { wrap: boolean, totalFrames: number }`. When
  wrap is true:
  - Sort keyframes by `frame` as today.
  - When `frame` is between last keyframe and (totalFrames-1) OR
    between 0 and first keyframe, interpolate between
    `last keyframe` and `first keyframe` treating the wrap as the
    shorter path (distance = (totalFrames - last.frame) +
    first.frame).
  - Otherwise behave as today.
- Hotspot editor: when `visibleFrameStart > visibleFrameEnd`, render
  a Polaris `Badge` next to the range "wraps around" so merchants
  understand the wrap is intentional. Don't reject the input.
- Scrubber rendering: when the current frame is inside a hotspot's
  wrap range but outside the linear `[start, end]`, the hotspot
  still draws. Visual sanity check for merchant.
- Editor preview wiring: pass `frameCount` into
  `interpolateHotspotPosition` and `isHotspot360Visible` calls.
  Already available from loader data; trivial threading.
- Theme App Extension (`extensions/product-3d-viewer/assets/viewer-360.js`)
  — same wrap-aware interpolation + visibility check. The shared
  helpers in `sdl3d-shared.ts` ARE the source of truth, but the
  TAE has its own copy (bundled JS, no module import). Keep them in
  sync via a parallel patch in viewer-360.js.

**UX wins**:
1. Hotspots can cover the back of products without splitting into
   two hotspots with different keyframe sets.
2. "Wraps around" badge makes the intent legible — merchants who
   set `start > end` by accident immediately see what the system
   thinks they meant.

**Files**:
- `app/lib/sdl3d-shared.ts` — wrap-aware versions of both helpers.
- `app/lib/sdl3d-shared.test.ts` — new test cases for wraparound.
- `app/components/Sdl3dHotspot360Editor.tsx` — "wraps around" Badge.
- `app/components/Sdl3dImageSequencePreview.tsx` — pass
  `frameCount` to the helpers; nothing else changes (preview
  already calls them).
- `extensions/product-3d-viewer/assets/viewer-360.js` — parallel
  patch for the storefront viewer.

**Out of scope**:
- Storage-side change. The wrap interpretation is *derived* from
  `start > end`; storage stays the same two ints.
- Migration of existing hotspots. Linear hotspots (start ≤ end)
  behave identically to today — wraparound only activates when
  start > end, which existing data never has.

### PR #7 — Typed keyframe coordinate editing (0–1000, no %)

Last PR of the slice. Two related workflow fixes on the same
surface — kept together because they share the display-conversion
layer.

**Changes**:
- Coordinate display helpers in `app/lib/sdl3d-shared.ts` (or
  inline in the editor component):
  - `coordToDisplay(stored: number) => round(stored * 10)` returning
    integer in `[0, 1000]`.
  - `coordFromDisplay(display: number) => clamp(display / 10, 0, 100)`.
- `Sdl3dHotspot360Editor.tsx` — for each keyframe row, add two
  Polaris `TextField`s (type `number`, min `0`, max `1000`, step `1`)
  for X and Y, replacing or augmenting the current read-only display.
  Typed values write through immediately (`onChange`) with debounce
  identical to the existing auto-save cadence. Field labels are
  literally "X" and "Y" — no `%` suffix anywhere.
- `Sdl3dImageSequencePreview.tsx` — when the merchant clicks on the
  canvas to place / move a hotspot, the percentage maths stays the
  same internally; the displayed coordinate (if surfaced anywhere
  on the canvas overlay, e.g. a debug readout) uses the new
  conversion.
- Add a one-time tooltip / helper text on the X/Y fields: "0 = left
  edge, 1000 = right edge" (and same for Y top/bottom). One line of
  text on the first keyframe row of the section; doesn't need to
  repeat.

**UX wins**:
1. **Precise placement.** A merchant can type X=500 to centre a
   hotspot horizontally without finding sub-pixel mouse precision.
   Big win for product photography where hotspots need to land on
   small features (buttons, ports).
2. **Resolution-independent integer values.** 0–1000 feels concrete
   without committing to actual pixel coords (which vary across
   images). "Y=412" reads more like "a real position" than
   "Y=41.2%".
3. **Drag + type coexist.** Drag for fast rough placement, type for
   fine adjustment. No mode-switching.

**Files**:
- `app/lib/sdl3d-shared.ts` — coordinate conversion helpers + tests.
- `app/lib/sdl3d-shared.test.ts` — round-trip tests
  (display→storage→display) for edge values 0, 1, 999, 1000.
- `app/components/Sdl3dHotspot360Editor.tsx` — typed X/Y inputs per
  keyframe row.
- `app/components/Sdl3dImageSequencePreview.tsx` — if any
  on-canvas coordinate readout exists, route through the helper
  (no other behaviour change).

**Out of scope**:
- Storage migration. Keep `keyframe.x` / `keyframe.y` as 0–100
  floats. Conversion happens at the display boundary every read /
  write. Same approach as PR #5's frame indexing.
- Theme App Extension changes. The TAE reads metafield JSON and
  renders hotspots; it never displays coordinate numbers to
  customers. No change needed.
- Snap-to-grid or alignment guides. Different feature; if a
  merchant asks for it, Slice 8 candidate.
- Keyboard arrow-key nudging when a hotspot is selected. Worth
  considering as a Slice 8 follow-up — typed input covers the
  precision case; arrow keys would cover the "I want to nudge from
  hover/keyboard" case.

## Edge cases & invariants

1. **PR #2's `viewerSettings.backgroundColor` already exists in the
   Zod schema** per CLAUDE.md's "Viewer Settings JSON Shape" doc
   block (`"backgroundColor": "#0b1020"`). Existing rows have it
   set to the default; new control just exposes editing.

2. **PR #3a's inline 3D model search** uses the same data source as
   the existing model browser (`listShopifyFiles(admin, "MODEL3D")`).
   No new GraphQL — just a different surface for the same payload.
   If the file list pagination hasn't loaded the full set, the
   inline search shows only loaded results; the existing "Browse"
   button still opens the paginated picker as escape hatch.

3. **PR #3b's "Save to: CDN" path goes through Slice 1/2/3's
   capture pipeline.** That pipeline samples + converts + uploads.
   The "Shopify Files" path uploads frames as-is. Different
   downstream shapes; the upload Modal needs to make the trade-off
   visible (CDN is for raw turntables; Shopify Files is for
   pre-processed frames). Plan calls for default-by-input
   (ZIP → CDN, individual images → Shopify Files); merchant can
   override.

4. **PR #4's "scroll/focus relevant inspector section" deep links**
   reuse the existing `inspector-media` / `inspector-viewer` /
   `inspector-hotspots` / `inspector-publish` element ids. Each
   InspectorSection already accepts an `id` prop; this PR just
   adds the navigation handlers that target them.

5. **PR #5's clamping**. If a merchant types `0` into a frame field,
   it clamps to display value `1` (storage `0`). If they type
   `73` on a 72-frame sequence, it clamps to display `72` (storage
   `71`). If they delete the field entirely, treat as unchanged
   (don't write `NaN` to the DB).

6. **PR #6's wraparound interpolation has a degenerate case**: a
   hotspot with `start > end` but only one keyframe. The single
   keyframe's position holds across the wrap range, same as today's
   linear single-keyframe behaviour. Two keyframes with wrap and a
   frame *between* them in the wrap direction → linear interpolate
   via the shorter path. Three or more keyframes wrapping is
   complex; Catmull-Rom on a wrap is a real "smooth around the back"
   case. For PR #6 v1, fall back to linear interpolation when wrap
   is active (skip Catmull-Rom). Smoothing the wrap is a follow-up
   if a merchant notices the kink.

7. **PR #6's Theme App Extension parallel patch**. The `viewer-360.js`
   in the extension is a separate JS file with its own copy of
   helper logic. Each Slice that touches shared 360 semantics has
   to remember to patch both. Long-term we should bundle
   `sdl3d-shared` into the extension build; out of scope for #6.
   Add a comment at the top of `viewer-360.js` flagging the parallel.

8. **Removing the Edit / Preview tab in PR #2 removes the
   `mainTab` state.** Anything else hanging off `mainTab`?
   Search reveals: just the tab buttons + the conditional render
   of `<StorefrontPreview>` vs the canvas. The StorefrontPreview
   route is standalone — its inline use inside the editor is the
   thing being deleted, not the route itself.

## Build / typecheck checklist (per PR)

```bash
npx prisma generate            # none of #1–#6 have schema changes
npx tsc --noEmit
npm run build                  # CRITICAL — RR's .server import rule
```

PRs #6 and #7 also run `npx vitest run` on `sdl3d-shared.test.ts`
to verify the wrap interpolation cases (#6) and the coordinate
round-trip cases (#7).

## Staging smoke checklist (per PR)

Each PR is its own staging deploy + smoke. PR-specific items below;
generic shape: visual diff against the editor's current state +
smoke the workflow the PR is reshaping.

### PR #1
1. Open editor → "On storefront" checkbox visible in topbar.
2. Toggle it → status saves immediately, persists across reload.
3. Right inspector starts with Media card (no Storefront visibility
   card above it).

### PR #2
1. Editor canvas has no Edit / Preview tabs above it.
2. Click on canvas → hotspot placed (edit mode is always-on).
3. Viewer inspector tab has a background-colour control.
4. Change colour → preview updates → save draft → reload → colour
   persists.
5. Publish → storefront viewer renders with the chosen background.

### PR #3
1. Media tab has viewer-type toggle at top; topbar no longer
   shows Mode display.
2. MODEL_3D mode: type into model search field → matching files
   filter inline; selecting one sets it without a Modal trip.
3. IMAGE_360 mode: click 360° Image Sequence → unified Modal opens.
4. Upload tab: drop a ZIP → defaults to CDN; drop individual images
   → defaults to Shopify Files. Both choices work.
5. Browse existing tab: both Shopify Files grid and CDN folders
   list visible; both selections write through correctly.
6. RawCaptureUploader and BucketFolderPicker cards are gone from
   the inspector.

### PR #4
1. Editor has no bottom "Ready to publish" banner.
2. Setup wizard "Publish" step shows itemized validation issues
   when blocked.
3. Click an issue → editor scrolls/focuses the relevant inspector
   section.
4. Fix the issue → wizard step turns green; the item disappears.

### PR #5
1. Open the 360 editor on a sequence (any frame count > 1).
2. Scrubber readout: "Frame 1 / N" at the start.
3. Hotspot editor: visibleFrameStart / visibleFrameEnd default to
   "1" and "N" (not 0 / N-1).
4. Type "1" in start, "5" in end → save → reload → fields still
   read "1" / "5"; DB stores 0 / 4.
5. Add keyframe at frame 1 from the scrubber → keyframe list shows
   "Frame 1" (not "Frame 0").

### PR #6
1. Create a hotspot with `visibleFrameStart=70`, `visibleFrameEnd=5`
   on a 72-frame sequence.
2. Editor surfaces "wraps around" Badge next to the range.
3. Add keyframes at frame 70, 71, 1, 5.
4. Scrub through frames 68→72→1→5: hotspot stays visible across
   the wrap; position interpolates smoothly through the wrap.
5. Publish; storefront viewer (TAE) shows the same behaviour.
6. Edge case: hotspot with `start=70`, `end=5`, only one keyframe →
   position holds across the wrap range.
7. Edge case: existing linear hotspot (start ≤ end) → behaves
   exactly as before (no regression).

### PR #7
1. Open the 360 hotspot editor on a sequence with keyframes.
2. Each keyframe row shows X / Y TextFields with integer values in
   `[0, 1000]`; no `%` sign anywhere.
3. Click on the canvas at the centre of the image → new keyframe
   shows X≈500, Y≈500.
4. Type `750` into a keyframe's X field → preview updates
   immediately → save → reload → field still reads `750`.
5. Type `1500` (out of range) → clamps to `1000` on blur.
6. Type `-5` → clamps to `0`.
7. Drag a hotspot on the canvas → the X/Y fields update live to
   match the new position.
8. Round-trip: drag to X=512, save, reload → typed-input field
   reads `512` (no off-by-one from float precision).

## Backout strategy

Each PR is independently revertable. None depend on the others for
data shape — all seven land without schema changes — though PR #3
deletes components that prior PRs reference, so a revert order
matters if you back out mid-slice:

- PR #1, #2, #4, #5, #7 — revertable in any order, any time.
- PR #3 — reverting after it lands resurrects the
  RawCaptureUploader / BucketFolderPicker; safe so long as no
  later commit further changed the Media section.
- PR #6 — reverting after it lands turns existing wraparound
  hotspots back into "broken" linear ranges (visible only in their
  numeric range; not visible across the wrap). Merchants who
  created such hotspots would notice. If reverting #6 in
  production, flag any hotspots with `start > end` and offer to
  split them into two linear hotspots.

## Out of scope for Slice 7 (notes for future slices)

- **Editor-side "Delete this config" button** — needs
  navigation-after-delete handling. Carried forward from Slice 6
  "out of scope"; still a Slice 8 candidate.
- **Per-product storage assignment in the dashboard** — column in
  the ResourceList showing each product's last capture bucket +
  per-product override. Still a Slice 8 candidate; broader
  dashboard-density review needed first.
- **Bucket folder re-validation** — optional "Validate frames"
  button on the folder picker. Slice 8 if a merchant hits a
  malformed folder.
- **Bundling `sdl3d-shared` into the Theme App Extension build**
  so the parallel JS copy in `viewer-360.js` can be eliminated.
  Architectural cleanup; do it the next time we change shared 360
  semantics.
- **Catmull-Rom interpolation across the wrap** — PR #6 falls back
  to linear for wrap segments. Smoothing requires extending the
  Catmull-Rom neighbour-pick logic to honour wrap; defer until a
  merchant reports the kink.
- **Frame numbering in the storefront viewer's debug overlays**
  (if any) — TAE doesn't surface frame numbers to customers today;
  no change needed.
- **Storefront viewer letterbox / aspect-ratio handling** — the
  preview-height fix (`7f58efc`) only touched admin. Storefront
  cap is conditional on merchant feedback per the conversation
  that triggered that fix.
- **App Store listing assets** — separate Phase-2 track.
- **Localization beyond en** — separate slice.
- **`auth.login` route Polaris migration** — drops `globals.d.ts`
  to 1 declaration. Only worth it during a broader OAuth visual
  pass.
