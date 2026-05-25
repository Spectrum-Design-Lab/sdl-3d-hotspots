/**
 * Per-hotspot apply picker with duplicate detection.
 *
 * Opens after the merchant picks one or more presets in
 * PresetBrowserModal. Each incoming hotspot becomes a row with its
 * own checkbox; rows that look like duplicates of existing hotspots on
 * the product get a `Badge tone="attention"` reading
 * "Similar to existing '<title>'" and start unchecked. The merchant
 * can override (check a duplicate intentionally) — they've been told.
 *
 * Spec source: docs/slice-7-plan.md "Preset apply" out-of-scope entry,
 * shipped Slice 8. Dedup rule: exact-title OR Jaccard body ≥ 0.70.
 * See app/lib/hotspot-dedup.ts for the matching logic.
 *
 * Generic over the payload type so 3D and 360 hotspots can both feed
 * candidates without losing the per-mode field shape.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  Checkbox,
  InlineStack,
  List,
  Modal,
  Text,
} from "@shopify/polaris";
import {
  findDuplicate,
  precomputeExistingTokens,
} from "../lib/hotspot-dedup";

export interface PresetApplyCandidate<P> {
  /** Unique identifier within the modal session (preset id + index works). */
  id: string;
  title: string;
  body: string;
  /** Source preset name, displayed as a hint under the body. */
  presetName: string;
  /** Original hotspot payload passed back to the caller untouched. */
  payload: P;
}

export interface PresetApplyDedupModalProps<P> {
  open: boolean;
  onClose: () => void;
  candidates: ReadonlyArray<PresetApplyCandidate<P>>;
  existing: ReadonlyArray<{ title?: string | null; body?: string | null }>;
  /** Called with the subset the merchant chose to apply. */
  onConfirm: (selectedPayloads: P[]) => void;
}

export function PresetApplyDedupModal<P>({
  open,
  onClose,
  candidates,
  existing,
  onConfirm,
}: PresetApplyDedupModalProps<P>) {
  // Precompute existing-hotspot tokenized bodies once so dedup checks
  // are cheap across the candidate list.
  const existingTokens = useMemo(() => precomputeExistingTokens(existing), [existing]);

  // For each candidate, find a matching existing hotspot (or null).
  const dupeInfo = useMemo(
    () =>
      candidates.map((c) => ({
        id: c.id,
        match: findDuplicate(
          { title: c.title, body: c.body },
          existing,
          existingTokens,
        ),
      })),
    [candidates, existing, existingTokens],
  );

  const dupeById = useMemo(() => {
    const map = new Map<string, { title?: string | null } | null>();
    for (const d of dupeInfo) map.set(d.id, d.match);
    return map;
  }, [dupeInfo]);

  // Initial selection: non-duplicates checked, duplicates unchecked.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!open) return;
    const next = new Set<string>();
    for (const c of candidates) {
      if (!dupeById.get(c.id)) next.add(c.id);
    }
    setSelectedIds(next);
  }, [open, candidates, dupeById]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(candidates.map((c) => c.id)));
  const selectNone = () => setSelectedIds(new Set());
  const selectNonDuplicates = () => {
    const next = new Set<string>();
    for (const c of candidates) {
      if (!dupeById.get(c.id)) next.add(c.id);
    }
    setSelectedIds(next);
  };

  const handleConfirm = () => {
    const payloads = candidates
      .filter((c) => selectedIds.has(c.id))
      .map((c) => c.payload);
    if (payloads.length > 0) onConfirm(payloads);
    onClose();
  };

  const selectedCount = selectedIds.size;
  const total = candidates.length;
  const duplicateCount = dupeInfo.filter((d) => d.match).length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add hotspots from preset"
      primaryAction={{
        content:
          selectedCount > 0 ? `Add selected (${selectedCount})` : "Add selected",
        onAction: handleConfirm,
        disabled: selectedCount === 0,
      }}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          <Text as="p" tone="subdued" variant="bodySm">
            Choose which hotspots to add to the current product. Hotspots that
            look like ones already on the product are flagged and start
            unchecked — check them if you want a duplicate anyway.
          </Text>

          <InlineStack gap="200" blockAlign="center" wrap={false}>
            <ButtonGroup variant="segmented">
              <Button onClick={selectAll}>Select all</Button>
              <Button onClick={selectNone}>Select none</Button>
              <Button
                onClick={selectNonDuplicates}
                disabled={duplicateCount === 0 && total > 0}
              >
                Select non-duplicates
              </Button>
            </ButtonGroup>
            <Badge tone={selectedCount > 0 ? "info" : undefined}>
              {`${selectedCount} of ${total} selected`}
            </Badge>
          </InlineStack>

          {total === 0 ? (
            <Text as="p" tone="subdued">
              The selected preset has no hotspots to add.
            </Text>
          ) : (
            <BlockStack gap="200">
              {candidates.map((c) => {
                const dupe = dupeById.get(c.id);
                const checked = selectedIds.has(c.id);
                return (
                  <Box
                    key={c.id}
                    padding="300"
                    borderRadius="200"
                    borderWidth="025"
                    borderColor={checked ? "border-emphasis" : "border"}
                    background={checked ? "bg-surface-selected" : "bg-surface"}
                  >
                    <InlineStack gap="300" blockAlign="start" wrap={false}>
                      <Checkbox
                        label=""
                        labelHidden
                        checked={checked}
                        onChange={() => toggle(c.id)}
                      />
                      <Box width="100%">
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center" wrap={false}>
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              {c.title || "(Untitled hotspot)"}
                            </Text>
                            {dupe ? (
                              <Badge tone="attention">
                                {`Similar to existing '${dupe.title ?? "Untitled"}'`}
                              </Badge>
                            ) : null}
                          </InlineStack>
                          {c.body ? (
                            <Text as="p" tone="subdued" variant="bodySm" truncate>
                              {c.body}
                            </Text>
                          ) : null}
                          <Text as="p" tone="subdued" variant="bodySm">
                            {`From preset: ${c.presetName}`}
                          </Text>
                        </BlockStack>
                      </Box>
                    </InlineStack>
                  </Box>
                );
              })}
            </BlockStack>
          )}

          {duplicateCount > 0 ? (
            <Text as="p" tone="subdued" variant="bodySm">
              {`${duplicateCount} of ${total} candidate${total === 1 ? "" : "s"} flagged as duplicate (exact title match or ≥70% body similarity).`}
            </Text>
          ) : null}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
