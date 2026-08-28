"use client";

import { useEffect, useRef, useState } from "react";
import MapLoadError from "./MapLoadError";
import { loadGoogleMaps } from "@/lib/map/loader";
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  FOCUS_ZOOM,
  type FocusRequest,
  type MapMarker,
} from "@/lib/map/types";
import { useMarkerLookup } from "@/lib/map/useMarkerLookup";
import {
  markerZIndex,
  markerElement,
} from "@/lib/map/markerContent";

type Props = {
  markers: MapMarker[];
  onMarkerClick?: (placeId: number) => void;
  focusRequest?: FocusRequest | null;
  selectedPlaceId?: number | null;
};

/**
 * AdvancedMarkerElement refuses to render without a Map ID, and does so
 * silently. `DEMO_MAP_ID` is Google's documented development value; a real Map
 * ID from the Cloud console belongs in the env var for production, where the
 * demo id is not supported.
 */
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

/**
 * Detaches one marker. AdvancedMarkerElement has no `setMap()` — it detaches by
 * assigning `map` — and doing that directly on an element read out of a ref
 * array trips `react-hooks/immutability`, which cannot tell a foreign SDK
 * object held in a ref from React-owned state. Taking the element as a
 * parameter is what separates the two.
 */
function detach(marker: google.maps.marker.AdvancedMarkerElement): void {
  marker.map = null;
}

/** Assigns zIndex through a parameter, for the reason `detach` exists. */
function setZ(
  marker: google.maps.marker.AdvancedMarkerElement,
  zIndex: number,
): void {
  marker.zIndex = zIndex;
}

