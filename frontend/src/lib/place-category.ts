/**
 * The Naver Local Search `category` field, as a readable breadcrumb.
 *
 * The API hands it back as a `>`-joined path with no spaces
 * (`음식점>일식>카레`), which renders as one unbroken token and wraps at
 * arbitrary points on a phone. Spacing the separator gives the browser real
 * break opportunities and reads as the hierarchy it is.
 *
 * Returns null rather than "" for a place with no category, so callers have
 * one absent state to test — the same normalisation the profile fields use.
 */
export function formatCategory(category: string | null): string | null {
  if (!category) return null;
  const parts = category
    .split(">")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(" > ") : null;
}

/**
 * The most specific segment (`카레` of `음식점>일식>카레`), for places where
 * only one line fits. The leaf is the informative end: `음식점` describes
 * most of what this app saves and distinguishes nothing.
 */
export function categoryLeaf(category: string | null): string | null {
  if (!category) return null;
  const parts = category
    .split(">")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.at(-1) ?? null;
}
