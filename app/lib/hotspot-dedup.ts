/**
 * Hotspot duplicate detection — used by the preset apply flow to flag
 * incoming hotspots that look like ones already on the product.
 *
 * Spec (locked in Slice 7 plan's out-of-scope, shipped Slice 8): a
 * candidate hotspot is a duplicate of an existing one if EITHER:
 *  - case-insensitive trimmed titles match exactly, OR
 *  - Jaccard similarity on tokenized body words is >= 0.70
 *
 * Jaccard chosen over Levenshtein at the body-paragraph scale:
 * language-tolerant (token-level — word reorderings and inserts don't
 * tank the score), cheap to compute, no normalization tuning. The 0.70
 * threshold is the spec'd value; a number in the 0.6–0.8 range is
 * reasonable, but ship with 0.70 and revisit only if merchants ask.
 *
 * Two empty bodies are NOT considered duplicates (Jaccard is undefined
 * for empty sets; we treat it as "no body match"). Two non-empty
 * identical bodies are similarity 1.0 → flagged.
 *
 * Pure functions, no IO, no DOM — safe to import from server and client.
 */

export interface HotspotLike {
  title?: string | null;
  body?: string | null;
}

/**
 * Tokenize a body string into a Set of lowercased word tokens. Splits
 * on whitespace + common punctuation; drops tokens shorter than 2 chars
 * to avoid stop-fragment noise (`a`, `i`, single punctuation rests).
 */
export function tokenizeBody(body: string | null | undefined): Set<string> {
  if (!body) return new Set();
  const tokens = body
    .toLowerCase()
    .split(/[\s,.;:!?()[\]{}"'`\-–—/\\]+/u)
    .filter((t) => t.length >= 2);
  return new Set(tokens);
}

/**
 * Jaccard similarity of two token sets: |A ∩ B| / |A ∪ B|.
 * Returns 0 when both sets are empty (treated as "no body match",
 * not "perfect match").
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersect = 0;
  for (const token of a) {
    if (b.has(token)) intersect++;
  }
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

/**
 * Normalised title for the exact-title rule. Trims and lowercases.
 * Empty/missing → empty string (two missing titles do NOT match —
 * we only flag duplicates when the merchant has actually filled in
 * matching titles).
 */
function normaliseTitle(title: string | null | undefined): string {
  return (title ?? "").trim().toLowerCase();
}

export const JACCARD_THRESHOLD = 0.7;

/**
 * Check whether `candidate` duplicates any hotspot in `existing`.
 * Returns the *first* match found (existing-side hotspot) so the UI
 * can show "Similar to existing '<title>'". Returns null if no match.
 *
 * Intended for use in a UI rendering loop — caller can compute the
 * existing tokenized bodies once and pass them in to avoid repeated
 * tokenization across many candidates.
 */
export function findDuplicate<T extends HotspotLike>(
  candidate: HotspotLike,
  existing: ReadonlyArray<T>,
  existingTokens?: ReadonlyArray<Set<string>>,
): T | null {
  const candidateTitle = normaliseTitle(candidate.title);
  const candidateTokens = tokenizeBody(candidate.body);

  for (let i = 0; i < existing.length; i++) {
    const e = existing[i];
    const eTitle = normaliseTitle(e.title);
    if (candidateTitle && eTitle && candidateTitle === eTitle) {
      return e;
    }
    if (candidateTokens.size > 0) {
      const eTokens = existingTokens?.[i] ?? tokenizeBody(e.body);
      if (jaccardSimilarity(candidateTokens, eTokens) >= JACCARD_THRESHOLD) {
        return e;
      }
    }
  }
  return null;
}

/**
 * Precompute existing-hotspot body token sets so a UI rendering many
 * candidates against the same `existing` array doesn't re-tokenize on
 * every row. Returned array is parallel to `existing`.
 */
export function precomputeExistingTokens<T extends HotspotLike>(
  existing: ReadonlyArray<T>,
): Set<string>[] {
  return existing.map((e) => tokenizeBody(e.body));
}
