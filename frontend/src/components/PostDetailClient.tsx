"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, MapPin, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { MapProvider, SavedPlaceDTO, SavedPostDTO } from "@/lib/types";
import { AuthorLink } from "@/components/AuthorLink";
import { PostThumbnail } from "@/components/PostThumbnail";
import { SettingsHeader } from "@/components/SettingsHeader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { hrefForApp, mapAppsFor } from "@/lib/map/externalLinks";
import { formatCategory } from "@/lib/place-category";
import { platformLabel } from "@/lib/platform-labels";
import { useBackLink } from "@/lib/use-back-link";

/**
 * One saved post in full: its picture, its caption, and the places it named.
 *
 * Two white blocks on a grey page, the same grammar /settings uses — the gap
 * between them *is* the separator, so it has to read as a band rather than as
 * a hairline. Before it, 매장 정보 began four pixels under the caption and the
 * two ran together as one column.
 *
 * The post block is laid out the way the source platform lays it out: the
 * author in a row above the picture, then the picture unobstructed, then the
 * caption. Nothing is drawn on top of the photograph any more — the overlay
 * that carried the handle covered the top-left of every thumbnail, which on a
 * food photo is usually part of the dish, and the source link has moved out of
 * the picture's corner to the right end of that same author row.
 *
 * The platform's name is no longer a line of its own under the picture. It was
 * already said twice on the same screen — by the source link's label and by
 * the author's avatar — and a bare "인스타그램" between the picture and the
 * caption read as a heading for the caption.
 *
 * The places are a plain vertical list, one card per row. A horizontal
 * scroller lived here first to save height, but it cost more than it saved:
 * every card was clipped to 78% of the viewport so its address wrapped to
 * three lines, and the only thing telling the user more places existed was
 * the sliver of the next card. A post's places are a *list* — a date course
 * is read top to bottom — so the page scrolls in one axis and every card gets
 * the full width its address needs.
 */
