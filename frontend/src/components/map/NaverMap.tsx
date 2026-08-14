"use client";

import { useEffect, useRef, useState } from "react";
import { loadNaverMaps } from "@/lib/map/loader";
import { DEFAULT_CENTER, DEFAULT_ZOOM, type MapMarker } from "@/lib/map/types";

type Props = {
  markers: MapMarker[];
  onMarkerClick?: (id: string) => void;
};

export default function NaverMap({ markers, onMarkerClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef<naver.maps.Marker[]>([]);
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
        window.naver?.maps?.Event.clearInstanceListeners(marker);
        marker.setMap(null);
      }
      markerRefs.current = [];
      // `created` covers the case where the map was built after unmount began.
      created?.destroy();
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

    if (markers.length === 1) {
      map.setCenter(first);
      map.setZoom(15);
    } else {
      map.fitBounds(bounds);
    }
  }, [map, markers, onMarkerClick]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-100 p-6 text-center text-sm text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
        네이버 지도를 불러오지 못했습니다. {error}
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}
