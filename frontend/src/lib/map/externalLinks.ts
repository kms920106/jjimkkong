import type { MapProvider, Platform, SavedPlaceDTO } from "@/lib/types";

/**
 * Where one map button leads.
 *
 * Two shapes because iOS treats the two kinds of URL completely differently,
 * and this app is used as a Home Screen (standalone) web app on iOS:
 *
 * - `url` is an **Apple Universal Link**. iOS hands it straight to the native
 *   app and our own window never navigates, so the post stays on screen and in
 *   the app switcher. If the app is absent the same URL just loads the web map
 *   — no interstitial, no error dialog. This is why the Instagram button
 *   already behaves correctly and needs nothing from us.
 * - `scheme` is a custom URL scheme, needed only where no Universal Link
 *   exists. It hands off just as cleanly, but it cannot degrade on its own:
 *   with the app missing, nothing happens (or iOS shows "Cannot Open Page").
 *   So it carries the web map to fall back to — see `openMapApp()`.
 */
export type MapTarget =
  | { kind: "url"; href: string }
  | { kind: "scheme"; scheme: string; fallback: string };

/*
 * Search targets, not permalinks. Neither provider gives us a place id we could
 * link to: `place.naverLink` holds the Local Search API's `link`, which is the
 * merchant's own homepage (often a blog, often empty) — not a map page. A name
 * search lands on the right place in every app and degrades to a result list
 * rather than a 404 when the name is ambiguous.
 */

/**
 * Naver is the one provider that needs a scheme: `map.naver.com` serves no
 * apple-app-site-association file (verified), so iOS opens its https URLs as a
 * *web page*. In a Home Screen app that page replaced the post the user was
 * reading with Naver's "Install NAVER Maps" interstitial, which then launched
 * the app itself — the app opened, but our screen was gone.
 *
 * `place` rather than `search` because we already hold coordinates, so the pin
 * is exact instead of a name guess. All three of `lat`, `lng` and `name` are
 * required by the scheme, as is `appname` on every `nmap://` URL.
 */
function naverMapTarget(place: SavedPlaceDTO): MapTarget {
  const name = encodeURIComponent(place.name);
  // `appname` is a caller label, so a constant is honest here. It is emphatically
  // *not* read from `window.location`: this function runs during the server
  // render too (both call sites build the target in their render body, to fill
  // the anchor's href), so a window-dependent value would be the SSR branch's
  // value baked into the hydrated tree — a lie that reads like a feature.
  const appname = "jjimkkong";
  return {
    kind: "scheme",
    scheme: `nmap://place?lat=${place.lat}&lng=${place.lng}&name=${name}&appname=${appname}`,
    // The App Store page would be the other candidate, but a user who tapped
    // 네이버맵 wants to see the place — a web map does that and a store page
    // does not.
    // The path `search2/search.naver` merely 302s here (measured), so name the
    // destination directly and save the redirect.
    fallback: `https://m.map.naver.com/search?query=${name}`,
  };
}

/**
 * `m.map.kakao.com/actions/searchView`, and all three parts of that matter.
 *
 * - The **host must be `m.`**. `map.kakao.com` serves a *malformed* association
 *   file (an unterminated string, so iOS may reject it wholesale), and on a
 *   mobile UA it now 302s `/?q=` to `applink.map.kakao.com` — Kakao's own
 *   "open in app" interstitial, which is exactly the screen this change exists
 *   to stop showing. `m.map.kakao.com` serves valid JSON.
 * - `/actions/searchView` is one of the paths that file universal-links; the
 *   `map.kakao.com` equivalent redirects to a 404 page (measured).
 * - So this is a Universal Link and needs no scheme: with the app installed
 *   iOS hands it over, without it the same URL renders Kakao's mobile web
 *   search for the place.
 *
 * Do not "simplify" this back to `map.kakao.com/?q=`.
 */
function kakaoMapTarget(place: SavedPlaceDTO): MapTarget {
  return {
    kind: "url",
    href: `https://m.map.kakao.com/actions/searchView?q=${encodeURIComponent(place.name)}`,
  };
}

