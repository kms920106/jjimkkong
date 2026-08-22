/**
 * The Navigation API's entry point. `NavigationHistoryEntry` and the rest are
 * already in TypeScript's lib.dom.d.ts; only the `window.navigation` handle is
 * missing, because the API is Chromium-only as of writing.
 *
 * Declared optional on purpose: Safari and Firefox do not implement it, and
 * every caller must branch on its absence rather than assume it is there.
 */
interface Window {
  navigation?: {
    readonly currentEntry: { readonly index: number } | null;
  };
}
