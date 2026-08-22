"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, ExternalLink, MapPin, X } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { hrefForApp, mapAppsFor } from "@/lib/map/externalLinks";
import type { MapProvider, Platform, SavedPlaceDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * A post that mentions this place, flattened to just what the sheet renders.
 * Full `SavedPostDTO`s would drag every *other* place of those posts in with
 * them, and this sheet is about one place.
 */
export type PlaceSource = {
  postId: string;
  sourceUrl: string;
  platform: Platform;
  title: string | null;
  thumbnail: string | null;
  author: string | null;
  /** The user's note on *this* place in *that* post. */
  memo: string | null;
};

/** What the map hands back when a pin is clicked. */
export type PlaceDetail = {
  place: SavedPlaceDTO;
  sources: PlaceSource[];
};

type Props = {
  detail: PlaceDetail;
  mapProvider: MapProvider;
  onClose: () => void;
};

/**
 * The place card that opens when a marker is tapped — the map's counterpart to
 * the cards on /links.
 *
 * A bottom sheet rather than an SDK infowindow: the three providers draw their
 * own bubbles with three different APIs and three different stylings, so a
 * shared surface is the only way one place reads the same on every map. It
 * also keeps the pin visible — an infowindow anchored to a marker near the
 * viewport edge covers the very thing it describes.
 *
 * Non-modal, and that is the point: the sheet must not take the map's pointer
 * events, because the user pans and taps other pins while it is open. Tapping
 * a second marker replaces the contents rather than stacking a second sheet.
 */
export default function PlaceSheet({ detail, mapProvider, onClose }: Props) {
  const { place, sources } = detail;
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  // No reset-on-place-change effect is needed: HomeClient keys this component
  // by place id, so switching pins remounts it and `copied` starts false. If
  // that key is ever dropped, a stale check would claim the *new* address had
  // been copied — the key is load-bearing, not a rendering nicety.

  const apps = useMemo(() => mapAppsFor(mapProvider), [mapProvider]);
  // Only a map-provider post carries an exact permalink, and only for its own
  // provider. Everything else searches by name.
  const exactSource = sources.find(
    (source) => source.platform === "NAVER" || source.platform === "KAKAO",
  );

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(place.address);
      setCopied(true);
      toast.success("주소를 복사했습니다.");
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // navigator.clipboard only exists in a secure context, and over plain
      // HTTP — how the app is reached by IP during phone testing — the write
      // rejects. Naming the address lets the user select it by hand.
      toast.error("복사할 수 없습니다. 주소를 길게 눌러 선택하세요.");
    }
  }

  return (
    <Sheet
      open
      // Non-modal so the map underneath stays pannable and its other pins stay
      // clickable while the sheet is up. A modal sheet would put an overlay
      // over the map and make every further marker click a dismiss.
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="bottom"
        // Anchored to the dynamic viewport, matching UrlSheet: on iOS the
        // layout viewport ignores the browser chrome, so the primitive's
        // bottom-0 lands underneath it. max-h keeps a long source list
        // scrollable instead of running off the top of the screen.
        //
        // z-20 sits above the map but below the floating controls (z-30), so
        // the + and menu buttons stay reachable with the sheet open — it is
        // non-modal precisely so the page keeps working.
        className="mx-auto z-20 max-h-[65dvh] w-full max-w-lg gap-0 overflow-y-auto rounded-t-2xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl data-[side=bottom]:inset-x-0 data-[side=bottom]:top-[100dvh] data-[side=bottom]:bottom-auto data-[side=bottom]:-translate-y-full data-[side=bottom]:data-ending-style:-translate-y-full data-[side=bottom]:data-starting-style:-translate-y-full sm:rounded-2xl sm:border sm:pb-5"
        showCloseButton={false}
        // The backdrop is what actually makes a sheet modal: `modal={false}`
        // on the Root leaves it rendered as `fixed inset-0`, so it goes on
        // swallowing every click aimed at the map — and at this sheet's own
        // 닫기 button, which it covers. Dropping it is what lets the user pan
        // the map and tap another pin with the card still up.
        showOverlay={false}
      >
        <SheetHeader className="flex-row items-start justify-between gap-3 p-0 pb-3">
          <div className="flex min-w-0 flex-col gap-1">
            <SheetTitle className="text-lg leading-snug">
              {place.name}
            </SheetTitle>
            {/* Category is the only classifier the geocoder gives us, and it
                is often empty — rendered only when it says something. */}
            {place.category && (
              <SheetDescription className="text-xs">
                {place.category}
              </SheetDescription>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="닫기"
            className="shrink-0 rounded-full text-muted-foreground"
          >
            <X aria-hidden />
          </Button>
        </SheetHeader>

        <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <MapPin aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{place.address}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={copyAddress}
            aria-label="주소 복사"
            className="-mt-1 -mr-1 shrink-0 rounded-full text-muted-foreground"
          >
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          </Button>
        </div>

        {/* 지도앱에서 열기: 네이버맵 · 카카오맵 · 구글맵을 전부 나열한다.
            Scrolls on a narrow phone rather than wrapping into a second line
            that pushes the source list below the fold. */}
        <div className="-mx-5 mt-3 flex gap-2 overflow-x-auto scrollbar-none px-5">
          {apps.map((app) => (
            <a
              key={app.provider}
              href={hrefForApp(app, place, exactSource)}
              target="_blank"
              rel="noreferrer noopener"
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

        {/* What this app knows that a map app does not: which of the user's
            own saved posts put this pin here. That is the whole reason the
            place is on their map, so it is the body of the sheet. */}
        <section className="mt-5">
          <ul className="grid grid-cols-3 gap-2">
            {sources.map((source) => (
              <li key={source.postId}>
                <a
                  href={source.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block aspect-square overflow-hidden rounded-xl bg-muted transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {source.thumbnail ? (
                    // Plain img for the same reason as the /links cards: these
                    // are Instagram and YouTube CDN URLs, and routing a
                    // thumbnail through the optimizer buys nothing while
                    // costing a remotePatterns entry per host.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={source.thumbnail}
                      alt={source.title ?? source.sourceUrl}
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover"
                    />
                  ) : null}
                </a>
              </li>
            ))}
          </ul>
        </section>
      </SheetContent>
    </Sheet>
  );
}
