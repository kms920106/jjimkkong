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
  focusRequest,
}: MapViewProps) {
  const shared = { markers, onMarkerClick, focusRequest };

  switch (provider) {
    case "KAKAO":
      return <KakaoMap key="kakao" {...shared} />;
    case "GOOGLE":
      return <GoogleMap key="google" {...shared} />;
    case "NAVER":
    default:
      return <NaverMap key="naver" {...shared} />;
  }
}
