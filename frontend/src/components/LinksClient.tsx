"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  Copy,
  MapPin,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type {
  MapProvider,
  Platform,
  SavedPlaceDTO,
  SavedPostDTO,
} from "@/lib/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import LoginDrawer from "@/components/LoginDrawer";
import { hrefForApp, mapAppsFor } from "@/lib/map/externalLinks";
import { cn } from "@/lib/utils";

/**
 * "전체" is not a Platform value, so the filter is widened rather than typed
 * as one — every other member has to stay in step with the enum.
 */
type Filter = "ALL" | Platform;

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "ALL", label: "전체" },
  { value: "INSTAGRAM", label: "인스타그램" },
  { value: "YOUTUBE", label: "유튜브" },
  { value: "NAVER", label: "네이버맵" },
  { value: "KAKAO", label: "카카오맵" },
  { value: "OTHER", label: "기타" },
];

export default function LinksClient({
  initialPosts,
  mapProvider,
  signedIn,
}: {
  initialPosts: SavedPostDTO[];
  mapProvider: MapProvider;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [posts, setPosts] = useState(initialPosts);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [loginOpen, setLoginOpen] = useState(false);

  // Set once a delete has invalidated the home page's cached entry; see
  // canPopBack(). A ref rather than state because nothing rendered depends on
  // it and flipping it must not cost a re-render of the whole list.
  const didMutate = useRef(false);

  const counts = useMemo(() => {
    const byPlatform = new Map<Filter, number>([["ALL", posts.length]]);
    for (const post of posts) {
      byPlatform.set(post.platform, (byPlatform.get(post.platform) ?? 0) + 1);
    }
    return byPlatform;
  }, [posts]);

  // A tab the user cannot act on is noise, so a platform with nothing saved
  // under it is not offered — except 전체, which anchors the row even when
  // the list is empty.
  const tabs = FILTERS.filter(
    (tab) => tab.value === "ALL" || (counts.get(tab.value) ?? 0) > 0,
  );

  const visible =
    filter === "ALL" ? posts : posts.filter((post) => post.platform === filter);

  /**
   * True when this page was reached by a client-side navigation from inside
   * the app, i.e. there is an entry of ours behind it that back() can pop.
   * False on a cold entry — a refresh, a bookmark, or a link from outside.
   *
   * Determined from the Navigation API's own history when the browser has it
   * (Chromium), because `navigation.entries()` only ever contains entries from
   * this document's session and `currentEntry.index > 0` therefore means
   * exactly what we need. Elsewhere (Safari, Firefox as of writing) it falls
   * back to false and the button stays a plain link.
   *
   * Deliberately NOT `history.state.idx`: that is a Pages Router field. The App
   * Router only copies `__NA` and `__PRIVATE_NEXTJS_INTERNALS_TREE` onto its
   * entries, and `__NA` is stamped on the very first one too, so neither can
   * distinguish "came from the map" from "opened /links directly".
   *
   * Also not `history.length`: that counts the whole tab. A reused tab reports
   * a long history belonging to other sites, and back() would leave the app.
   *
   * Read at click time rather than held in state: nothing in the render output
   * depends on it — the button looks and reads the same either way — and the
   * answer can change while the page is open, since focusOnMap() pushes a new
   * entry. A value captured on mount would be stale by then.
   *
   * A delete disqualifies the page too. handleDelete() calls router.refresh(),
   * and refresh invalidates the bfcache (refresh-reducer.js: "During a refresh,
   * invalidate the BFCache, which may contain dynamic data") — correctly, since
   * the map must stop showing the pins of a post that no longer exists. But
   * that means back() would miss the cache and fetch anyway, and a traversal
   * does not render loading.tsx, so that path would lose both halves of this
   * fix and be the one most likely to feel dead. Falling back to href="/" makes
   * it a push, which loading.tsx does cover.
   */
  function canPopBack() {
    if (didMutate.current) return false;
    const index = window.navigation?.currentEntry?.index;
    return typeof index === "number" && index > 0;
  }

  /**
   * Back to the map. Stays an <a href="/"> so middle-click, ctrl-click, "open
   * in new tab" and keyboard activation all keep working; only a plain left
   * click on a page we can pop is turned into a history pop.
   *
   * The difference is not cosmetic. `/` is `force-dynamic`, so pushing it is a
   * fresh server round trip every time — getUser(), the savedPost join, then a
   * map SDK boot on arrival. Popping it restores the map the browser already
   * has. loading.tsx covers the push path; this removes the wait entirely for
   * the common case of someone who arrived here from the map.
   */
  function goBack(event: React.MouseEvent<HTMLAnchorElement>) {
    // Let the browser handle anything that isn't a plain left click: modified
    // clicks mean "somewhere else", not "back".
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    if (!canPopBack()) return; // nothing of ours behind: fall through to href="/"

    event.preventDefault();
    router.back();
  }

  /**
   * The map lives on the home page, so focusing places is a navigation.
   * Home reads ?place= and moves the camera there on mount.
   *
   * Comma-separated so one post's places can be framed together: a single id
   * zooms in to read the street, several back the camera off until all of them
   * fit. That distinction lives in the map components.
   */
  function focusOnMap(placeIds: string[]) {
    if (placeIds.length === 0) return;
    router.push(`/?place=${placeIds.map(encodeURIComponent).join(",")}`);
  }

  async function handleDelete(postId: string) {
    const res = await fetch(`/api/posts/${postId}`, { method: "DELETE" });
    if (res.ok) {
      setPosts((prev) => prev.filter((post) => post.id !== postId));
      // The home map reads its pins from a server render, so it would keep
      // showing the deleted post's places until the cache is invalidated.
      // This also drops the home entry from the bfcache, which is why the back
      // button stops popping from here on — see canPopBack().
      didMutate.current = true;
      router.refresh();
    } else {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(body?.error ?? "삭제하지 못했습니다.");
    }
  }

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-6">
      <header className="flex items-center gap-3">
        <Link
          href="/"
          aria-label="지도로 돌아가기"
          onClick={goBack}
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon" }),
            "rounded-full text-muted-foreground",
          )}
        >
          <ChevronLeft aria-hidden />
        </Link>
        <h1 className="text-base font-semibold">링크</h1>
      </header>

      {/* The filter drives `filter` state directly rather than TabsContent:
          the list below is one shared surface, so re-rendering it per panel
          would duplicate the whole card list. */}
      <Tabs
        value={filter}
        // Base UI also reports `null` when the active tab unmounts — deleting
        // the last post of a platform drops its tab — so that falls back to
        // 전체 rather than becoming a filter that matches nothing.
        onValueChange={(value) =>
          setFilter(typeof value === "string" ? (value as Filter) : "ALL")
        }
        aria-label="플랫폼"
      >
        {/* Scrolls rather than wraps: the row must stay one line on a phone,
            where four or five tabs do not fit across. TabsList is
            `inline-flex w-fit` by default, so the scroll container is the
            list itself with `max-w-full` holding it inside the viewport.
            `scrollbar-none` hides the scrollbar chrome draws on this axis —
            the row is still touch/drag-scrollable, just without the visible
            track that a `overflow-x-auto` div otherwise gets on desktop. */}
        <TabsList
          variant="line"
          className="-mx-4 h-auto max-w-[calc(100%+2rem)] justify-start overflow-x-auto scrollbar-none px-4 pb-1"
        >
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="h-8 shrink-0 flex-none rounded-full border-border px-3.5 group-data-[variant=line]/tabs-list:data-active:bg-primary group-data-[variant=line]/tabs-list:data-active:text-primary-foreground"
            >
              {tab.label} {counts.get(tab.value) ?? 0}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {visible.length === 0 ? (
        <Card className="flex flex-col items-center gap-4 border border-dashed border-border bg-transparent p-8 text-center text-sm text-muted-foreground ring-0">
          {/* Signed out the list is empty for a reason the user can act on,
              so the copy names it and offers the login right here. */}
          {!signedIn ? (
            <>
              로그인하면 저장한 링크를 여기에서 볼 수 있습니다.
              <Button type="button" onClick={() => setLoginOpen(true)}>
                로그인
              </Button>
            </>
          ) : posts.length === 0 ? (
            "아직 저장한 링크가 없습니다. 지도에서 + 버튼을 눌러 링크를 붙여넣으세요."
          ) : (
            "이 플랫폼으로 저장한 링크가 없습니다."
          )}
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              mapProvider={mapProvider}
              onFocus={focusOnMap}
              onDelete={() => handleDelete(post.id)}
            />
          ))}
        </ul>
      )}

      {/* Returns here rather than to the map, so the login does not cost the
          user the page they were on. */}
      <LoginDrawer
        open={loginOpen}
        onOpenChange={setLoginOpen}
        redirectTo="/links"
      />
    </div>
  );
}

