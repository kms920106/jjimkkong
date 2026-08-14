import type { MapProvider } from "@/generated/prisma/enums";

export type MapMarker = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

export type MapViewProps = {
  provider: MapProvider;
  markers: MapMarker[];
  onMarkerClick?: (id: string) => void;
};

/** Seoul city hall — the fallback center when nothing is saved yet. */
export const DEFAULT_CENTER = { lat: 37.5666, lng: 126.9784 };
export const DEFAULT_ZOOM = 12;
