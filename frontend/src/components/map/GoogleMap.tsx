"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/map/loader";
import { DEFAULT_CENTER, DEFAULT_ZOOM, type MapMarker } from "@/lib/map/types";

type Props = {
  markers: MapMarker[];
  onMarkerClick?: (id: string) => void;
};

export default function GoogleMap({ markers, onMarkerClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef<google.maps.Marker[]>([]);
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

    if (markers.length === 1) {
      map.setCenter({ lat: markers[0].lat, lng: markers[0].lng });
      map.setZoom(15);
    } else {
      map.fitBounds(bounds, 48);
    }
  }, [map, markers, onMarkerClick]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-100 p-6 text-center text-sm text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
        구글 지도를 불러오지 못했습니다. {error}
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}