export default function GoogleMap({
  markers,
  onMarkerClick,
  focusRequest,
  selectedPlaceId,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const findMarker = useMarkerLookup(markers);
  /** Place id → its marker, so the selection effect repaints only two pins. */
  const bySelectableId = useRef(
    new Map<number, google.maps.marker.AdvancedMarkerElement>(),
  );
  /** The pin currently painted as selected, so it can be reverted. */
  const paintedSelection = useRef<number | null>(null);
  /**
   * The live selection, read by the marker effect when it rebuilds pins. Held
   * in a ref because taking `selectedPlaceId` as a dependency there would
   * rebuild every pin on each tap.
   */
  const selectedPlaceIdRef = useRef(selectedPlaceId ?? null);
  useEffect(() => {
    selectedPlaceIdRef.current = selectedPlaceId ?? null;
  }, [selectedPlaceId]);
  // Whether a focus request is outstanding, read by the marker effect so it
  // yields the camera. Held in a ref, and updated from an effect rather than
  // during render, so the marker effect can consult it without taking
  // `focusRequest` as a dependency — depending on it would tear down and
  // rebuild every pin on each focus.
  const focusPendingRef = useRef(focusRequest != null);
  useEffect(() => {
    focusPendingRef.current = focusRequest != null;
  }, [focusRequest]);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    let created: google.maps.Map | null = null;

    loadGoogleMaps()
      .then(() => {
        if (cancelled || !container) return;
        created = new window.google.maps.Map(container, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          mapTypeControl: false,
          streetViewControl: false,
          mapId: MAP_ID,
        });
        setMap(created);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      });

    return () => {
      cancelled = true;
      for (const marker of markerRefs.current) {
        window.google?.maps?.event.clearInstanceListeners(marker);
        detach(marker);
      }
      markerRefs.current = [];
      bySelectableId.current = new Map();
      // Google has no destroy(); clearing its listeners and emptying the
      // container is what lets the instance be collected.
      if (created) window.google?.maps?.event.clearInstanceListeners(created);
      if (container) container.innerHTML = "";
      setMap(null);
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    // `map` being set is not enough. An unauthorized key still loads the script
    // and lets `new Map()` succeed with a half-built namespace, and this change
    // added a second way to get there: the pins need `libraries=marker`, so a
    // key authorized for the core API but not that library reaches
    // `maps.marker.AdvancedMarkerElement` below with nothing defined. The
    // loader checks once per page; this effect re-runs on every marker change.
    const maps = window.google?.maps;
    if (!maps?.marker) return;

    for (const marker of markerRefs.current) {
      maps.event.clearInstanceListeners(marker);
      detach(marker);
    }
    markerRefs.current = [];
    bySelectableId.current = new Map();
    // The markers those ids pointed at were just destroyed.
    paintedSelection.current = null;

    if (markers.length === 0) return;

    const bounds = new maps.LatLngBounds();

    for (const item of markers) {
      const position = { lat: item.lat, lng: item.lng };
      // Only saved pins are clickable: an optimistic one has no row yet, so
      // there are no sources to open. `placeId` being null is that state.
      const placeId = item.placeId;
      const selected =
        placeId !== null && placeId === selectedPlaceIdRef.current;
      const clickable = Boolean(onMarkerClick) && placeId !== null;
      const marker = new maps.marker.AdvancedMarkerElement({
        position,
        map,
        // The accessible name: the content below is a div, so without this the
        // pin has no name at all.
        title: item.name,
        // A DOM node, not a string — unlike the other two providers, Google
        // takes an element here. AdvancedMarkerElement anchors content at its
        // bottom centre, which is where the label's stem is.
        content: markerElement(item, selected),
        zIndex: markerZIndex(item.lat, selected),
        // Enables the `gmp-click` event below, and with it keyboard focus and
        // screen-reader announcement of `title` — a plain DOM `click` listener
        // works but the SDK warns it is the superseded path.
        gmpClickable: clickable || undefined,
      });
      if (clickable && onMarkerClick && placeId !== null) {
        marker.addEventListener("gmp-click", () => onMarkerClick(placeId));
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
      map.setCenter({ lat: markers[0].lat, lng: markers[0].lng });
      map.setZoom(15);
    } else {
      map.fitBounds(bounds, 48);
    }
  }, [map, markers, onMarkerClick]);

  /**
   * Repaints only the pin that gained the selection and the one that lost it.
   *
   * Not folded into the marker effect's dependencies: that effect destroys and
   * recreates every marker, so a tap would rebuild all pins and its trailing
   * fitBounds would move the camera off what the user was looking at.
   *
   * The class is toggled on the existing content node rather than assigning a
   * fresh element, because the click listener is registered on the marker for
   * that node — swapping the element is unnecessary work for a border colour.
   */
  useEffect(() => {
    if (!map) return;
    if (!window.google?.maps) return;

    const selected = selectedPlaceId ?? null;
    const previous = paintedSelection.current;
    if (previous === selected) return;

    /** True when the pin existed and was redrawn. */
    const repaint = (placeId: number | null, isSelected: boolean): boolean => {
      if (placeId === null) return false;
      const marker = bySelectableId.current.get(placeId);
      const item = findMarker(placeId);
      if (!marker || !item) return false;
      marker.content?.classList.toggle("jk-marker--selected", isSelected);
      setZ(marker, markerZIndex(item.lat, isSelected));
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
    // Same guard, and reachable earlier: arriving at /?place=<id> seeds
    // `focusRequest` into initial state, so this runs on the first commit.
    if (!window.google?.maps) return;
    const targets = focusRequest.placeIds
      .map(findMarker)
      .filter((item): item is MapMarker => item !== undefined);
    if (targets.length === 0) return;

    // Several places at once: frame them instead of zooming in on one. Panning
    // to the first and zooming to street level would hide the rest, which is
    // the opposite of what asking for the set means.
    if (targets.length > 1) {
      const bounds = new window.google.maps.LatLngBounds();
      for (const item of targets) {
        bounds.extend({ lat: item.lat, lng: item.lng });
      }
      map.fitBounds(bounds, 48);
      return;
    }

    const target = targets[0];

    // Zoom first, then pan. panTo only animates when the move is smaller than
    // the viewport, so a cross-country jump at overview zoom would crawl and
    // only then close in.
    if ((map.getZoom() ?? 0) < FOCUS_ZOOM) map.setZoom(FOCUS_ZOOM);
    map.panTo({ lat: target.lat, lng: target.lng });
  }, [map, findMarker, focusRequest]);

  if (error) {
    return (
      <MapLoadError title="구글 지도를 불러오지 못했습니다." detail={error} />
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}
