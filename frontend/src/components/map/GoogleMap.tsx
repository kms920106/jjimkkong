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

type Props = {
  markers: MapMarker[];
  onMarkerClick?: (id: string) => void;
  focusRequest?: FocusRequest | null;
};

export default function GoogleMap({
  markers,
  onMarkerClick,
  focusRequest,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef<google.maps.Marker[]>([]);
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
        marker.setMap(null);
      }
      markerRefs.current = [];
      // Google has no destroy(); clearing its listeners and emptying the
      // container is what lets the instance be collected.
      if (created) window.google?.maps?.event.clearInstanceListeners(created);
      if (container) container.innerHTML = "";
      setMap(null);
    };
  }, []);

  useEffect(() => {
    if (!map) return;

    for (const marker of markerRefs.current) {
      window.google.maps.event.clearInstanceListeners(marker);
      marker.setMap(null);
    }
    markerRefs.current = [];

    if (markers.length === 0) return;

    const bounds = new window.google.maps.LatLngBounds();

    for (const item of markers) {
      const position = { lat: item.lat, lng: item.lng };
      const marker = new window.google.maps.Marker({
        position,
        map,
        title: item.name,
      });
      if (onMarkerClick) {
        marker.addListener("click", () => onMarkerClick(item.id));
      }
      markerRefs.current.push(marker);
      bounds.extend(position);
    }

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

  // Panning lives apart from the marker effect so focusing a place does not
  // tear down and rebuild every pin.
  useEffect(() => {
    if (!map || !focusRequest) return;
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
