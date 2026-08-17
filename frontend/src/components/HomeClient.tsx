"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Menu, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  // /links sends the user back here with ?place=<id> to move the camera.
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
        const message =
          cause instanceof Error ? cause.message : "저장하지 못했습니다.";
        setError(message);
        // Fired here rather than from an effect on `error`: two failures in a
        // row carry the same message, React bails out of the identical state
        // update, and an effect would never re-run — the second attempt would
        // report nothing at all. The overlays below render `error` inline, so
        // the toast is only for a failure with nothing else on screen.
        if (!sheetOpen && !captionNeeded) toast.error(message);
      } finally {
        setIngesting(false);
      }
    },
    [captionNeeded, ingest, save, sheetOpen],
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

      {/* Both controls float over the map, so they carry their own surface
          colour and shadow rather than the transparent ghost/outline the map
          would show straight through. */}
      <Button
        type="button"
        variant="secondary"
        size="icon"
        onClick={() => setDrawerOpen(true)}
        aria-label="메뉴 열기"
        className="absolute top-4 left-4 z-30 h-11 w-11 rounded-full bg-background shadow-lg hover:bg-accent"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <Button
        type="button"
        size="icon"
        onClick={() => {
          setError(null);
          setSheetOpen(true);
        }}
        aria-label="링크 추가"
        className="absolute right-5 bottom-6 z-30 h-14 w-14 rounded-full shadow-lg"
      >
        <Plus className="h-7 w-7" />
      </Button>

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
          // Rendered inline here, which is why the toast effect above stays
          // quiet while this prompt is open.
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
