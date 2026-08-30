"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Copy, MapPin, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { MapAppLinks } from "@/components/map/MapAppLinks";
import { PostThumbnail } from "@/components/PostThumbnail";
import type { MapProvider, PlaceSourceDTO, SavedPlaceDTO } from "@/lib/types";

/**
 * A post that mentions this place, flattened to just what the sheet renders.
 * Full `SavedPostDTO`s would drag every *other* place of those posts in with
 * them, and this sheet is about one place.
 *
 * The same shape GET /api/places/[id]/sources returns, deliberately: this sheet
 * merges the member's own sources with every other member's for the same pin, so
 * a local shape that carried more than the shared route can supply would be a
 * type that no merged list could satisfy.
 *
 * That is what removed `memo` from it. A note belongs to one member's bookmark,
 * and the communal half of this list is not scoped to one member — there is no
 * single note to show for a post someone else saved. The sheet never rendered it
 * anyway.
 */
export type PlaceSource = PlaceSourceDTO;

/**
 * Naver's "YYYYMMDD" rendered as "2026.08.30".
 *
 * String slicing rather than `new Date()`: the value is already the date the
 * post was written, in KST, and parsing it would reinterpret it in the
 * viewer's timezone — enough to show the previous day west of Korea. Anything
 * not eight digits is passed through unchanged, since a display string is
 * never worth throwing over.
 */
function formatPostDate(postdate: string): string {
  if (!/^\d{8}$/.test(postdate)) return postdate;
  return `${postdate.slice(0, 4)}.${postdate.slice(4, 6)}.${postdate.slice(6, 8)}`;
}

/** What the map hands back when a pin is clicked. */
export type PlaceDetail = {
  place: SavedPlaceDTO;
  sources: PlaceSource[];
};

