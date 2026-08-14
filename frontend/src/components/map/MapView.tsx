"use client";

import NaverMap from "./NaverMap";
import KakaoMap from "./KakaoMap";
import GoogleMap from "./GoogleMap";
import type { MapViewProps } from "@/lib/map/types";

/**
 * Each provider gets its own component instance keyed by provider, so
 * switching tears the previous map down instead of trying to reuse its
 * container element with a different SDK.
 */
export default function MapView({
  provider,
  markers,
  onMarkerClick,
}: MapViewProps) {
  switch (provider) {
    case "KAKAO":
      return <KakaoMap key="kakao" markers={markers} onMarkerClick={onMarkerClick} />;
    case "GOOGLE":
      return <GoogleMap key="google" markers={markers} onMarkerClick={onMarkerClick} />;
    case "NAVER":
    default:
      return <NaverMap key="naver" markers={markers} onMarkerClick={onMarkerClick} />;
  }
}
