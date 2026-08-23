import { ExternalLink } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { hrefForApp, mapAppsFor } from "@/lib/map/externalLinks";
import type { MapProvider, Platform, SavedPlaceDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The pill-shaped 네이버맵 · 카카오맵 · 구글맵 row, shared between PlaceSheet
 * (the map pin's bottom sheet) and PostDetailClient (a post's 매장 정보 card).
 *
 * Both call sites used to hand-roll this row with slightly different markup —
 * PlaceSheet as outline buttons, PostDetailClient as underlined text links —
 * so the same three destinations read as two different affordances depending
 * on which screen showed them. This is the PlaceSheet shape; PostDetailClient
 * switched to it rather than the reverse because a tappable button reads more
 * clearly as "open an app" than underlined text does.
 */
type ExactSource = { platform: Platform; sourceUrl: string };

export function MapAppLinks({
  place,
  post,
  exactSourceFor,
  mapProvider,
  className,
}: {
  place: SavedPlaceDTO;
  /** A single post's permalink — pass this from a post-scoped card. */
  post?: ExactSource;
  /**
   * A place-scoped sheet can have one source per platform (NAVER *and*
   * KAKAO), so it looks up the exact permalink per app rather than sharing
   * one `post`. Mutually exclusive with `post`.
   */
  exactSourceFor?: (provider: MapProvider) => ExactSource | undefined;
  mapProvider: MapProvider;
  className?: string;
}) {
  // The user's own map choice leads; the rest sit beside it as plain links
  // rather than behind a menu, since a card has the width for all three.
  const apps = mapAppsFor(mapProvider);

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {apps.map((app) => (
        <a
          key={app.provider}
          href={hrefForApp(app, place, post ?? exactSourceFor?.(app.provider))}
          // No `target="_blank"`: in the iOS Home Screen app this opens an
          // in-app browser sheet over us rather than a tab, which both
          // buries the Universal Link hand-off to the map app and leaves a
          // sheet to dismiss. `noopener` is omitted for the same reason — it
          // governs a new browsing context that no longer exists here.
          rel="noreferrer"
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "shrink-0 rounded-full",
          )}
        >
          <ExternalLink aria-hidden />
          {app.label}
        </a>
      ))}
    </div>
  );
}
