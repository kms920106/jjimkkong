"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MapView from "@/components/map/MapView";
import PlaceSheet, { type PlaceDetail } from "@/components/PlaceSheet";
import type { MapProvider, PlaceSourceDTO } from "@/lib/types";
import type { FocusRequest, MapMarker } from "@/lib/map/types";

/**
 * The map with its place card: pins, the selection, the communal source fetch,
 * and the sheet itself.
 *
 * Extracted from HomeClient because a second screen needs the same surface —
 * /links/[id]/map shows one post's places on a map of their own. It is shared
 * rather than copied for the reason PostGrid is: what looks like forty lines of
 * wiring is four interlocking correctness mechanisms, each of which fixed a bug
 * that is invisible when you read one copy in isolation.
 *
 *  - the in-flight fetch is discarded unless its placeId still matches the
 *    selection, or a response from a pin the user has left lands on the sheet
 *    they are now looking at;
 *  - own and communal sources are merged deduped by sourceUrl, or the same post
 *    is listed twice;
 *  - the selection is held as an *id*, resolved through the index on each
 *    render, so a place whose post has since been deleted closes the sheet
 *    instead of rendering a snapshot of a row that is gone;
 *  - the id is tested with `!== null` rather than for truth, because Place.id
 *    is an int and place 0 would otherwise read as "nothing selected".
 *
 * A component rather than a hook, and that is the important half: the subtlest
 * contract lives in the JSX. `<PlaceSheet>` must stay mounted across opens for
 * Base UI to have a `false → true` edge to animate (see its `detail` prop), and
 * a hook returning state would leave every caller to re-derive that.
 */
export default function PlaceSheetHost({
  markers,
  placeDetails,
  mapProvider,
  focusRequest,
  initialSelectedPlaceId = null,
  suppressed = false,
  children,
}: {
  markers: MapMarker[];
  /** Place id → the place and the caller's own posts that named it. */
  placeDetails: Map<number, PlaceDetail>;
  mapProvider: MapProvider;
  focusRequest?: FocusRequest | null;
  /**
   * Opens that place's sheet on the very first paint. Seeded into initial state
   * rather than set in an effect, so there is no frame where the map is drawn
   * without it — the same reason HomeClient seeds `focusRequest` from `?place=`.
   *
   * **The id must be a key of `placeDetails`.** The selection resolves through
   * that map on every render, so an id that is not in it leaves the sheet shut
   * with no error — which reads to the user as the thing they tapped not
   * working. Callers taking the id from a URL must therefore validate it
   * against the places they are about to pass, as /links/[id]/map does on the
   * server.
   *
   * The consequence is deliberate: with `open` already true on the first render
   * there is no `false → true` edge, so the sheet does not slide up on arrival.
   * That is correct where this is used. The user tapped a place to see it on a
   * map; animating it in would animate something that was never absent. Every
   * later open on that screen gets a real edge and animates normally.
   */
  initialSelectedPlaceId?: number | null;
  /**
   * Stands the sheet down without dropping the selection. HomeClient passes
   * this while the URL sheet or the caption prompt is up: those are modal and
   * would trap focus over a non-modal sheet the user can no longer reach or
   * dismiss. Closing them brings the card back.
   */
  suppressed?: boolean;
  /**
   * Floating controls drawn over the map. Given the live selection because at
   * least one of them has to hide while the card is up — the sheet is portaled
   * to <body>, so it paints over anything in this subtree whatever its z-index
   * says, and z-index cannot resolve that.
   */
  children?: (selectedPlace: PlaceDetail | null) => React.ReactNode;
}) {
  // Held as an id rather than the detail object so a refresh of the post list —
  // deleting the post from another tab, re-saving the link — flows through to
  // the open sheet instead of leaving a snapshot of data that no longer exists.
  const [selectedPlaceId, setSelectedPlaceId] = useState<number | null>(
    initialSelectedPlaceId,
  );

  // Every user's saved links for the currently open pin, fetched separately
  // from the caller's own list. Keyed by place id so a stale response from a
  // pin the user has since closed cannot land on the wrong sheet.
  const [communalSources, setCommunalSources] = useState<{
    placeId: number;
    sources: PlaceSourceDTO[];
  } | null>(null);

  /**
   * A marker click opens the place's sheet and leaves the camera alone. It used
   * to pan and zoom to the pin as well, but pressing a pin to read about it
   * moved the view the user had set up, so they had to find their way back.
   *
   * The camera only moves when the user explicitly asked for it, which is what
   * `focusRequest` carries; nothing here writes it.
   */
  const handleMarkerClick = useCallback((placeId: number) => {
    setSelectedPlaceId(placeId);
  }, []);

  // Un-scoped by design — the place row is already shared across users, so this
  // only reads what the shared map already implies. A stale in-flight request
  // from a pin the user has since left is discarded by checking the placeId
  // still matches the current selection when it resolves.
  useEffect(() => {
    if (selectedPlaceId === null) return;
    let cancelled = false;
    fetch(`/api/places/${selectedPlaceId}/sources`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { sources: PlaceSourceDTO[] } | null) => {
        if (cancelled || !body) return;
        setCommunalSources({ placeId: selectedPlaceId, sources: body.sources });
      })
      .catch(() => {
        // Silent: the sheet still has the caller's own sources from
        // `placeDetails` to fall back on.
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPlaceId]);

  // Resolved through the index rather than stored, so a place that disappears
  // — its only post deleted — closes the sheet instead of showing stale data.
  // `!== null`, not truthy: the id is an int, and a falsy test would treat
  // place 0 as "nothing selected". Identity columns start at 1 so it is
  // unreachable, but the check should mean what it says.
  const ownPlaceDetail =
    selectedPlaceId !== null
      ? (placeDetails.get(selectedPlaceId) ?? null)
      : null;

  /**
   * What PlaceSheet actually renders: the caller's own sources (always present)
   * merged with every other user's sources for the same pin (fetched
   * separately, arrives a beat later). Deduped by sourceUrl — the same post
   * saved by two different users would otherwise list the same link twice.
   */
  const selectedPlace = useMemo<PlaceDetail | null>(() => {
    if (!ownPlaceDetail) return null;
    const bySourceUrl = new Map(
      ownPlaceDetail.sources.map((source) => [source.sourceUrl, source]),
    );
    if (
      communalSources &&
      communalSources.placeId === ownPlaceDetail.place.id
    ) {
      for (const source of communalSources.sources) {
        if (!bySourceUrl.has(source.sourceUrl)) {
          bySourceUrl.set(source.sourceUrl, source);
        }
      }
    }
    return { place: ownPlaceDetail.place, sources: [...bySourceUrl.values()] };
  }, [ownPlaceDetail, communalSources]);

  return (
    <>
      <MapView
        provider={mapProvider}
        markers={markers}
        onMarkerClick={handleMarkerClick}
        focusRequest={focusRequest}
      />

      {children?.(selectedPlace)}

      {/* Always mounted — PlaceSheet owns its own open/closed transition (see
          its `detail` prop doc) and needs a real `false → true` edge on `open`
          to animate the slide-up, which a conditionally-mounted
          `{selectedPlace && <PlaceSheet .../>}` cannot provide since the first
          render would already have `open` at its final value. */}
      <PlaceSheet
        detail={suppressed ? null : selectedPlace}
        mapProvider={mapProvider}
        onClose={() => setSelectedPlaceId(null)}
      />
    </>
  );
}
