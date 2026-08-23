"use client";

import { useRouter } from "next/navigation";

/**
 * Turns a back <a href="..."> into a history pop when there is an entry of
 * ours behind the current page, and leaves it a plain link otherwise.
 *
 * Both screens that have a back arrow into another app page need this, and
 * they need it for the same two reasons:
 *
 * 1. Correctness. A pushed back link grows the history instead of unwinding
 *    it: `/` → `/links` → `/links/[id]` → back(push `/links`) means the next
 *    back goes *forward* to `/links/[id]`. The user pressed back twice and
 *    ended up deeper than where they started. Popping restores the entry the
 *    browser already had, so back keeps meaning back.
 * 2. Cost. `/` and `/links` are both `force-dynamic`, so pushing either is a
 *    fresh server round trip — and on `/` a map SDK boot on arrival. A pop
 *    restores the page the browser already holds.
 *
 * Kept as an <a href> so middle-click, ctrl-click, "open in new tab" and
 * keyboard activation all keep working; only a plain left click on a page we
 * can pop is turned into a pop.
 */
export function useBackLink() {
  const router = useRouter();

  /**
   * True when this page was reached by a client-side navigation from inside
   * the app, i.e. there is an entry of ours behind it that back() can pop.
   * False on a cold entry — a refresh, a bookmark, or a link from outside.
   *
   * Determined from the Navigation API's own history when the browser has it
   * (Chromium), because `navigation.entries()` only ever contains entries from
   * this document's session and `currentEntry.index > 0` therefore means
   * exactly what we need. Elsewhere (Safari, Firefox as of writing) it falls
   * back to false and the button stays a plain link.
   *
   * Deliberately NOT `history.state.idx`: that is a Pages Router field. The App
   * Router only copies `__NA` and `__PRIVATE_NEXTJS_INTERNALS_TREE` onto its
   * entries, and `__NA` is stamped on the very first one too, so neither can
   * distinguish "came from another page" from "opened this URL directly".
   *
   * Also not `history.length`: that counts the whole tab. A reused tab reports
   * a long history belonging to other sites, and back() would leave the app.
   *
   * Nothing here needs a "this page mutated, do not pop" escape hatch: the one
   * mutation in this app that invalidates the page behind us is deleting a
   * post, and that calls router.refresh(), which invalidates the bfcache and
   * navigates away with replace() — so the stale entry is already gone by the
   * time any back button is reachable.
   *
   * Read at click time rather than held in state: nothing in the render output
   * depends on it — the button looks and reads the same either way — and the
   * answer can change while the page is open, since navigating away and coming
   * back pushes new entries. A value captured on mount would be stale by then.
   */
  function canPopBack() {
    const index = window.navigation?.currentEntry?.index;
    return typeof index === "number" && index > 0;
  }

  function onBackClick(event: React.MouseEvent<HTMLAnchorElement>) {
    // Let the browser handle anything that isn't a plain left click: modified
    // clicks mean "somewhere else", not "back".
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    if (!canPopBack()) return; // nothing of ours behind: fall through to href

    event.preventDefault();
    router.back();
  }

  return { onBackClick };
}