export default function PostDetailClient({
  post,
  caption,
  mapProvider,
}: {
  post: SavedPostDTO;
  caption: string | null;
  mapProvider: MapProvider;
}) {
  const router = useRouter();
  const places = post.places;

  /**
   * Back to the grid. Popping rather than pushing is what makes the second
   * back press leave /links instead of returning here — see useBackLink.
   */
  const { onBackClick: goBack } = useBackLink();

  /**
   * Removing this post destroys the page we are on, so it returns to the grid
   * rather than leaving a 404 behind. `replace`, not `push`: the gone post's
   * URL must not stay in the history for the back button to return to.
   *
   * `refresh()` afterwards invalidates the home map's cached pins, the same
   * reason /links calls it — the map is server-rendered and would keep showing
   * the places of a post that is no longer listed.
   */
  async function handleRemove() {
    const res = await fetch(`/api/posts/${post.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      toast.error(body?.error ?? "삭제하지 못했습니다.");
      return;
    }
    router.replace("/links");
    router.refresh();
  }

  /** The map lives on the home page, so focusing a place is a navigation. */
  function focusOnMap(placeIds: string[]) {
    if (placeIds.length === 0) return;
    router.push(`/?place=${placeIds.map(encodeURIComponent).join(",")}`);
  }

  return (
    // The grey is the page, exactly as on /settings: the sections are white
    // and the gap between them lets the page through, which is what makes
    // 게시글 and 매장 정보 read as two blocks rather than one long column.
    // `min-h-screen` so the band below the last card reaches the bottom.
    <div className="flex min-h-screen w-full flex-col bg-neutral-50 pb-8">
      <div className="relative">
        <SettingsHeader
          href="/links"
          ariaLabel="링크 목록으로"
          title="링크"
          onBackClick={goBack}
        />
        {/* Absolutely placed rather than a fourth grid column: SettingsHeader's
            three columns are what centre the title, and adding one would shift
            it off centre on every other page that shares the header. */}
        <div className="absolute inset-y-0 right-1 flex items-center">
          <RemoveButton
            label={platformLabel(post.platform)}
            onRemove={handleRemove}
          />
        </div>
      </div>

      {/* One white block, edge to edge, the way a /settings RowGroup is. */}
      <article className="flex flex-col gap-3 border-b border-border/60 bg-background pb-4">
        {/* Above the picture, not over it: this is how the platforms
            themselves label a post — Instagram's own header is an avatar and a
            handle in a row of their own, and the photograph underneath is left
            unobstructed. The overlay that used to sit at eleven o'clock
            covered the top-left of every thumbnail, which on a food photo is
            usually part of the dish.

            The source link shares that row, pushed to the opposite edge. It
            belongs with the attribution — both answer "where did this come
            from" — and putting it here costs no vertical space at all, where
            a row of its own under the picture pushed the caption down by the
            height of a button on every post. `justify-between` rather than
            `ml-auto` so the link still sits at the right edge on a post whose
            author is missing. */}
        <div className="flex min-h-9 items-center justify-between gap-3 px-4 pt-3">
          {post.author ? (
            <AuthorLink author={post.author} />
          ) : (
            <span aria-hidden />
          )}
          <SourceLink post={post} />
        </div>

        {/* Square rather than the image's own ratio: the grid this opens from
            is square, so a detail view that reflowed to 4:5 would read as a
            different picture arriving. */}
        {post.thumbnail && (
          <PostThumbnail
            key={post.thumbnail}
            src={post.thumbnail}
            alt=""
            className="aspect-square w-full bg-muted object-cover"
            fallback={
              <div
                aria-hidden
                className="flex aspect-square w-full items-center justify-center bg-muted text-sm text-muted-foreground"
              >
                {platformLabel(post.platform)}
              </div>
            }
          />
        )}

        {caption && (
          <div className="px-4">
            <Caption text={caption} />
          </div>
        )}
      </article>

      {places.length > 0 && (
        <PlaceList
          places={places}
          post={post}
          mapProvider={mapProvider}
          onFocus={focusOnMap}
          className="mt-2.5"
        />
      )}
    </div>
  );
}

/**
 * The link back to the post on its own platform.
 *
 * `nativeButton={false}` because the render prop supplies an <a>: without it
 * Base UI keeps the native-button semantics and warns that they no longer
 * match the element, which is the same reason AppDrawer's settings link
 * passes it.
 */
function SourceLink({ post }: { post: SavedPostDTO }) {
  return (
    <Button
      nativeButton={false}
      render={
        <a href={post.sourceUrl} target="_blank" rel="noreferrer noopener" />
      }
      variant="outline"
      size="sm"
      className="w-fit"
    >
      <ExternalLink aria-hidden />
      {platformLabel(post.platform)}
    </Button>
  );
}

/**
 * The post's caption, collapsed to two lines until the reader asks for more.
 *
 * A caption here is frequently a whole date course — one stop per line, ten
 * lines and up — and left whole it pushed 매장 정보 entirely below the fold on
 * a phone. Two lines is enough to recognise the post; the rest is opt-in.
 *
 * `line-clamp-2` rather than a character count: clamping is done by the
 * browser on the laid-out text, so it is correct at every width and font size,
 * and truncating by length would cut mid-syllable on Korean.
 *
 * The toggle is rendered only when the text actually overflows, which cannot
 * be known before layout — hence the measurement against `scrollHeight`. It is
 * re-run on resize because rotating a phone changes how many lines the same
 * caption occupies, and a stale answer either hides a needed toggle or leaves
 * a "더보기" that expands nothing.
 */
function Caption({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Measured while collapsed, so this must not run against the expanded
    // element — `expanded` is deliberately not a dependency: once the reader
    // has opened it the answer is already known and cannot change back.
    function measure() {
      const node = ref.current;
      if (!node) return;
      setOverflows(node.scrollHeight > node.clientHeight + 1);
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  return (
    <div className="flex flex-col items-start gap-1">
      {/* `whitespace-pre-wrap` because a caption is written with its own
          line breaks — a date course is usually one stop per line, and
          collapsing them turns that list into a paragraph. */}
      <p
        ref={ref}
        className={`w-full whitespace-pre-wrap text-sm leading-relaxed text-foreground/90 ${
          expanded ? "" : "line-clamp-2"
        }`}
      >
        {text}
      </p>
      {/* Kept mounted once known to overflow so collapsing again is possible;
          without the flag it would render for every caption including the
          one-liners that have nothing to reveal. */}
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rounded-sm text-xs font-medium text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {expanded ? "접기" : "더보기"}
        </button>
      )}
    </div>
  );
}

/** The post's places, one card per row. */
function PlaceList({
  places,
  post,
  mapProvider,
  onFocus,
  className,
}: {
  places: SavedPlaceDTO[];
  post: SavedPostDTO;
  mapProvider: MapProvider;
  onFocus: (placeIds: string[]) => void;
  className?: string;
}) {
  return (
    <section
      className={`flex flex-col gap-2 border-y border-border/60 bg-background py-4 ${className ?? ""}`}
      aria-labelledby="places-heading"
    >
      <div className="flex items-center px-4">
        <h2 id="places-heading" className="text-sm font-medium">
          매장 정보
        </h2>
      </div>

      <ul className="flex flex-col gap-3 px-4">
        {places.map((place) => (
          <PlaceCard
            key={place.id}
            place={place}
            post={post}
            mapProvider={mapProvider}
            onFocus={() => onFocus([place.id])}
          />
        ))}
      </ul>
    </section>
  );
}

function PlaceCard({
  place,
  post,
  mapProvider,
  onFocus,
}: {
  place: SavedPlaceDTO;
  post: SavedPostDTO;
  mapProvider: MapProvider;
  onFocus: () => void;
}) {
  const category = formatCategory(place.category);
  // The user's own map choice leads; the rest sit beside it as plain links
  // rather than behind a menu, since a card has the width for all three.
  const apps = mapAppsFor(mapProvider);

  return (
    <li>
      <div className="flex h-full flex-col gap-2 rounded-xl border border-border bg-card p-3">
        <button
          type="button"
          onClick={onFocus}
          // The visible text is a place name, so the action has to live in the
          // accessible name or every card reads identically to its neighbours.
          aria-label={`${place.name} 지도에서 보기`}
          className="rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span className="block text-sm font-medium">{place.name}</span>
          {/* The category is the one field this screen adds over the grid, so
              it sits directly under the name where a subtitle is read. */}
          {category && (
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {category}
            </span>
          )}
        </button>

        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <MapPin aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">{place.address}</span>
        </p>

        {place.memo && (
          <p className="text-xs text-muted-foreground italic">{place.memo}</p>
        )}

        {/* `mt-auto` pins the links to the bottom so cards of differing text
            length still line their actions up across the row. */}
        <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-1 text-xs">
          {apps.map((app) => (
            <a
              key={app.provider}
              href={hrefForApp(app, place, post)}
              target="_blank"
              rel="noreferrer noopener"
              className="text-muted-foreground underline decoration-dotted underline-offset-2"
            >
              {app.label}
            </a>
          ))}
        </div>
      </div>
    </li>
  );
}

/** The same confirmation gate the grid has; removing a link is not undoable. */
function RemoveButton({
  label,
  onRemove,
}: {
  /** The platform this post is from, so the icon button is not a bare "삭제". */
  label: string;
  onRemove: () => void;
}) {
  // Controlled for the reason LinksClient documents: AlertDialogAction is a
  // plain Button, not wrapped in the primitive's Close, so confirming would
  // run the action and leave the dialog standing.
  const [open, setOpen] = useState(false);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`${label} 삭제`}
            className="rounded-full text-muted-foreground hover:text-destructive"
          />
        }
      >
        <Trash2 aria-hidden />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>이 링크를 삭제할까요?</AlertDialogTitle>
          <AlertDialogDescription>
            삭제한 링크와 장소는 되돌릴 수 없습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          >
            삭제
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
