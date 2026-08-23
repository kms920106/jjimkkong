"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, MapPin } from "lucide-react";
import type { Platform, SavedPostDTO } from "@/lib/types";
import { PostThumbnail } from "@/components/PostThumbnail";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import LoginDrawer from "@/components/LoginDrawer";
import { SettingsHeader } from "@/components/SettingsHeader";
import { platformLabel } from "@/lib/platform-labels";

/**
 * "전체" is not a Platform value, so the filter is widened rather than typed
 * as one — every other member has to stay in step with the enum.
 */
type Filter = "ALL" | Platform;

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "ALL", label: "전체" },
  { value: "INSTAGRAM", label: platformLabel("INSTAGRAM") },
  { value: "YOUTUBE", label: platformLabel("YOUTUBE") },
  { value: "NAVER", label: platformLabel("NAVER") },
  { value: "KAKAO", label: platformLabel("KAKAO") },
  { value: "OTHER", label: platformLabel("OTHER") },
];

/**
 * The saved links as a gapless three-column grid of their pictures.
 *
 * This replaced a vertical list of cards that carried the title, the author,
 * every place name and a per-place menu on each row. The grid throws all of
 * that away on purpose: a saved link is remembered by what it looked like, and
 * one screen of the old list held four posts where this holds fifteen. The
 * detail is not gone, it moved to /links/[id], which is the tap target every
 * cell now is.
 */
export default function LinksClient({
  initialPosts,
  signedIn,
}: {
  initialPosts: SavedPostDTO[];
  signedIn: boolean;
}) {
  const router = useRouter();
  const [posts] = useState(initialPosts);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [loginOpen, setLoginOpen] = useState(false);

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
   * answer can change while the page is open, since opening a post pushes a new
   * entry. A value captured on mount would be stale by then.
   *
   * A delete disqualifies the page too. Deleting now happens on the detail
   * page, which calls router.refresh(), and refresh invalidates the bfcache
   * (refresh-reducer.js: "During a refresh, invalidate the BFCache, which may
   * contain dynamic data") — correctly, since the map must stop showing the
   * pins of a post that no longer exists. Returning here from that delete
   * therefore lands with the flag already set by the navigation, so the guard
   * stays for the case where this page is revisited within one session.
   */
  function canPopBack() {
    if (didMutate.current) return false;
    const index = window.navigation?.currentEntry?.index;
    return typeof index === "number" && index > 0;
  }

  // Kept for the same reason the old list held it: something that invalidated
  // the home page's cached entry must stop the back button from popping to it.
  const didMutate = useRef(false);

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

  return (
    <div className="flex w-full flex-col gap-4">
      <SettingsHeader
        href="/"
        ariaLabel="지도로 돌아가기"
        title="링크"
        onBackClick={goBack}
      />

      {/* The filter row keeps the page's gutter; the grid below deliberately
          does not, so its cells reach both edges. */}
      <div className="px-4">
        {/* The filter drives `filter` state directly rather than TabsContent:
            the grid below is one shared surface, so re-rendering it per panel
            would duplicate the whole thing. */}
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
      </div>

      {visible.length === 0 ? (
        <div className="px-4">
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
        </div>
      ) : (
        // `gap-px` on a muted background, not `gap-0`: the hairline between
        // cells is what keeps two adjacent dark thumbnails from reading as one
        // image, and it costs no layout the way a border would.
        <ul className="grid grid-cols-3 gap-px bg-border">
          {visible.map((post) => (
            <PostCell key={post.id} post={post} />
          ))}
        </ul>
      )}

      <div className="px-4">
        {/* Returns here rather than to the map, so the login does not cost the
            user the page they were on. */}
        <LoginDrawer
          open={loginOpen}
          onOpenChange={setLoginOpen}
          redirectTo="/links"
        />
      </div>
    </div>
  );
}

/**
 * The card's own title, used as the cell's accessible name.
 *
 * The post is the thing the user saved — a reel called "홍대 데이트코스" with
 * six stops in it — so its title leads even when places were extracted. Using
 * the first place instead (as this once did) promoted one arbitrary stop to
 * stand for the whole post and threw the post's identity away.
 *
 * Falls back through the first place to the raw URL, because a post whose
 * metadata fetch came back empty still has to be identifiable.
 */
function postTitle(post: SavedPostDTO): string {
  return post.title ?? post.places[0]?.name ?? post.sourceUrl;
}

/**
 * One square in the grid: the post's picture and nothing else.
 *
 * The whole cell is the link, so the tap target is the thumbnail itself rather
 * than a caption under it — that is what lets the grid be gapless. Since no
 * text is drawn, the accessible name has to carry the post's identity, and the
 * badges are `aria-hidden` because they restate what that name already says.
 */
function PostCell({ post }: { post: SavedPostDTO }) {
  const title = postTitle(post);
  const count = post.places.length;

  return (
    <li className="relative aspect-square">
      <Link
        href={`/links/${post.id}`}
        aria-label={
          count > 0 ? `${title} — 장소 ${count}곳` : title
        }
        className="block size-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <PostThumbnail
          key={post.thumbnail}
          src={post.thumbnail}
          alt=""
          className="size-full bg-muted object-cover"
          fallback={
            // No picture is a normal state, not an error: a map link has no
            // thumbnail at all. The cell still has to fill its square or the
            // grid develops holes, so it names the platform instead.
            <span
              aria-hidden
              className="flex size-full items-center justify-center bg-muted p-1 text-center text-[10px] leading-tight text-muted-foreground"
            >
              {platformLabel(post.platform)}
            </span>
          }
        />

        {/* Top-right, matching where Instagram puts its own multi-item mark —
            the grid this imitates has trained the position. */}
        {count > 1 && (
          <span
            aria-hidden
            className="pointer-events-none absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white"
          >
            <Copy className="size-2.5" strokeWidth={2.5} />
            {count}
          </span>
        )}
        {count === 1 && (
          <span
            aria-hidden
            className="pointer-events-none absolute right-1.5 top-1.5 rounded-full bg-black/55 p-1 text-white"
          >
            <MapPin className="size-2.5" strokeWidth={2.5} />
          </span>
        )}
      </Link>
    </li>
  );
}
