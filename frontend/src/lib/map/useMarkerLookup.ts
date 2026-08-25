"use client";

import { useCallback, useEffect, useRef } from "react";
import type { MapMarker } from "./types";

/**
 * Gives the pan effects a stable way to look a marker up by its Place id.
 *
 * The marker array is held in a ref rather than read as an effect dependency
 * on purpose: it gets a new identity whenever the saved-post list changes, and
 * depending on it would drag the camera back to the last-focused place every
 * time an unrelated post is saved — fighting the marker effect's fitBounds.
 */
export function useMarkerLookup(markers: MapMarker[]) {
  const markersRef = useRef(markers);

  useEffect(() => {
    markersRef.current = markers;
  }, [markers]);

  // Stable across renders, so the pan effects can depend on it and still only
  // run when a new focus request arrives.
  //
  // Matches on `placeId`, not `key`: a focus request names saved places, and an
  // optimistic pin has no id to be asked for. The strict compare is why
  // FocusRequest.placeIds must hold numbers — a string "12" read straight out
  // of `?place=` would match nothing here, and the callers treat "not found" as
  // "nothing to do", so the camera would silently never move.
  return useCallback(
    (placeId: number) =>
      markersRef.current.find((item) => item.placeId === placeId),
    [],
  );
}
