"use client";

import { useEffect, useRef, useState } from "react";
import { loadKakaoMaps } from "@/lib/map/loader";
import { DEFAULT_CENTER, type MapMarker } from "@/lib/map/types";

type Props = {
  markers: MapMarker[];
  onMarkerClick?: (id: string) => void;
};

/**
 * Kakao's zoom is an inverted "level" (smaller = closer), so the shared zoom
 * constants are translated rather than passed through.
 */
const LEVEL_OVERVIEW = 9;
const LEVEL_SINGLE = 4;

type TrackedMarker = {
  marker: kakao.maps.Marker;
  handler?: () => void;
};

export default function KakaoMap({ markers, onMarkerClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef<TrackedMarker[]>([]);
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

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-100 p-6 text-center text-sm text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
        카카오맵을 불러오지 못했습니다. {error}
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}