/** The saved link itself, named after where it came from. */
function sourceLabel(platform: Platform): string {
  return FILTERS.find((f) => f.value === platform)?.label ?? "원본 링크";
}

/**
 * The card's own title.
 *
 * The post is the thing the user saved — a reel called "홍대 데이트코스" with
 * six stops in it — so its title leads even when places were extracted. Using
 * the first place instead (as this once did) promoted one arbitrary stop to
 * stand for the whole post and threw the post's identity away; on that reel
 * the card read "애몽" and nothing said where the other five came from.
 *
 * Falls back through the first place to the raw URL, because a post whose
 * metadata fetch came back empty still has to be identifiable.
 */
function postTitle(post: SavedPostDTO): string {
  return post.title ?? post.places[0]?.name ?? post.sourceUrl;
}

function PostCard({
  post,
  mapProvider,
  onFocus,
  onDelete,
}: {
  post: SavedPostDTO;
  mapProvider: MapProvider;
  onFocus: (placeIds: string[]) => void;
  onDelete: () => void;
}) {
  const places = post.places;
  // A single place is the whole card already, so there is nothing to reveal
  // and the disclosure would be a control that only ever hides content the
  // user wants. Multi-place cards start closed to keep the list scannable.
  const collapsible = places.length > 1;
  // The lone place of a single-place card, which the head renders in full
  // because no body list is drawn for it. A post whose geocoding matched
  // nothing has none, and then the head is just the post.
  const single = places.length === 1 ? places[0] : undefined;
  // `null` means "no explicit choice yet", so the default tracks the current
  // place count instead of freezing whatever it was on mount. Re-saving a link
  // *replaces* its place set, and the card is keyed by post id — so a post that
  // went from one place to three would otherwise stay mounted with the
  // one-place default (expanded) while claiming to be collapsible.
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const open = expanded ?? !collapsible;

  const bodyId = `post-places-${post.id}`;

  // Card renders a plain div, so the list item wraps it rather than replacing
  // it — a div directly under <ul> would not be valid list markup.
  return (
    <li>
      <Card size="sm" className="w-full gap-0 py-0">
        <div className="flex items-start gap-3 p-3">
          {post.thumbnail ? (
            // The thumbnail is the post's own picture, so it opens the post.
            <a
              href={post.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={`${sourceLabel(post.platform)}에서 원본 보기`}
              className="shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {/* Not next/image: these are Instagram and YouTube CDN URLs, which
                  would each need a remotePatterns entry and would then be
                  proxied through the optimizer — a hop that buys nothing at
                  64px. Kept as a plain img, but with the three attributes that
                  actually matter for how fast the list settles:
                  width/height reserve the box so the rows do not reflow as
                  images arrive, lazy keeps offscreen rows off the critical
                  path, and decoding=async keeps a slow decode from blocking
                  paint. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={post.thumbnail}
                alt=""
                width={64}
                height={64}
                loading="lazy"
                decoding="async"
                className="h-16 w-16 rounded-lg bg-muted object-cover transition hover:opacity-80"
              />
            </a>
          ) : null}

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="line-clamp-2 text-sm font-medium">
              {postTitle(post)}
            </h2>
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              {/* Without a thumbnail the post has no other affordance, so the
                  source becomes a link here instead. */}
              {post.thumbnail ? (
                <span>{sourceLabel(post.platform)}</span>
              ) : (
                <a
                  href={post.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline decoration-dotted underline-offset-2"
                >
                  {sourceLabel(post.platform)}
                </a>
              )}
              {post.author && (
                <>
                  <span aria-hidden>·</span>
                  <span className="truncate">{post.author}</span>
                </>
              )}
              {/* Only for a set. "1곳" restates a card whose heading is
                  already that one place. */}
              {places.length > 1 && (
                <>
                  <span aria-hidden>·</span>
                  <Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
                    {places.length}곳
                  </Badge>
                </>
              )}
            </p>
            {/* One place: the body list does not render for it, so its
                address rides here under the heading it is the subject of. */}
            {single && (
              <>
                <p className="truncate text-xs text-muted-foreground">
                  {single.address}
                </p>
                {single.memo && (
                  <p className="truncate text-xs text-muted-foreground italic">
                    {single.memo}
                  </p>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => onFocus([single.id])}
                  className="-ml-2 w-fit text-muted-foreground"
                >
                  <MapPin aria-hidden />
                  지도에서 보기
                </Button>
              </>
            )}
            {/* The preview is what makes the collapsed card worth collapsing:
                closed, it still says which places are inside. Dropped once
                open, where the list below says it in full. */}
            {collapsible && !open && (
              <p className="truncate text-xs text-muted-foreground">
                {places.map((place) => place.name).join(" · ")}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            {single && (
              <PlaceMenu place={single} post={post} mapProvider={mapProvider} />
            )}
            {collapsible && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setExpanded(!open)}
                aria-expanded={open}
                aria-controls={bodyId}
                aria-label={open ? "장소 접기" : `장소 ${places.length}곳 펼치기`}
                className="rounded-full text-muted-foreground"
              >
                <ChevronDown
                  aria-hidden
                  className={cn("transition-transform", open && "rotate-180")}
                />
              </Button>
            )}
            <DeleteButton label={postTitle(post)} onDelete={onDelete} />
          </div>
        </div>

        {/* `> 1` rather than `> 0`: with one place the row would repeat the
            heading and its address verbatim, so that card carries the address
            and the actions in its head instead (위 카드 머리 참고).

            Unmounted rather than hidden while closed: a six-place post carries
            six menus and six focusable rows, and leaving them in the tree puts
            them in the tab order and the screen reader's list behind a control
            that says they are collapsed. */}
        {open && places.length > 1 && (
          <div id={bodyId} className="border-t border-border">
            <ul>
              {places.map((place, index) => (
                <PlaceRow
                  key={place.id}
                  place={place}
                  post={post}
                  // Numbered because these posts are usually ordered — a
                  // 데이트코스 is a route, and the caption's order is the one
                  // the creator meant.
                  index={index + 1}
                  numbered={places.length > 1}
                  mapProvider={mapProvider}
                  onFocus={() => onFocus([place.id])}
                />
              ))}
            </ul>
            {places.length > 1 && (
              <div className="border-t border-border p-2">
                {/* Every id, not just the first: the map frames the set it
                    is given, and the marker effect's own fitBounds covers
                    every pin the user has saved rather than this post's. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onFocus(places.map((place) => place.id))}
                  className="w-full justify-center text-muted-foreground"
                >
                  <MapPin aria-hidden />
                  지도에서 {places.length}곳 모두 보기
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </li>
  );
}

/**
 * One place inside a post.
 *
 * The name is the button rather than a chip beside one: on a phone the row is
 * the biggest target available and jumping to the map is the action the user
 * wants most often. The external map apps move into the ⋯ menu so a
 * six-place post is six rows instead of six rows plus twelve chips.
 */
function PlaceRow({
  place,
  post,
  index,
  numbered,
  mapProvider,
  onFocus,
}: {
  place: SavedPlaceDTO;
  /** The menu needs it to prefer the saved permalink over a name search. */
  post: SavedPostDTO;
  index: number;
  numbered: boolean;
  mapProvider: MapProvider;
  onFocus: () => void;
}) {
  return (
    <li className="flex items-center gap-2 border-b border-border/60 px-3 py-2 last:border-b-0">
      {numbered && (
        <span
          aria-hidden
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground"
        >
          {index}
        </span>
      )}
      <button
        type="button"
        onClick={onFocus}
        // The accessible name carries the action, because the visible text is
        // just a place name and every row would otherwise read identically to
        // whatever the surrounding rows say.
        aria-label={`${place.name} 지도에서 보기`}
        className="min-w-0 flex-1 rounded-md px-1 py-0.5 text-left transition hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="block truncate text-sm font-medium">{place.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {place.address}
        </span>
        {/* The user's own note about the place, so it outranks nothing but
            still belongs on the row rather than behind the menu. */}
        {place.memo && (
          <span className="block truncate text-xs text-muted-foreground italic">
            {place.memo}
          </span>
        )}
      </button>
      <PlaceMenu place={place} post={post} mapProvider={mapProvider} />
    </li>
  );
}

function PlaceMenu({
  place,
  post,
  mapProvider,
}: {
  place: SavedPlaceDTO;
  post: SavedPostDTO;
  mapProvider: MapProvider;
}) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);
  const apps = useMemo(() => mapAppsFor(mapProvider), [mapProvider]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(place.address);
      setCopied(true);
      toast.success("주소를 복사했습니다.");
      // Reverting the icon matters because the menu stays mounted after it
      // closes — without this the next open still shows the check. Cleared on
      // unmount too: deleting the post takes the menu with it, and the pending
      // timer would then fire against a card that is gone.
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
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`${place.name} 옵션`}
            className="shrink-0 rounded-full text-muted-foreground"
          />
        }
      >
        <MoreHorizontal aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {apps.map((app) => {
          // hrefForApp folds the saved permalink into its own provider's slot
          // rather than adding a row, so the menu does not offer two 네이버맵
          // entries that differ only in precision.
          const href = hrefForApp(app, place, post);
          return (
            <DropdownMenuItem
              key={app.provider}
              render={
                <a href={href} target="_blank" rel="noreferrer noopener" />
              }
            >
              {app.label}에서 열기
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={copyAddress}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          주소 복사
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Deletion is not undoable — the post row and its place links are gone once
 * the request lands — so it is gated behind a confirmation.
 */
function DeleteButton({
  label,
  onDelete,
}: {
  /** The post this deletes, so the icon button is not one of N bare "삭제"s. */
  label: string;
  onDelete: () => void;
}) {
  // Controlled because `AlertDialogAction` is a plain Button — unlike
  // `AlertDialogCancel` it is not wrapped in the primitive's Close, so
  // confirming would run the delete and leave the dialog standing. An alert
  // dialog also refuses outside-press dismissal by design, which on a phone
  // leaves no way out at all.
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
              onDelete();
            }}
          >
            삭제
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
