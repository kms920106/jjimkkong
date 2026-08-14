import type { MapProvider } from "@/generated/prisma/enums";

export type MapMarker = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

/**
 * A request to move the camera. The nonce makes each click a distinct event:
 * focusing the same place twice must re-center it, which a bare id could not
 * express because React bails out when state is unchanged.
 */
export type FocusRequest = {
  placeId: string;
  nonce: number;
};

export type MapViewProps = {
  provider: MapProvider;
  markers: MapMarker[];
  onMarkerClick?: (id: string) => void;
  /**
   * Kept separate from `markers` so focusing moves the camera without
   * rebuilding every pin.
   */
  focusRequest?: FocusRequest | null;
};

/** Seoul city hall — the fallback center when nothing is saved yet. */
export const DEFAULT_CENTER = { lat: 37.5666, lng: 126.9784 };
export const DEFAULT_ZOOM = 12;
/**
 * Close enough to read the street a focused place sits on. Kakao inverts zoom
 * into a "level", so it keeps its own `LEVEL_FOCUS` — change both together.
 */
export const FOCUS_ZOOM = 16;
