"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MapView from "@/components/map/MapView";
import CaptionPrompt from "@/components/CaptionPrompt";
import AppDrawer from "@/components/AppDrawer";
import UrlSheet from "@/components/UrlSheet";
import type { IngestResponse, ProfileDTO, SavedPostDTO } from "@/lib/types";
import type { FocusRequest, MapMarker } from "@/lib/map/types";

type Props = {
  initialPosts: SavedPostDTO[];
  profile: ProfileDTO;
};

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

export default function HomeClient({ initialPosts, profile }: Props) {
  const [posts, setPosts] = useState(initialPosts);
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Only set when the caption could not be fetched; saving needs the user to
  // paste it before there is any text to extract places from.
  const [captionNeeded, setCaptionNeeded] = useState<IngestResponse | null>(
    null,
  );
  // The request drives the camera; the id it carries drives the highlight.
  // A bare id could not express "focus this again" after the user pans away,
  // because React skips the re-render when state is unchanged.
  const router = useRouter();
  const searchParams = useSearchParams();
  // /posts sends the user back here with ?place=<id> to move the camera.
  // Seeding the initial state from it (rather than setting it in an effect)
  // gets the pin centred on the very first paint, with no visible jump.
  const requestedPlace = searchParams.get("place");
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(() =>
    requestedPlace ? { placeId: requestedPlace, nonce: 0 } : null,
  );

  const requestFocus = useCallback((placeId: string) => {
    setFocusRequest((prev) => ({ placeId, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  // Strip the consumed param so a refresh or a back-navigation does not yank
  // the map back to a pin the user has since panned away from. This is a URL
  // side effect only — the focus above already happened.
  useEffect(() => {
    if (requestedPlace) router.replace("/", { scroll: false });
  }, [requestedPlace, router]);

  const markers = useMemo<MapMarker[]>(() => {
    const byId = new Map<string, MapMarker>();
    for (const post of posts) {
      for (const place of post.places) {
        // The same place saved from two posts is one pin.
        byId.set(place.id, {
          id: place.id,
          name: place.name,
          lat: place.lat,
          lng: place.lng,
        });
      }
    }
    return [...byId.values()];
  }, [posts]);

  const refreshPosts = useCallback(async () => {
    const res = await fetch("/api/posts");
    if (!res.ok) {
      // Silently keeping a stale list would make the user re-save the post
      // they just saved.
      setError(await readError(res, "목록을 새로 불러오지 못했습니다."));
      return;
    }
    const body = (await res.json()) as { posts: SavedPostDTO[] };
    setPosts(body.posts);
  }, []);

  const ingest = useCallback(
    async (targetUrl: string, manualCaption?: string) => {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          manualCaption ? { url: targetUrl, manualCaption } : { url: targetUrl },
        ),
      });

      if (!res.ok) {
        throw new Error(await readError(res, "링크를 읽지 못했습니다."));
      }

      return (await res.json()) as IngestResponse;
    },
    [],
  );

  /** Saves every geocoded candidate; the user no longer picks a subset. */
  const save = useCallback(
    async (result: IngestResponse) => {
      const places = result.candidates.filter((candidate) => candidate.matched);

      if (places.length === 0) {
        // A failed lookup is not the same as a place that isn't on the map;
        // saying "not found" would send the user off to fix a correct link.
        throw new Error(
          result.candidates.some((candidate) => candidate.lookupFailed)
            ? "장소 검색에 일시적으로 실패했습니다. 잠시 후 다시 시도해 주세요."
            : "이 게시글에서 지도에 표시할 장소를 찾지 못했습니다.",
        );
      }

      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          post: {
            sourceUrl: result.post.sourceUrl,
            platform: result.post.platform,
            title: result.post.title,
            caption: result.post.caption,
            thumbnail: result.post.thumbnail,
            author: result.post.author,
          },
          // Only the search terms are sent; the server re-geocodes so a
          // request cannot write coordinates into the shared place table.
          places: places.map((place) => ({
            name: place.query,
            hint: place.hint,
          })),
        }),
      });

      if (!res.ok) {
        throw new Error(await readError(res, "저장하지 못했습니다."));
      }

      setCaptionNeeded(null);
      setSheetOpen(false);
      await refreshPosts();
    },
    [refreshPosts],
  );

  /**
   * Ingest and save are one user action now: a link either lands on the map or
   * reports why it could not, with the caption prompt as the only detour.
   */
  const ingestAndSave = useCallback(
    async (targetUrl: string, manualCaption?: string) => {
      setIngesting(true);
      setError(null);
      try {
        const result = await ingest(targetUrl, manualCaption);

        // Without a caption there is nothing to extract places from, so ask
        // for it instead of failing the save. The sheet steps aside so the
        // two dialogs are never stacked on top of each other.
        if (result.needsManualCaption) {
          setCaptionNeeded(result);
          setSheetOpen(false);
          return;
        }

        // The manual-caption retry skips the metadata fetch for a source
        // already known to be blocking, so its title/thumbnail/author come
        // back null. Saving those would wipe what the first pass found.
        await save(
          captionNeeded
            ? {
                ...result,
                post: {
                  ...result.post,
                  title: result.post.title ?? captionNeeded.post.title,
                  thumbnail:
                    result.post.thumbnail ?? captionNeeded.post.thumbnail,
                  author: result.post.author ?? captionNeeded.post.author,
                },
              }
            : result,
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "저장하지 못했습니다.");
      } finally {
        setIngesting(false);
      }
    },
    [captionNeeded, ingest, save],
  );

  return (
    // The map fills the viewport; every other control floats above it.
    <div className="fixed inset-0">
      <MapView
        provider={profile.mapProvider}
        markers={markers}
        onMarkerClick={requestFocus}
        focusRequest={focusRequest}
      />

      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        aria-label="메뉴 열기"
        className="absolute top-4 left-4 z-30 flex h-11 w-11 items-center justify-center rounded-full bg-white text-neutral-800 shadow-lg transition hover:bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      <button
        type="button"
        onClick={() => {
          setError(null);
          setSheetOpen(true);
        }}
        aria-label="링크 추가"
        className="absolute right-5 bottom-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-neutral-900 text-white shadow-lg transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-7 w-7"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      {/* The sheet owns its own error line while open; this banner is for the
          failures that land after it closes (a caption retry, say). */}
      {error && !sheetOpen && !captionNeeded && (
        <p
          role="status"
          className="absolute inset-x-4 bottom-24 z-30 rounded-xl bg-red-600 px-4 py-3 text-sm text-white shadow-lg"
        >
          {error}
        </p>
      )}

      <AppDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        profile={profile}
        savedCount={posts.length}
      />

      {sheetOpen && (
        <UrlSheet
          busy={ingesting}
          error={error}
          onClose={() => setSheetOpen(false)}
          onSubmit={(targetUrl) => void ingestAndSave(targetUrl)}
        />
      )}

      {captionNeeded && (
        <CaptionPrompt
          post={captionNeeded.post}
          busy={ingesting}
          // The prompt covers the page, so the banner above is not visible
          // while it is open.
          error={error}
          onCancel={() => {
            setCaptionNeeded(null);
            setError(null);
          }}
          onSubmit={(caption) =>
            ingestAndSave(captionNeeded.post.sourceUrl, caption)
          }
        />
      )}
    </div>
  );
}
