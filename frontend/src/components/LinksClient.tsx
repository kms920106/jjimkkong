"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import type { Platform, SavedPlaceDTO, SavedPostDTO } from "@/lib/types";
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
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
}: {
  initialPosts: SavedPostDTO[];
}) {
  const router = useRouter();
  const [posts, setPosts] = useState(initialPosts);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");

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
   * The map lives on the home page now, so focusing a place is a navigation.
   * Home reads ?place= and moves the camera there on mount.
   *
   * Deliberately unwired: the card no longer navigates on click, and the
   * button that will call this is not built yet. Delete it with the button,
   * not before.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function focusOnMap(placeId: string) {
    router.push(`/?place=${encodeURIComponent(placeId)}`);
  }

  async function handleDelete(postId: string) {
    const res = await fetch(`/api/posts/${postId}`, { method: "DELETE" });
    if (res.ok) {
      setPosts((prev) => prev.filter((post) => post.id !== postId));
      // The home map reads its pins from a server render, so it would keep
      // showing the deleted post's places until the cache is invalidated.
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
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon" }),
            "rounded-full text-muted-foreground",
          )}
        >
          <ChevronLeft aria-hidden />
        </Link>
        <h1 className="text-base font-semibold">링크 {posts.length}개</h1>
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
            list itself with `max-w-full` holding it inside the viewport. */}
        <TabsList
          variant="line"
          className="-mx-4 h-auto max-w-[calc(100%+2rem)] justify-start overflow-x-auto px-4 pb-1"
        >
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="h-8 shrink-0 flex-none rounded-full border-border px-3.5 data-active:bg-primary data-active:text-primary-foreground"
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
        <Card className="border border-dashed border-border bg-transparent p-8 text-center text-sm text-muted-foreground ring-0">
          {posts.length === 0
            ? "아직 저장한 링크가 없습니다. 지도에서 + 버튼을 눌러 링크를 붙여넣으세요."
            : "이 플랫폼으로 저장한 링크가 없습니다."}
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onDelete={() => handleDelete(post.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Search URLs, not permalinks. Neither provider gives us a place id we could
 * link to: `place.naverLink` holds the Local Search API's `link`, which is the
 * merchant's own homepage (often a blog, often empty) — not a map page. A name
 * search lands on the right place in both apps and degrades to a result list
 * rather than a 404 when the name is ambiguous.
 */
function naverMapUrl(place: SavedPlaceDTO): string {
  return `https://map.naver.com/p/search/${encodeURIComponent(place.name)}`;
}

function kakaoMapUrl(place: SavedPlaceDTO): string {
  return `https://map.kakao.com/?q=${encodeURIComponent(place.name)}`;
}

/**
 * The chip row: map links only.
 *
 * The source post is reachable through the thumbnail, so a chip for it would
 * be a second copy of that same link — and for Instagram it says nothing about
 * where the place is, which is what this row is for.
 *
 * A post saved *from* a map provider is the exception. Its source URL points
 * at the exact place the user picked, whereas the generated search only
 * guesses from the name, so the saved URL takes that provider's slot.
 * Insertion order puts it first and the `Map` keyed by label drops the later
 * search entry.
 */
function placeLinks(
  post: SavedPostDTO,
  place: SavedPlaceDTO | undefined,
): Array<{ href: string; label: string }> {
  const byLabel = new Map<string, string>();
  if (post.platform === "NAVER" || post.platform === "KAKAO") {
    byLabel.set(sourceLabel(post.platform), post.sourceUrl);
  }
  if (place) {
    for (const [label, href] of [
      ["네이버맵", naverMapUrl(place)],
      ["카카오맵", kakaoMapUrl(place)],
    ]) {
      if (!byLabel.has(label)) byLabel.set(label, href);
    }
  }
  return [...byLabel].map(([label, href]) => ({ label, href }));
}

function PostCard({
  post,
  onDelete,
}: {
  post: SavedPostDTO;
  onDelete: () => void;
}) {
  // A post can hold several places (one Instagram reel, several stops); the
  // card is titled by the first one and the rest follow as their own rows.
  const firstPlace = post.places[0];

  // Card renders a plain div, so the list item wraps it rather than replacing
  // it — a div directly under <ul> would not be valid list markup.
  return (
    <li>
      <Card size="sm" className="w-full">
        <CardContent className="flex gap-3">
          {post.thumbnail && (
            // The thumbnail is the post's own picture, so it opens the post —
            // the card body links to the maps instead.
            <a
              href={post.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={`${sourceLabel(post.platform)}에서 원본 보기`}
              className="shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={post.thumbnail}
                alt=""
                className="h-20 w-20 rounded-lg object-cover transition hover:opacity-80"
              />
            </a>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-medium">
                {firstPlace?.name ?? post.title ?? post.sourceUrl}
              </h2>
              {firstPlace && (
                <p className="truncate text-xs text-muted-foreground">
                  {firstPlace.address}
                </p>
              )}
            </div>
            {/* Not gated on firstPlace: a post whose geocoding matched nothing
                still has to expose the link the user saved. */}
            <div className="flex flex-wrap gap-1.5">
              {placeLinks(post, firstPlace).map((link) => (
                <PlaceLink
                  key={link.label}
                  href={link.href}
                  label={link.label}
                  describedBy={firstPlace?.name}
                />
              ))}
            </div>
            {/* Places beyond the first still need to be reachable — the card's
                heading only covers one of them. */}
            {post.places.length > 1 && (
              <ul className="flex flex-col gap-1.5 border-t border-border pt-2">
                {post.places.slice(1).map((place) => (
                  <li
                    key={place.id}
                    className="flex flex-wrap items-center gap-1.5"
                  >
                    <span
                      title={place.address}
                      className="truncate text-xs font-medium"
                    >
                      {place.name}
                    </span>
                    <PlaceLink
                      href={naverMapUrl(place)}
                      label="네이버맵"
                      describedBy={place.name}
                    />
                    <PlaceLink
                      href={kakaoMapUrl(place)}
                      label="카카오맵"
                      describedBy={place.name}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <DeleteButton onDelete={onDelete} />
        </CardContent>
      </Card>
    </li>
  );
}

/**
 * Deletion is not undoable — the post row and its place links are gone once
 * the request lands — so it is gated behind a confirmation.
 */
function DeleteButton({ onDelete }: { onDelete: () => void }) {
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
            size="xs"
            aria-label="삭제"
            className="h-fit shrink-0 text-muted-foreground hover:text-destructive"
          />
        }
      >
        삭제
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

/** The saved link itself, named after where it came from. */
function sourceLabel(platform: Platform): string {
  return FILTERS.find((f) => f.value === platform)?.label ?? "원본 링크";
}

/**
 * `describedBy` names the place in the accessible name only. Every card emits
 * a "네이버맵"/"카카오맵" pair, so without it a screen reader's link list is
 * 2N identically-named entries with nothing to tell them apart.
 */
function PlaceLink({
  href,
  label,
  describedBy,
}: {
  href: string;
  label: string;
  describedBy?: string;
}) {
  return (
    <Badge
      variant="secondary"
      render={
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={describedBy ? `${describedBy} — ${label}` : undefined}
        />
      }
    >
      {label}
    </Badge>
  );
}
