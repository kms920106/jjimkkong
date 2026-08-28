"use client";

import { useEffect, useRef, useState } from "react";
import MapLoadError from "./MapLoadError";
import { loadKakaoMaps } from "@/lib/map/loader";
import {
  DEFAULT_CENTER,
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
 * Kakao's zoom is an inverted "level" (smaller = closer), so the shared zoom
 * constants are translated rather than passed through.
 */
const LEVEL_OVERVIEW = 9;
const LEVEL_SINGLE = 4;
/** Kakao's counterpart to the shared FOCUS_ZOOM. */
const LEVEL_FOCUS = 3;

/**
 * A CustomOverlay is not an event target — the SDK gives it no `addListener`
 * and there is no `clearInstanceListeners` for it — so the click lives on the
 * content element and has to be removed from that same node. Keeping the node
 * and handler beside the overlay is what makes teardown possible.
 */
type TrackedMarker = {
  overlay: kakao.maps.CustomOverlay;
  element: HTMLElement;
  handler?: () => void;
};

export default function KakaoMap({
  markers,
  onMarkerClick,
  focusRequest,
  selectedPlaceId,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef<TrackedMarker[]>([]);
  const findMarker = useMarkerLookup(markers);
  /** Place id → its overlay, so the selection effect repaints only two pins. */
  const bySelectableId = useRef(new Map<number, kakao.maps.CustomOverlay>());
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
  const [map, setMap] = useState<kakao.maps.Map | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;

    loadKakaoMaps()
      .then(() => {
        if (cancelled || !container) return;
        setMap(
          new window.kakao.maps.Map(container, {
            center: new window.kakao.maps.LatLng(
              DEFAULT_CENTER.lat,
              DEFAULT_CENTER.lng,
            ),
            level: LEVEL_OVERVIEW,
          }),
        );
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      });

    return () => {
      cancelled = true;
      for (const { overlay, element, handler } of markerRefs.current) {
        if (handler) element.removeEventListener("click", handler);
        overlay.setMap(null);
      }
      markerRefs.current = [];
      bySelectableId.current = new Map();
      // Kakao exposes no destroy(); emptying the container is what releases
      // the SDK's hold on the DOM node it rendered into.
      if (container) container.innerHTML = "";
      setMap(null);
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    // `map` being set is not enough. An unauthorized key still loads the script
    // and lets `new Map()` succeed, leaving the namespace half-built — so every
    // `kakao.maps.*` read below can throw and take the whole page down. This
    // effect re-runs on every marker change, and saving a link changes the set
    // twice (a pending pin added, then replaced by the saved row), so a broken
    // key would turn an invisible map into a crashed page. See the sibling
    // guard in NaverMap and this directory's AGENTS.md.
    const maps = window.kakao?.maps;
    if (!maps) return;

    for (const { overlay, element, handler } of markerRefs.current) {
      if (handler) element.removeEventListener("click", handler);
      overlay.setMap(null);
    }
    markerRefs.current = [];
    bySelectableId.current = new Map();
    // The overlays those ids pointed at were just destroyed.
    paintedSelection.current = null;

    if (markers.length === 0) return;

    const bounds = new maps.LatLngBounds();

    for (const item of markers) {
      const position = new maps.LatLng(item.lat, item.lng);
      // Only saved pins are clickable: an optimistic one has no row yet, so
      // there are no sources to open. `placeId` being null is that state.
      const placeId = item.placeId;
      const selected =
        placeId !== null && placeId === selectedPlaceIdRef.current;
      // An element rather than an HTML string: the click has to attach to this
      // exact node, and setContent(string) would replace it with one we no
      // longer hold a reference to, silently dropping the listener.
      const element = markerElement(item, selected);
      const overlay = new maps.CustomOverlay({
        position,
        content: element,
        // The coordinate sits at the bottom centre of the label, where the
        // stem is.
        xAnchor: 0.5,
        yAnchor: 1,
        zIndex: markerZIndex(item.lat, selected),
        // Stops a tap on the label from also being handled as a map drag.
        clickable: true,
      });
      overlay.setMap(map);

      let handler: (() => void) | undefined;
      if (onMarkerClick && placeId !== null) {
        handler = () => onMarkerClick(placeId);
        element.addEventListener("click", handler);
      }
      if (placeId !== null) bySelectableId.current.set(placeId, overlay);
      markerRefs.current.push({ overlay, element, handler });
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
      map.setCenter(
        new maps.LatLng(markers[0].lat, markers[0].lng),
      );
      map.setLevel(LEVEL_SINGLE);
    } else {
      map.setBounds(bounds);
    }
  }, [map, markers, onMarkerClick]);

  /**
   * Repaints only the pin that gained the selection and the one that lost it.
   *
   * Not folded into the marker effect's dependencies: that effect destroys and
   * recreates every overlay, so a tap would rebuild all pins and its trailing
   * setBounds would move the camera off what the user was looking at.
   *
   * The class is toggled on the existing element rather than calling
   * `setContent()` with fresh markup, because the click listener is bound to
   * that node — replacing it would drop the listener and leave a dead pin.
   */
  useEffect(() => {
    if (!map) return;
    if (!window.kakao?.maps) return;

    const selected = selectedPlaceId ?? null;
    const previous = paintedSelection.current;
    if (previous === selected) return;

    /** True when the pin existed and was redrawn. */
    const repaint = (placeId: number | null, isSelected: boolean): boolean => {
      if (placeId === null) return false;
      const overlay = bySelectableId.current.get(placeId);
      const item = findMarker(placeId);
      if (!overlay || !item) return false;
      const content = overlay.getContent();
      if (typeof content !== "string") {
        content.classList.toggle("jk-marker--selected", isSelected);
      }
      overlay.setZIndex(markerZIndex(item.lat, isSelected));
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
    if (!window.kakao?.maps) return;
    const targets = focusRequest.placeIds
      .map(findMarker)
      .filter((item): item is MapMarker => item !== undefined);
    if (targets.length === 0) return;

    // Several places at once: frame them instead of zooming in on one. Panning
    // to the first and zooming to street level would hide the rest, which is
    // the opposite of what asking for the set means.
    if (targets.length > 1) {
      const bounds = new window.kakao.maps.LatLngBounds();
      for (const item of targets) {
        bounds.extend(new window.kakao.maps.LatLng(item.lat, item.lng));
      }
      // Padded so a marker on the boundary is not cut in half by the viewport
      // edge, which bare setBounds does.
      map.setBounds(bounds, 48, 48, 48, 48);
      // Kakao inverts zoom into a level, and setBounds will happily drive it
      // past LEVEL_FOCUS: two stops in one building produce a bounds a few
      // metres across, which lands at the minimum level looking at a rooftop.
      // Clamped outward only — a set spread across the city keeps its own,
      // larger level.
      if (map.getLevel() < LEVEL_FOCUS) {
        map.setLevel(LEVEL_FOCUS, { animate: false });
      }
      return;
    }

    const target = targets[0];
    const position = new window.kakao.maps.LatLng(target.lat, target.lng);

    // Zoom first so panTo covers a short distance, and zoom without animating:
    // an animated setLevel is still moving when panTo computes its trajectory,
    // which lands the map at the wrong center.
    if (map.getLevel() > LEVEL_FOCUS) {
      map.setLevel(LEVEL_FOCUS, { animate: false });
    }
    map.panTo(position);
  }, [map, findMarker, focusRequest]);

  if (error) {
    return (
      <MapLoadError title="카카오맵을 불러오지 못했습니다." detail={error} />
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}
