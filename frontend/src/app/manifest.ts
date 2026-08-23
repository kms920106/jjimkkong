import type { MetadataRoute } from "next";

/**
 * The Home Screen app. This is not decoration: the service is used on iOS by
 * way of "홈 화면에 추가", and that mode changes how links behave — see the
 * standalone notes in the root AGENTS.md and `lib/map/openMapApp.ts`.
 *
 * No service worker and no offline story: `display: standalone` needs neither,
 * and nothing here works without the network anyway.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "찜꽁",
    short_name: "찜꽁",
    description: "인스타그램·유튜브 링크를 붙여넣으면 장소를 지도에 저장합니다.",
    start_url: "/",
    display: "standalone",
    lang: "ko",
    // Matches the light theme's --background/--foreground so the launch screen
    // does not flash a colour the app never shows.
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
