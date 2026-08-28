import type { MapProvider } from "@/generated/prisma/enums";

/**
 * A pin on the map. Two kinds live in one list, which is why the identity is
 * split across two fields rather than carried by one:
 *
 * - a saved place, `placeId` set, `key` its decimal form;
 * - an optimistic pin drawn while POST /api/posts is still running, `placeId`
 *   null because the row does not exist yet, `key` a synthetic string.
 *
 * `key` is what dedupes and addresses a pin (React keys, the lookup in
 * useMarkerLookup), and it stays a string precisely so those two kinds can
 * never collide: a pending pin's key is prefixed and could not be produced by
 * `String(placeId)`. Do not collapse this back into a single id — Place.id
 * became an int in 20260825, so a numeric id has no room for the prefix that
 * keeps a pending pin from shadowing a saved one.
 *
 * `placeId` is the real, server-owned identity and the only one safe to send
 * anywhere: it addresses GET /api/places/[id]/sources and survives a reload.
 * Null means "not saved yet", so a null check is the test for whether a pin can
 * be clicked through to its sources.
 */
export type MapMarker = {
  key: string;
  placeId: number | null;
  name: string;
  lat: number;
  lng: number;
  /**
   * The Naver Local Search category path, rendered as its leaf under the name
   * (`카레` of `음식점>일식>카레`, via `categoryLeaf()`). Null for a place the
   * lookup returned no category for, which the marker renders as a name-only
   * label rather than an empty second line.
   *
   * There is deliberately no image field. No provider gives a photo of a place
   * that this app may store: Naver and Kakao local search return no image at
   * all, and Google Places forbids storing its photos (only `place_id` is
   * exempt from its caching rule). `Post.thumbnail` is a reel cover, not the
   * venue — and a place saved from two posts would show whichever post the
   * dedupe in HomeClient happened to keep, so an unrelated save would change
   * this pin's picture.
   */
  category: string | null;
};

/**
 * A request to move the camera. The nonce makes each click a distinct event:
 * focusing the same place twice must re-center it, which a bare id could not
 * express because React bails out when state is unchanged.
 *
 * `placeIds` is a set rather than a single id because a saved post can hold
 * several places — one reel with six stops on it — and "show me these" is a
 * different camera move from "show me this one": a single place zooms in to
 * read the street, a set has to back off far enough to hold all of them. The
 * marker effect's own fitBounds cannot serve this, since it frames every pin
 * the user has saved, not the ones this post named.
 */
export type FocusRequest = {
  placeIds: number[];
  nonce: number;
};

export type MapViewProps = {
  provider: MapProvider;
  markers: MapMarker[];
  /**
   * Only fires for saved pins — an optimistic one has no row to show sources
   * for, so it is not clickable.
   */
  onMarkerClick?: (placeId: number) => void;
  /**
   * Kept separate from `markers` so focusing moves the camera without
   * rebuilding every pin.
   */
  focusRequest?: FocusRequest | null;
  /**
   * The pin drawn as selected. Kept out of `markers` for the same reason
   * `focusRequest` is: a provider must never put this in the marker effect's
   * dependencies, or every tap would tear down and rebuild all pins and drag
   * the camera with it. Each provider redraws only the two pins whose state
   * changed.
   */
  selectedPlaceId?: number | null;
};

/** Seoul city hall — the fallback center when nothing is saved yet. */
export const DEFAULT_CENTER = { lat: 37.5666, lng: 126.9784 };
export const DEFAULT_ZOOM = 12;
/**
 * Close enough to read the street a focused place sits on. Kakao inverts zoom
 * into a "level", so it keeps its own `LEVEL_FOCUS` — change both together.
 */
export const FOCUS_ZOOM = 16;