type Props = {
  /**
   * Null closes the sheet. Base UI only animates a `false → true` transition
   * on `open`, and this component's `<Sheet>` root must therefore stay
   * mounted across opens — a parent that conditionally mounts it (`{detail &&
   * <PlaceSheet .../>}`) makes every "open" a fresh mount with `open` already
   * `true`, so there is no transition to animate and the sheet just appears.
   * Passing `detail` through unconditionally, letting this component own the
   * mount, is what makes the slide-up real.
   */
  detail: PlaceDetail | null;
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
  // Held across `detail` going null so the closing animation has something
  // to render while it plays — the parent clears `detail` the instant the
  // close is requested, before the sheet has slid back down.
  const [shown, setShown] = useState(detail);
  if (detail && detail !== shown) setShown(detail);

  // True only for the moment between this sheet opening and the browser
  // finishing the click that opened it — see onOpenChange below. Set in an
  // effect (not during render) because it is exactly a "sync with the
  // outside world" job, and lint forbids writing refs while rendering.
  const justOpenedRef = useRef(false);
  useEffect(() => {
    if (!detail) return;
    justOpenedRef.current = true;
    // A click's own dispatch completes within the same task, so clearing on
    // the next macrotask covers it without outliving any real interaction.
    const timer = window.setTimeout(() => {
      justOpenedRef.current = false;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [detail]);

  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  // Resets `copied` and the scroll position when the pin switches while the
  // sheet stays up. The component itself must not remount on that switch —
  // remounting would drop `open` back to a fresh `true` and skip the
  // close/open transition Base UI can only animate across an actual
  // `false → true` change.
  //
  // `copied` is reset during render (derived-state adjustment, not an
  // effect — lint's `react-hooks/set-state-in-effect` forbids the latter)
  // so it never paints stale for even one frame. The scroll offset still
  // needs a layout effect: it is DOM state Base UI's re-render does not
  // touch on its own.
  const contentRef = useRef<HTMLDivElement>(null);
  const shownId = shown?.place.id ?? null;
  const previousShownIdRef = useRef(shownId);
  if (previousShownIdRef.current !== shownId) {
    previousShownIdRef.current = shownId;
    if (copied) setCopied(false);
  }
  useLayoutEffect(() => {
    contentRef.current?.scrollTo(0, 0);
    // Fires only when the pin actually changes, not on every `shown` update
    // (which also happens for reasons that should not reset scroll, like a
    // communal-sources refresh landing on the same place) — `shownId` is
    // the only dependency.
  }, [shownId]);

  // `shown` is null only before the very first pin is ever clicked — after
  // that, closing keeps the last place around (above) so the sheet has
  // content to slide down with. The `<Sheet>` below still renders in this
  // state, at `open={false}`, rather than this component returning null:
  // returning null would unmount the whole subtree on first close, and the
  // first *re*-open after that would hit the same "already open" mount this
  // component exists to avoid.
  const place = shown?.place ?? null;
  const sources = shown?.sources ?? [];
  const blogs = shown?.place.blogs ?? [];

  // Only a map-provider post carries an exact permalink, and only for its own
  // provider. Everything else searches by name.
  //
  // Matched per app rather than once for the sheet: this is a *place* view, so
  // `sources` holds every post that mentions the pin and can carry both a NAVER
  // and a KAKAO one. Picking the first of either meant whichever sorted first
  // won and the other provider's button silently lost its permalink.
  const exactSourceFor = (provider: MapProvider) =>
    sources.find((source) => source.platform === provider);

  async function copyAddress() {
    if (!place) return;
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
      // `detail !== null` rather than a bare `open`: this component now stays
      // mounted whether or not a pin is selected (see the `detail` prop doc),
      // so Base UI needs the real `false → true` / `true → false` edge to
      // have anything to animate.
      open={detail !== null}
      // Non-modal so the map underneath stays pannable and its other pins stay
      // clickable while the sheet is up. A modal sheet would put an overlay
      // over the map and make every further marker click a dismiss.
      modal={false}
      onOpenChange={(open, eventDetails) => {
        // Kakao fires its marker click on `mouseup`, so this sheet opens
        // *before* the browser's `click` event finishes. Base UI then sees
        // that trailing click — which landed on the map, not on the sheet —
        // as an outside press and dismisses the sheet it just opened.
        // 네이버/구글 fire their marker click on `click` itself, so the press
        // is over by the time the sheet exists and they never reach this.
        //
        // Only the press belonging to the opening click is ignored: it is
        // the one that arrives before the browser has finished dispatching
        // that click, which no later tap on the map can do. Dismissing by
        // tapping the map keeps working.
        if (!open) {
          if (
            eventDetails?.reason === "outside-press" &&
            justOpenedRef.current
          ) {
            return;
          }
          onClose();
        }
      }}
    >
      <SheetContent
        ref={contentRef}
        side="bottom"
        // Anchored to the dynamic viewport, matching UrlSheet: on iOS the
        // layout viewport ignores the browser chrome, so the primitive's
        // bottom-0 lands underneath it. max-h keeps a long source list
        // scrollable instead of running off the top of the screen.
        //
        // z-20 sits above the map but below the floating controls (z-30), so
        // the + and menu buttons stay reachable with the sheet open — it is
        // non-modal precisely so the page keeps working.
        className="mx-auto z-20 max-h-[65dvh] w-full max-w-lg gap-0 overflow-y-auto rounded-t-2xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl data-[side=bottom]:inset-x-0 data-[side=bottom]:top-[100dvh] data-[side=bottom]:bottom-auto data-[side=bottom]:-translate-y-full data-[side=bottom]:data-ending-style:translate-y-0 data-[side=bottom]:data-starting-style:translate-y-0 sm:rounded-2xl sm:border sm:pb-5"
        showCloseButton={false}
        // The backdrop is what actually makes a sheet modal: `modal={false}`
        // on the Root leaves it rendered as `fixed inset-0`, so it goes on
        // swallowing every click aimed at the map — and at this sheet's own
        // 닫기 button, which it covers. Dropping it is what lets the user pan
        // the map and tap another pin with the card still up.
        showOverlay={false}
      >
        {/* `place` is only null before the first pin click, while `open` is
            still `false` (see the prop doc above) — nothing here is ever
            visible in that state, but it still has to render without
            throwing. */}
        {place && (
          <>
            <SheetHeader className="flex-row items-start justify-between gap-3 p-0 pb-3">
              <div className="flex min-w-0 flex-col gap-1">
                <SheetTitle className="text-lg leading-snug">
                  {place.name}
                </SheetTitle>
                {/* Category is the only classifier the geocoder gives us, and
                    it is often empty — rendered only when it says something. */}
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
                Scrolls on a narrow phone rather than wrapping into a second
                line that pushes the source list below the fold. */}
            <MapAppLinks
              place={place}
              exactSourceFor={exactSourceFor}
              mapProvider={mapProvider}
              className="-mx-5 mt-3 flex-nowrap overflow-x-auto scrollbar-none px-5"
            />
          </>
        )}

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
                  {/* No fallback node: the anchor already carries bg-muted,
                      so a thumbnail that cannot load leaves an empty tile.
                      What matters is that it leaves *that* rather than a
                      broken-image icon captioned with the raw source URL,
                      which is what the alt text below renders as. */}
                  {/* Keyed on the URL because the <li> is keyed on postId and
                      keeps its mount across a re-fetch — a post whose
                      thumbnail changed would otherwise stay in the failed
                      state from its previous URL. */}
                  <PostThumbnail
                    key={source.thumbnail}
                    src={source.thumbnail}
                    alt={source.title ?? source.sourceUrl}
                    className="size-full object-cover"
                  />
                </a>
              </li>
            ))}
          </ul>
        </section>

        {/* Naver blog reviews of this place, and the one thing here the user
            could not have got from the map app they would otherwise open.
            Below the sources rather than above: those are the reason this pin
            exists on their map at all, so they stay the body of the sheet.

            Read off `blogs` (derived from `shown`) rather than from `place`,
            for the same reason `sources` is — `place` is null until the first
            pin is ever clicked, and defaulting to an empty list keeps this out
            of the guard above without a second null check.

            Rendered only when non-empty: a heading over nothing reads as a
            failure, and an unknown venue legitimately has no reviews. */}
        {blogs.length > 0 && (
          <section className="mt-5">
            <h2 className="mb-2 text-sm font-medium">블로그 리뷰</h2>
            <ul className="flex flex-col gap-2">
              {blogs.map((blog) => (
                <li key={blog.link}>
                  <a
                    href={blog.link}
                    // Matches the sources grid above, not MapAppLinks. That
                    // component drops `_blank` so iOS can hand a Universal Link
                    // to a native map app; a blog post has no such hand-off to
                    // protect, and opening it in place would lose the sheet.
                    target="_blank"
                    rel="noreferrer noopener"
                    className="block rounded-xl border border-border bg-card p-3 transition hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <p className="line-clamp-2 text-sm font-medium">
                      {blog.title}
                    </p>
                    {blog.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {blog.description}
                      </p>
                    )}
                    <p className="mt-1.5 truncate text-xs text-muted-foreground">
                      {blog.bloggername} · {formatPostDate(blog.postdate)}
                    </p>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </SheetContent>
    </Sheet>
  );
}
