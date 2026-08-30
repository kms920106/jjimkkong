import type { MapProvider, Platform, SavedPlaceDTO } from "@/lib/types";

/*
 * Search URLs, not permalinks. Neither provider gives us a place id we could
 * link to. Naver's Local Search response does carry a `link`, but it is the
 * merchant's own homepage — whatever they registered, so in practice an
 * Instagram profile, a reservation page, a bare domain, or nothing at all —
 * never a map page. It used to be stored as `Place.naverLink` and was dropped
 * once it was clear nothing could read it; do not reintroduce it hoping to
 * shorten this path. A name search lands on the right place in every app and
 * degrades to a result list rather than a 404 when the name is ambiguous.
 *
 * Kakao and Google are **Apple Universal Links**, and on iOS that is the whole
 * design: this app is used from the Home Screen (standalone), where iOS hands a
 * Universal Link straight to the native app without navigating our own window —
 * so the post stays on screen and in the app switcher. With the app absent the
 * same URL just loads the provider's web map. That is why the Instagram button
 * always worked.
 *
 * **Naver is the one exception and uses `nmap://`**, because no Naver host
 * universal-links from outside their own app. See `naverMapUrl()` — it carries
 * the whole investigation, including what was ruled out. Every host, path and
 * scheme below was measured; see `AGENTS.md` here.
 *
 * Whatever the shape, it goes in an anchor's `href` and nothing else: no
 * `onClick`, no timer, no scheme/URL branching at the call site.
 */

/**
 * `nmap://place` — the one mechanism Naver actually documents, and the only one
 * that opens the app from here.
 *
 * **Naver is the exception to the Universal Link rule above, and it took two
 * wrong turns to establish that.** `map.naver.com` serves no
 * apple-app-site-association file, so an earlier version reached for
 * `nmap://` — correctly — but bolted a 1.5s timer fallback onto it. That
 * fallback raced the scheme and *won*, so the app received the fallback's
 * `/search?query=` and showed a name search ("위치 정보 없음, 서울특별시 중구
 * 중심으로 …") instead of the pin, and with the app absent it replaced the post
 * with a web map.
 *
 * The next version found `launchApp/*` in the association files of
 * `m.map.naver.com` and `inapp.map.naver.com` and used that https URL instead.
 * **It does not work from here.** On a device with the app installed, the tap
 * navigated our own window to that page, the URL gained an `#applink` hash, and
 * the app never launched. That hash is the proof: Naver's own launch SPA sets
 * it (`location.hash.indexOf("applink")<0 && …`) *before* trying
 * `navermaps://`, so the page had fully loaded and run its own script — iOS
 * never claimed the URL. Its `navermaps://` attempt then failed too, that being
 * an internal scheme absent from the docs.
 *
 * Everything checkable on the server side says that link should have worked,
 * which is why the list matters — do not re-test these:
 *
 * - Apple's own CDN copy (`app-site-association.cdn-apple.com/a/v1/…`, the file
 *   iOS actually reads) returns 200 and lists `/launchApp/*` for the shipping
 *   `6379BPE45W.com.nhncorp.NaverMap`.
 * - `/launchApp/place` matches the `/launchApp/*` pattern.
 * - Naver serves it as `application/json`; Kakao serves *its* file as
 *   `text/plain` and Kakao works anyway.
 * - It was a real anchor tap, not a scripted navigation.
 *
 * So the association file is not the problem. What cannot be checked from
 * outside is the other half — whether the app binary's Associated Domains
 * entitlement claims these hosts — and the host name `inapp` suggests the
 * answer: it is Naver's in-app webview surface, not a link target for outside
 * apps. Universal Links themselves are fine here; the Kakao and Google buttons
 * below are plain https and both hand off while this app stays alive.
 *
 * **No timer, no App Store fallback, no `onClick` — deliberately, even though
 * the official docs suggest one.** A fallback has to decide whether the
 * hand-off worked, and standalone mode cannot: Page Visibility fires with the
 * wrong state there (WebKit #202399). That guess is exactly what broke the
 * first attempt. The cost is that a visitor without the app gets iOS's "Cannot
 * Open Page" and nothing else, where Kakao and Google would show a web map —
 * accepted, because the alternative trades a rare dead end for routinely losing
 * the post, and Naver is this app's default provider.
 *
 * `appname` is required on every `nmap://` URL per the docs (a caller label;
 * they say to use the site's domain). It is a constant rather than
 * `window.location.hostname` because this runs during the server render too —
 * both call sites build the href in their render body — so a window-dependent
 * value would bake the SSR branch's answer into the hydrated tree.
 */
function naverMapUrl(place: SavedPlaceDTO): string {
  return `nmap://place?lat=${place.lat}&lng=${place.lng}&name=${encodeURIComponent(place.name)}&appname=jjimkkong.com`;
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
 * A NAVER post therefore falls through to `naverMapUrl()` — a coordinate pin
 * through the `nmap://` scheme, which does open the app. Slightly less precise
 * than the saved permalink, but precision the user cannot see is worth less
 * than not losing the page. Restoring the NAVER branch needs a form verified on
 * a device to open the place by id; the `launchApp` page is not it (see
 * `naverMapUrl()`), and that SPA answers 200 for every path, so a status code
 * proves nothing.
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
