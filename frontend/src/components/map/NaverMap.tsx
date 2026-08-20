"use client";

import { useEffect, useRef, useState } from "react";
import MapLoadError from "./MapLoadError";
import { loadNaverMaps } from "@/lib/map/loader";
import { useMarkerLookup } from "@/lib/map/useMarkerLookup";
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  FOCUS_ZOOM,
  type FocusRequest,
  type MapMarker,
} from "@/lib/map/types";

type Props = {
  markers: MapMarker[];
  onMarkerClick?: (id: string) => void;
  focusRequest?: FocusRequest | null;
};

export default function NaverMap({
  markers,
  onMarkerClick,
  focusRequest,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef<naver.maps.Marker[]>([]);
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

    for (const marker of markerRefs.current) {
      window.naver.maps.Event.clearInstanceListeners(marker);
      marker.setMap(null);
    }
    markerRefs.current = [];

    if (markers.length === 0) return;

    const first = new window.naver.maps.LatLng(markers[0].lat, markers[0].lng);
    const bounds = new window.naver.maps.LatLngBounds(first, first);

    for (const item of markers) {
      const position = new window.naver.maps.LatLng(item.lat, item.lng);
      const marker = new window.naver.maps.Marker({
        position,
        map,
        title: item.name,
      });
      if (onMarkerClick) {
        window.naver.maps.Event.addListener(marker, "click", () =>
          onMarkerClick(item.id),
        );
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
      map.setCenter(first);
      map.setZoom(15);
    } else {
      map.fitBounds(bounds);
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
      const bounds = new window.naver.maps.LatLngBounds(
        new window.naver.maps.LatLng(targets[0].lat, targets[0].lng),
        new window.naver.maps.LatLng(targets[0].lat, targets[0].lng),
      );
      for (const item of targets) {
        bounds.extend(new window.naver.maps.LatLng(item.lat, item.lng));
      }
      map.fitBounds(bounds);
      return;
    }

    const target = targets[0];
    const position = new window.naver.maps.LatLng(target.lat, target.lng);

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
