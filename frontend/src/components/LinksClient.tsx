"use client";

import { useMemo, useState } from "react";
import type { Platform, SavedPostDTO } from "@/lib/types";
import { PostGrid } from "@/components/PostGrid";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import LoginDrawer from "@/components/LoginDrawer";
import { SettingsHeader } from "@/components/SettingsHeader";
import { platformLabel } from "@/lib/platform-labels";
import { useBackLink } from "@/lib/use-back-link";

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
  // Read straight off the prop rather than mirrored into state. Nothing here
  // ever writes the list, and `useState(initialPosts)` would pin it to the
  // value at mount: the login drawer below is rendered *inside* this component
  // and finishes with router.refresh() + router.push("/links"), which refreshes
  // the props without remounting. A mirrored copy would keep the logged-out
  // empty array while `signedIn` — a live prop — flipped to true, so the empty
  // state below would tell a user with saved links that they have none.
  const posts = initialPosts;
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
   * Back to the map. See useBackLink: this pops the map's own entry when the
   * user arrived from it, and stays a plain link to "/" otherwise.
   */
  const { onBackClick: goBack } = useBackLink();

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
        <PostGrid posts={visible} />
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
