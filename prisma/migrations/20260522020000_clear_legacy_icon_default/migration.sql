-- Slice 8 hotspots PR #4 — clear the legacy `icon = 'plus'` default.
--
-- Before this PR the editor's blankHotspot() and parseInitialHotspots()
-- both filled `icon = 'plus'` for every hotspot, but the storefront +
-- editor preview never rendered the field. After PR #4 they do, so
-- every existing hotspot would suddenly sprout a plus icon. Wipe the
-- default so legacy rows render as their index number (the actual
-- behaviour merchants saw). Merchants who want a plus icon now choose
-- it explicitly via the new picker.
UPDATE "Hotspot" SET "icon" = NULL WHERE "icon" = 'plus';
