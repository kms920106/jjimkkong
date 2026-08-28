"use client";

import { useEffect, useRef, useState } from "react";
import MapLoadError from "./MapLoadError";
import { loadNaverMaps } from "@/lib/map/loader";
import { useMarkerLookup } from "@/lib/map/useMarkerLookup";
import {
  MARKER_HEIGHT,
  MARKER_WIDTH,
  markerZIndex,
  markerHtml,
} from "@/lib/map/markerContent";
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  FOCUS_ZOOM,
  type FocusRequest,
  type MapMarker,
} from "@/lib/map/types";

type Props = {
  markers: MapMarker[];
  onMarkerClick?: (placeId: number) => void;
  focusRequest?: FocusRequest | null;
  selectedPlaceId?: number | null;
};

export default function NaverMap({
  markers,
  onMarkerClick,
  focusRequest,
  selectedPlaceId,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef<naver.maps.Marker[]>([]);
  /**
   * Place id → its marker, so the selection effect can repaint the two pins
   * whose state changed instead of rebuilding all of them. A ref rather than
   * state for the same reason `useMarkerLookup` is one: putting markers in the
   * dependency array of the effect below would rebuild every pin whenever an
   * unrelated post was saved.
   */
  const bySelectableId = useRef(new Map<number, naver.maps.Marker>());
  /** The pin currently painted as selected, so it can be reverted. */
  const paintedSelection = useRef<number | null>(null);
  /**
   * The live selection, for the marker effect to read when it builds a pin from
   * scratch. It must not take `selectedPlaceId` as a dependency — that would
   * rebuild every pin on each tap — but a rebuild triggered by something else
   * still has to draw the selected pin as selected.
   */
  const selectedPlaceIdRef = useRef(selectedPlaceId ?? null);
  useEffect(() => {
    selectedPlaceIdRef.current = selectedPlaceId ?? null;
  }, [selectedPlaceId]);
  const findMarker = useMarkerLookup(markers);
  // Whether a focus request is outstanding, read by the marker effect so it
  // yields the camera. Held in a ref, and updated from an effect rather than
  // during render, so the marker effect can consult it without taking
  // `focusRequest` as a dependency — depending on it would tear down and
  // rebuild every pin on each focus.
  const focusPendingRef = useRef(focusRequest != null);
  useEffect(() => {
    focusPendingRef.current = focusRequest != null;
  }, [focusRequest]);
  // The map lives in state, not a ref: the marker effect below must re-run
  // once the SDK finishes loading, and a ref assignment triggers no render.
  const [map, setMap] = useState<naver.maps.Map | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: naver.maps.Map | null = null;

    loadNaverMaps()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        created = new window.naver.maps.Map(containerRef.current, {
          center: new window.naver.maps.LatLng(
            DEFAULT_CENTER.lat,
            DEFAULT_CENTER.lng,
          ),
          zoom: DEFAULT_ZOOM,
        });
        setMap(created);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      });

    return () => {
      cancelled = true;
      for (const marker of markerRefs.current) {
        // An unauthorized key still loads the script but leaves the instance
        // half-built, so tearing a marker down throws from inside the SDK.
        // Unmounting must not take the page with it — navigating away from
        // the map is an ordinary action now that the list has its own route.
        try {
          window.naver?.maps?.Event.clearInstanceListeners(marker);
          marker.setMap(null);
        } catch {
          // Nothing to recover: the page is discarding this map anyway.
        }
      }
      markerRefs.current = [];
      // `created` covers the case where the map was built after unmount began.
      try {
        created?.destroy();
      } catch {
        // Same as above.
      }
      setMap(null);
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    // `map` being set is not enough. An unauthorized key still loads the
    // script and lets `new Map()` succeed, leaving the namespace half-built —
    // so every `naver.maps.*` read below can throw "Cannot read properties of
    // null" and take the whole page down with it, which the unmount path above
    // already guards against for the same reason. This effect re-runs on every
    // marker change, and saving a link now changes the set twice (a pending pin
    // added, then replaced by the saved row), so a broken key turned an
    // invisible map into a crashed page.
    const maps = window.naver?.maps;
    if (!maps) return;

    for (const marker of markerRefs.current) {
      maps.Event.clearInstanceListeners(marker);
      marker.setMap(null);
    }
    markerRefs.current = [];

    if (markers.length === 0) return;

    const first = new maps.LatLng(markers[0].lat, markers[0].lng);
    const bounds = new maps.LatLngBounds(first, first);

    bySelectableId.current = new Map();
    // Re-read on the next selection effect rather than kept: the markers these
    // ids pointed at were just destroyed above.
    paintedSelection.current = null;

    for (const item of markers) {
      const position = new maps.LatLng(item.lat, item.lng);
      // Only saved pins are clickable: an optimistic one has no row yet, so
      // there are no sources to open. `placeId` being null is that state.
      const placeId = item.placeId;
      const selected = placeId !== null && placeId === selectedPlaceIdRef.current;
      const marker = new maps.Marker({
        position,
        map,
        // Kept for the OS tooltip and for accessibility: the label below is a
        // div, so this is the only accessible name the pin has.
        title: item.name,
        icon: {
          content: markerHtml(item, selected),
          size: new maps.Size(MARKER_WIDTH, MARKER_HEIGHT),
          // The coordinate sits at the bottom centre, where the stem is.
          anchor: new maps.Point(MARKER_WIDTH / 2, MARKER_HEIGHT),
        },
        zIndex: markerZIndex(item.lat, selected),
      });
      if (onMarkerClick && placeId !== null) {
        maps.Event.addListener(marker, "click", () => onMarkerClick(placeId));
      }
      if (placeId !== null) bySelectableId.current.set(placeId, marker);
      markerRefs.current.push(marker);
      bounds.extend(position);
    }
    // Unconditional: the pins were just drawn from this value, so it is what
    // is on screen whether or not anything is selected. Guarding on non-null
    // would leave the ref lying about a cleared selection.
    paintedSelection.current = selectedPlaceIdRef.current;

    // Skipped when a focus request is pending: on arrival from /links both
    // effects run in the same commit, and this one frames *every* saved pin
    // while the focus effect frames the ones the post named. Both are deferred
    // inside the SDK, so letting both run makes the winner a race — and the
    // loser is the one the user actually asked for. The ref keeps this out of
    // the deps, so a later focus never rebuilds the markers.
    if (focusPendingRef.current) return;

    if (markers.length === 1) {
      map.setCenter(first);
      map.setZoom(15);
    } else {
      map.fitBounds(bounds);
    }
  }, [map, markers, onMarkerClick]);

  /**
   * Repaints only the pin that gained the selection and the one that lost it.
   *
   * Deliberately *not* handled by adding `selectedPlaceId` to the marker
   * effect's dependencies: that effect destroys and recreates every marker, so
   * a tap would rebuild all pins and — via the fitBounds at its end — drag the
   * camera away from what the user was looking at.
   */
  useEffect(() => {
    if (!map) return;
    // `map` being set does not mean the namespace is usable; see the marker
    // effect. This effect also runs on the first commit, when a seeded
    // selection (/links/[id]/map) is already in place.
    if (!window.naver?.maps) return;

    const selected = selectedPlaceId ?? null;
    const previous = paintedSelection.current;
    if (previous === selected) return;

    /** True when the pin existed and was redrawn. */
    const repaint = (placeId: number | null, isSelected: boolean): boolean => {
      if (placeId === null) return false;
      const marker = bySelectableId.current.get(placeId);
      const item = findMarker(placeId);
      if (!marker || !item) return false;
      marker.setIcon({
        content: markerHtml(item, isSelected),
        size: new window.naver.maps.Size(MARKER_WIDTH, MARKER_HEIGHT),
        anchor: new window.naver.maps.Point(MARKER_WIDTH / 2, MARKER_HEIGHT),
      });
      marker.setZIndex(markerZIndex(item.lat, isSelected));
      return true;
    };

    repaint(previous, false);
    // Only record what was actually drawn. `repaint` bails when the place has
    // no marker — a post deleted in another tab leaves `selectedPlaceId`
    // pointing at a pin that is gone — and storing it anyway would make the
    // ref claim a state the map does not have.
    paintedSelection.current = repaint(selected, true) ? selected : null;
  }, [map, selectedPlaceId, findMarker]);

  // Panning lives apart from the marker effect so focusing a place does not
  // tear down and rebuild every pin.
  useEffect(() => {
    if (!map || !focusRequest) return;
    // Same guard as the marker effect, and reachable the same way: `map` is
    // set even under an unauthorized key, and /links/[id]/map?place=<id> seeds
    // `focusRequest` in initial state — so this effect runs on the very first
    // commit and would throw before the marker effect's guard ever mattered.
    // That arrival is now the common case rather than an edge one: every visit
    // to a post's map carries a place to focus.
    const maps = window.naver?.maps;
    if (!maps) return;

    const targets = focusRequest.placeIds
      .map(findMarker)
      .filter((item): item is MapMarker => item !== undefined);
    if (targets.length === 0) return;

    // Several places at once: frame them instead of zooming in on one. Panning
    // to the first and zooming to street level would hide the rest, which is
    // the opposite of what asking for the set means.
    if (targets.length > 1) {
      const bounds = new maps.LatLngBounds(
        new maps.LatLng(targets[0].lat, targets[0].lng),
        new maps.LatLng(targets[0].lat, targets[0].lng),
      );
      for (const item of targets) {
        bounds.extend(new maps.LatLng(item.lat, item.lng));
      }
      map.fitBounds(bounds);
      return;
    }

    const target = targets[0];
    const position = new maps.LatLng(target.lat, target.lng);

    // Zoom first, then pan. panTo only animates over short distances, so a
    // cross-country jump at overview zoom would crawl and only then close in.
    if (map.getZoom() < FOCUS_ZOOM) map.setZoom(FOCUS_ZOOM);
    map.panTo(position, { duration: 400 });
  }, [map, findMarker, focusRequest]);

  if (error) {
    return (
      <MapLoadError title="네이버 지도를 불러오지 못했습니다." detail={error} />
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}
