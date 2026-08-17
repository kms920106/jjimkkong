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

type Props = {
  markers: MapMarker[];
  onMarkerClick?: (id: string) => void;
  focusRequest?: FocusRequest | null;
};

/**
 * Kakao's zoom is an inverted "level" (smaller = closer), so the shared zoom
 * constants are translated rather than passed through.
 */
const LEVEL_OVERVIEW = 9;
const LEVEL_SINGLE = 4;
/** Kakao's counterpart to the shared FOCUS_ZOOM. */
const LEVEL_FOCUS = 3;

type TrackedMarker = {
  marker: kakao.maps.Marker;
  handler?: () => void;
};

export default function KakaoMap({
  markers,
  onMarkerClick,
  focusRequest,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef<TrackedMarker[]>([]);
  const findMarker = useMarkerLookup(markers);
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
      for (const { marker, handler } of markerRefs.current) {
        if (handler) {
          window.kakao?.maps?.event.removeListener(marker, "click", handler);
        }
        marker.setMap(null);
      }
      markerRefs.current = [];
      // Kakao exposes no destroy(); emptying the container is what releases
      // the SDK's hold on the DOM node it rendered into.
      if (container) container.innerHTML = "";
      setMap(null);
    };
  }, []);

  useEffect(() => {
    if (!map) return;

    for (const { marker, handler } of markerRefs.current) {
      if (handler) {
        window.kakao.maps.event.removeListener(marker, "click", handler);
      }
      marker.setMap(null);
    }
    markerRefs.current = [];

    if (markers.length === 0) return;

    const bounds = new window.kakao.maps.LatLngBounds();

    for (const item of markers) {
      const position = new window.kakao.maps.LatLng(item.lat, item.lng);
      const marker = new window.kakao.maps.Marker({
        position,
        title: item.name,
      });
      marker.setMap(map);

      let handler: (() => void) | undefined;
      if (onMarkerClick) {
        handler = () => onMarkerClick(item.id);
        window.kakao.maps.event.addListener(marker, "click", handler);
      }
      markerRefs.current.push({ marker, handler });
      bounds.extend(position);
    }

    if (markers.length === 1) {
      map.setCenter(
        new window.kakao.maps.LatLng(markers[0].lat, markers[0].lng),
      );
      map.setLevel(LEVEL_SINGLE);
    } else {
      map.setBounds(bounds);
    }
  }, [map, markers, onMarkerClick]);

  // Panning lives apart from the marker effect so focusing a place does not
  // tear down and rebuild every pin.
  useEffect(() => {
    if (!map || !focusRequest) return;
    const target = findMarker(focusRequest.placeId);
    if (!target) return;

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
