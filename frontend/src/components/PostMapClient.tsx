"use client";

import { useMemo, useState } from "react";
import PlaceSheetHost from "@/components/map/PlaceSheetHost";
import { SettingsHeader } from "@/components/SettingsHeader";
import type { PlaceDetail } from "@/components/PlaceSheet";
import type { MapProvider, SavedPostDTO } from "@/lib/types";
import type { FocusRequest, MapMarker } from "@/lib/map/types";
import { useBackLink } from "@/lib/use-back-link";

/**
 * One post's places on a map, with the card for the tapped place already open.
 *
 * The pins are this post's alone. The home map's are every pin the member has
 * saved, which is why tapping a place card used to go there and arrive with the
 * post's own route buried among unrelated links.
 */
export default function PostMapClient({
  post,
  requestedPlaceIds,
  mapProvider,
}: {
  post: SavedPostDTO;
  /**
   * Already validated against this post's places by the server, so anything
   * here is a real pin on this map. The first one opens its card; all of them
   * frame the camera.
   */
  requestedPlaceIds: number[];
  mapProvider: MapProvider;
}) {
  /**
   * Back to the post. Popping rather than pushing is what makes the second back
   * press leave /links/[id] instead of returning here — see useBackLink. The
   * href stays as the fallback for modified clicks and for browsers without the
   * Navigation API.
   */
  const { onBackClick } = useBackLink();

  const markers = useMemo<MapMarker[]>(
    () =>
      post.places.map((place) => ({
        key: String(place.id),
        placeId: place.id,
        name: place.name,
        lat: place.lat,
        lng: place.lng,
        category: place.category,
      })),
    [post.places],
  );

  /**
   * The camera move, seeded into initial state so the pins are framed on the
   * very first paint with no visible jump — the same reason the home map seeds
   * its own from `?place=`.
   *
   * Never reassigned: a marker click deliberately does not move the camera (a
   * pin tapped to read about it should not move the view the user set up), so
   * arriving here is the only thing that focuses.
   */
  const [focusRequest] = useState<FocusRequest | null>(() =>
    requestedPlaceIds.length > 0
      ? { placeIds: requestedPlaceIds, nonce: 0 }
      : null,
  );

  /**
   * Every place of this post keyed by id, which is what the card renders. The
   * only source is this post — the sheet merges in other members' posts for the
   * same pin itself.
   */
  const placeDetails = useMemo(() => {
    const byId = new Map<number, PlaceDetail>();
    for (const place of post.places) {
      byId.set(place.id, {
        place,
        // The shared post id, not the bookmark id: the sheet merges these with
        // other members' sources for the same pin and dedupes across both, so
        // both halves have to identify a post by the same key.
        sources: [
          {
            postId: post.postId,
            sourceUrl: post.sourceUrl,
            platform: post.platform,
            title: post.title,
            thumbnail: post.thumbnail,
            author: post.author,
          },
        ],
      });
    }
    return byId;
  }, [post]);

  return (
    // A column, not the home map's `fixed h-dvh`: the header has to take its
    // own height rather than float over the map.
    //
    // h-dvh rather than min-h-screen, which the scrolling pages use: this one
    // must not scroll, and 100vh resolves against iOS Safari's *large* viewport
    // — the one that assumes the toolbars are retracted — so the bottom of the
    // map would sit under the browser chrome. w-full rather than w-screen for
    // the reason the home map records: 100vw includes the scrollbar gutter.
    <div className="flex h-dvh w-full flex-col overflow-hidden">
      <SettingsHeader
        href={`/links/${post.seq}`}
        ariaLabel="게시글로"
        title="지도"
        onBackClick={onBackClick}
      />

      {/* `min-h-0` is load-bearing: all three provider containers are
          `h-full w-full`, which needs a resolved parent height, and a flex
          child defaults to `min-height: auto` — it would overflow the column
          rather than shrink to it, pushing the header off screen. */}
      <div className="relative min-h-0 flex-1">
        <PlaceSheetHost
          markers={markers}
          placeDetails={placeDetails}
          mapProvider={mapProvider}
          focusRequest={focusRequest}
          // Opens the tapped place's card on the first paint. There is no
          // slide-up on arrival, which is correct here: the user tapped this
          // place to see it on a map, so animating the card in would animate
          // something that was never absent. Later opens on this screen get a
          // real `false → true` edge and animate.
          initialSelectedPlaceId={requestedPlaceIds[0] ?? null}
          // Always true here, unlike on the home map: this page only renders
          // for a member who holds a bookmark of the post (the server 404s
          // otherwise), so there is no signed-out state for the star to have.
          signedIn
        />
      </div>
    </div>
  );
}
