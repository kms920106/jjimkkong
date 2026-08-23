import type { MapProvider, Platform, SavedPlaceDTO } from "@/lib/types";

/*
 * Search URLs, not permalinks. Neither provider gives us a place id we could
 * link to: `place.naverLink` holds the Local Search API's `link`, which is the
 * merchant's own homepage (often a blog, often empty) — not a map page. A name
 * search lands on the right place in every app and degrades to a result list
 * rather than a 404 when the name is ambiguous.
 *
 * All three are **Apple Universal Links**, and on iOS that is the whole design:
 * this app is used from the Home Screen (standalone), where iOS hands a
 * Universal Link straight to the native app without navigating our own window —
 * so the post stays on screen and in the app switcher. With the app absent the
 * same URL just loads the provider's web map. That is why the Instagram button
 * always worked, and why none of these needs a custom scheme or a fallback
 * timer of ours. Every host/path below was measured; see `AGENTS.md` here.
 */

/**
 * `inapp.map.naver.com/launchApp/place`, and every part of that is load-bearing.
 *
 * **`map.naver.com` has no apple-app-site-association file, but
 * `launchApp/*` on both `m.map.naver.com` and `inapp.map.naver.com` does**
 * (verified) — registered to `com.nhncorp.NaverMap`, the shipping app. We name
 * the `inapp.` host because the `m.` one **302s to it and drops the query
 * string** (measured), so a user without the app would land on a bare map page
 * instead of this place. iOS never performs that redirect when the app *is*
 * installed — it claims the URL first — so the `m.` host looks fine on a test
 * device with the app and silently degrades for everyone else.
 *
 * Missing that subdomain+path is what made an earlier version conclude a scheme
 * was the only option and hand-roll `nmap://` plus a timed fallback. That
 * fallback then raced the scheme and *won*, so the app received the fallback's
 * `/search?query=` and showed a name search ("위치 정보 없음, 서울특별시 중구
 * 중심으로 …") instead of the pin. Deleting the timer is what fixes it, and no
 * replacement is possible: standalone mode cannot tell whether the hand-off
 * succeeded, because Page Visibility fires with the wrong state there
 * (WebKit #202399).
 *
 * `place` with `lat`/`lng`/`name` matches the documented `nmap://place`
 * contract, and Naver's own launch page re-encodes these query params into
 * `navermaps://place?…` for us — so coordinates give an exact pin rather than a
 * name guess, and Naver, not us, owns the scheme name and App Store id.
 *
 * No `appname`: that is required on a raw `nmap://` URL, but this page reads
 * only `appSchemeName` (allowed values `nmap`/`navermaps`), so our own label
 * would do nothing. `fallbackUrl` is likewise useless to us — the page accepts
 * it only for `*.naver.com` hosts, so we cannot ask it to return the user here.
 * With the app missing this lands on Naver's install page, the same trade the
 * Kakao and Google links already make.
 */
function naverMapUrl(place: SavedPlaceDTO): string {
  return `https://inapp.map.naver.com/launchApp/place?lat=${place.lat}&lng=${place.lng}&name=${encodeURIComponent(place.name)}`;
}

/**
 * `m.map.kakao.com/actions/searchView`, not `map.kakao.com`: that host serves a
 * *malformed* association file (an unterminated string, so iOS may reject it
 * wholesale) and on a mobile UA it 302s `/?q=` to `applink.map.kakao.com` —
 * Kakao's own "open in app" interstitial, the very screen this design avoids.
 * The `m.` host serves valid JSON listing `/actions/searchView`.
 */
function kakaoMapUrl(place: SavedPlaceDTO): string {
  return `https://m.map.kakao.com/actions/searchView?q=${encodeURIComponent(place.name)}`;
}

/** A Universal Link per Google's iOS docs, and it degrades to the web map. */
function googleMapUrl(place: SavedPlaceDTO): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}`;
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
  { label: string; url: (place: SavedPlaceDTO) => string }
> = {
  NAVER: { label: "네이버맵", url: naverMapUrl },
  KAKAO: { label: "카카오맵", url: kakaoMapUrl },
  GOOGLE: { label: "구글맵", url: googleMapUrl },
};

// Derived rather than hand-listed: MAP_APPS is a Record<MapProvider, …>, so
// the compiler forces a new provider into it — a separate literal array would
// silently omit it and the menu would never offer that provider.
const MAP_APP_ORDER = Object.keys(MAP_APPS) as MapProvider[];

export type MapApp = {
  provider: MapProvider;
  label: string;
  url: (place: SavedPlaceDTO) => string;
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
 * search by name, so without this a KAKAO post would offer a fuzzy guess in
 * place of the precise permalink the user actually saved.
 *
 * **Kakao only, and that asymmetry is deliberate.** The permalink is handed to
 * an anchor in the Home Screen app, so it has to be a Universal Link or it
 * navigates the post away — the exact failure this file exists to prevent.
 * `canonicalize()` stores Kakao places as `place.map.kakao.com/<id>`, and that
 * host files `"paths": ["/*"]` for `net.daum.maps` (verified), so it hands off.
 * Naver's canonical form is `map.naver.com/p/entry/place/<id>` and
 * `map.naver.com` has **no** association file at all (verified), so returning it
 * would replace the post with Naver's web map.
 *
 * A NAVER post therefore falls through to `naverMapUrl()` — a coordinate pin on
 * a host that does hand off. Slightly less precise than the saved permalink,
 * but precision the user cannot see is worth less than not losing the page.
 * Do not "restore" the NAVER branch without a `launchApp` form that is verified
 * on a device to open the place by id; a 200 from that SPA proves nothing,
 * because it answers 200 for every path.
 */
export function exactLinkFor(post: {
  platform: Platform;
  sourceUrl: string;
}): { provider: MapProvider; href: string } | undefined {
  if (post.platform === "KAKAO") {
    return { provider: "KAKAO", href: post.sourceUrl };
  }
  return undefined;
}

/**
 * The href for one app given the post the place was saved from, folding the
 * exact permalink into its own provider's slot rather than adding a row — the
 * menu must not offer two 네이버맵 entries that differ only in precision.
 */
export function hrefForApp(
  app: MapApp,
  place: SavedPlaceDTO,
  post?: { platform: Platform; sourceUrl: string },
): string {
  const exact = post ? exactLinkFor(post) : undefined;
  return exact?.provider === app.provider ? exact.href : app.url(place);
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
