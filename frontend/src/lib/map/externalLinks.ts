import type { MapProvider, Platform, SavedPlaceDTO } from "@/lib/types";

/**
 * Search URLs, not permalinks. Neither provider gives us a place id we could
 * link to: `place.naverLink` holds the Local Search API's `link`, which is the
 * merchant's own homepage (often a blog, often empty) — not a map page. A name
 * search lands on the right place in both apps and degrades to a result list
 * rather than a 404 when the name is ambiguous.
 */
function naverMapUrl(place: SavedPlaceDTO): string {
  return `https://map.naver.com/p/search/${encodeURIComponent(place.name)}`;
}

function kakaoMapUrl(place: SavedPlaceDTO): string {
  return `https://map.kakao.com/?q=${encodeURIComponent(place.name)}`;
}

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