/** Already a Universal Link per Google's iOS docs, and it degrades to the web map. */
function googleMapTarget(place: SavedPlaceDTO): MapTarget {
  return {
    kind: "url",
    href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}`,
  };
}

/**
 * The external map apps, ordered so the user's own `mapProvider` comes first.
 *
 * Every place used to emit a fixed 네이버맵 + 카카오맵 pair, which on a
 * six-place post meant twelve near-identical chips competing with the place
 * names themselves. Ordering by the stored preference lets the row show one
 * and file the rest under the ⋯ menu, and it keeps the list honest for a
 * GOOGLE user, whose provider had no entry here at all.
 */
const MAP_APPS: Record<
  MapProvider,
  { label: string; target: (place: SavedPlaceDTO) => MapTarget }
> = {
  NAVER: { label: "네이버맵", target: naverMapTarget },
  KAKAO: { label: "카카오맵", target: kakaoMapTarget },
  GOOGLE: { label: "구글맵", target: googleMapTarget },
};

// Derived rather than hand-listed: MAP_APPS is a Record<MapProvider, …>, so
// the compiler forces a new provider into it — a separate literal array would
// silently omit it and the menu would never offer that provider.
const MAP_APP_ORDER = Object.keys(MAP_APPS) as MapProvider[];

export type MapApp = {
  provider: MapProvider;
  label: string;
  target: (place: SavedPlaceDTO) => MapTarget;
};

export function mapAppsFor(preferred: MapProvider): MapApp[] {
  return [preferred, ...MAP_APP_ORDER.filter((p) => p !== preferred)].map(
    (provider) => ({ provider, ...MAP_APPS[provider] }),
  );
}

/**
 * `sourceUrl` when the post came *from* a map provider, which is the one case
 * where the saved link names an exact place rather than merely mentioning it
 * ("지도 링크는 캡션이 아니라 장소 그 자체다"). The generated entries only
 * search by name, so without this a NAVER/KAKAO post would offer a fuzzy guess
 * in place of the precise permalink the user actually saved.
 */
export function exactLinkFor(post: {
  platform: Platform;
  sourceUrl: string;
}): { provider: MapProvider; href: string } | undefined {
  if (post.platform === "NAVER") {
    return { provider: "NAVER", href: post.sourceUrl };
  }
  if (post.platform === "KAKAO") {
    return { provider: "KAKAO", href: post.sourceUrl };
  }
  return undefined;
}

/**
 * Where one app's button leads, given the post the place was saved from. The
 * exact permalink folds into its own provider's slot rather than adding a row —
 * the menu must not offer two 네이버맵 entries that differ only in precision.
 *
 * A permalink stays a plain `url`: it is the link the user actually saved, and
 * `naver.me`/`map.naver.com` permalinks are not ours to rewrite into a scheme.
 */
export function targetForApp(
  app: MapApp,
  place: SavedPlaceDTO,
  post?: { platform: Platform; sourceUrl: string },
): MapTarget {
  const exact = post ? exactLinkFor(post) : undefined;
  return exact?.provider === app.provider
    ? { kind: "url", href: exact.href }
    : app.target(place);
}

/**
 * The `href` to put on the anchor. For a scheme target that is the *fallback*,
 * not the scheme: the attribute has to stay a real link so the markup works
 * without JS and so long-press/copy-link gives something openable. `nmap://`
 * in an href would hand a broken menu entry to every desktop visitor.
 */
export function hrefOf(target: MapTarget): string {
  return target.kind === "url" ? target.href : target.fallback;
}

/** Directions to the place in the user's preferred app, by name search. */
export function directionsUrl(
  place: SavedPlaceDTO,
  provider: MapProvider,
): string {
  switch (provider) {
    case "KAKAO":
      return `https://map.kakao.com/link/to/${encodeURIComponent(place.name)},${place.lat},${place.lng}`;
    case "GOOGLE":
      return `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`;
    case "NAVER":
    default:
      // Naver's directions deep link wants the destination named as well as
      // positioned; the trailing empty fields are the mode slots it requires.
      return `https://map.naver.com/p/directions/-/${place.lng},${place.lat},${encodeURIComponent(place.name)}/-/transit`;
  }
}
