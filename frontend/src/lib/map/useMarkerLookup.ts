"use client";

import { useCallback, useEffect, useRef } from "react";
import type { MapMarker } from "./types";

/**
 * Gives the pan effects a stable way to look a marker up by id.
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
  return useCallback(
    (id: string) => markersRef.current.find((item) => item.id === id),
    [],
  );
}
