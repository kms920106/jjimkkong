"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import MapView from "@/components/map/MapView";
import CaptionPrompt from "@/components/CaptionPrompt";
import type {
  IngestResponse,
  MapProvider,
  SavedPostDTO,
} from "@/lib/types";
import type { FocusRequest, MapMarker } from "@/lib/map/types";

type Props = {
  initialPosts: SavedPostDTO[];
  mapProvider: MapProvider;
};

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

export default function HomeClient({ initialPosts, mapProvider }: Props) {
  const [posts, setPosts] = useState(initialPosts);
  const [url, setUrl] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only set when the caption could not be fetched; saving needs the user to
  // paste it before there is any text to extract places from.
  const [captionNeeded, setCaptionNeeded] = useState<IngestResponse | null>(
    null,
  );
  // The request drives the camera; the id it carries drives the highlight.
  // A bare id could not express "focus this again" after the user pans away,
  // because React skips the re-render when state is unchanged.
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const focusedPlaceId = focusRequest?.placeId ?? null;
  const mapRef = useRef<HTMLDivElement>(null);

  const requestFocus = useCallback((placeId: string) => {
    setFocusRequest((prev) => ({ placeId, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  /**
   * The map sits above the list, so on a phone it can be scrolled off screen
   * when a place is picked — panning it would then be invisible.
   */
  const focusPlaceFromList = useCallback(
    (placeId: string) => {
      requestFocus(placeId);
      mapRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
    [requestFocus],
  );

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

      setUrl("");
      setCaptionNeeded(null);
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
        // for it instead of failing the save.
        if (result.needsManualCaption) {
          setCaptionNeeded(result);
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

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || ingesting) return;
    await ingestAndSave(trimmed);
  }

  async function handleDelete(postId: string) {
    const res = await fetch(`/api/posts/${postId}`, { method: "DELETE" });
    if (res.ok) {
      const remaining = posts.filter((post) => post.id !== postId);
      // The same place can be saved from two posts, so focus only goes stale
      // once no remaining post holds it.
      const stillSaved = remaining.some((post) =>
        post.places.some((place) => place.id === focusedPlaceId),
      );
      if (focusedPlaceId && !stillSaved) setFocusRequest(null);
      setPosts(remaining);
    } else {
      setError(await readError(res, "삭제하지 못했습니다."));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="인스타그램 또는 유튜브 링크를 붙여넣으세요"
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-4 py-3 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700"
        />
        <button
          type="submit"
          disabled={ingesting || !url.trim()}
          className="shrink-0 rounded-lg bg-neutral-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {ingesting ? "읽는 중…" : "저장"}
        </button>
      </form>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <div
        ref={mapRef}
        className="h-[45dvh] min-h-72 overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800"
      >
        <MapView
          provider={mapProvider}
          markers={markers}
          onMarkerClick={requestFocus}
          focusRequest={focusRequest}
        />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">
          저장한 게시글 {posts.length}개
        </h2>

        {posts.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
            아직 저장한 게시글이 없습니다. 링크를 붙여넣어 시작하세요.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                focusedPlaceId={focusedPlaceId}
                onFocusPlace={focusPlaceFromList}
                onDelete={() => handleDelete(post.id)}
              />
            ))}
          </ul>
        )}
      </section>

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

function PostCard({
  post,
  focusedPlaceId,
  onFocusPlace,
  onDelete,
}: {
  post: SavedPostDTO;
  focusedPlaceId: string | null;
  onFocusPlace: (id: string) => void;
  onDelete: () => void;
}) {
  const isFocused = post.places.some((place) => place.id === focusedPlaceId);
  // A post can hold several places (one Instagram reel, several stops); the
  // card focuses the first one rather than asking which.
  const firstPlace = post.places[0];

  return (
    <li
      role={firstPlace ? "button" : undefined}
      tabIndex={firstPlace ? 0 : undefined}
      // Overrides the default name (which would otherwise absorb the link
      // and delete button text below) with what the click actually does.
      aria-label={firstPlace ? `지도에서 ${firstPlace.name} 보기` : undefined}
      // Not aria-pressed: clicking moves the camera rather than toggling a
      // state the user can un-press.
      aria-current={isFocused || undefined}
      onClick={firstPlace ? () => onFocusPlace(firstPlace.id) : undefined}
      onKeyDown={
        firstPlace
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onFocusPlace(firstPlace.id);
              }
            }
          : undefined
      }
      className={`flex gap-3 rounded-xl border p-3 transition ${
        firstPlace ? "cursor-pointer" : ""
      } focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 ${
        isFocused
          ? "border-neutral-900 dark:border-white"
          : "border-neutral-200 dark:border-neutral-800"
      }`}
    >
      {post.thumbnail && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.thumbnail}
          alt=""
          className="h-20 w-20 shrink-0 rounded-lg object-cover"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="min-w-0">
          <a
            href={post.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            // The card behind it also opens on click; without stopping
            // propagation, opening the link would also re-fire the focus.
            onClick={(event) => event.stopPropagation()}
            className="block truncate text-sm font-medium hover:underline"
          >
            {post.title ?? post.sourceUrl}
          </a>
          {post.author && (
            <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
              {post.author}
            </p>
          )}
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {post.places.map((place) => (
            <li
              key={place.id}
              title={place.address}
              className={`rounded-full px-2.5 py-1 text-xs ${
                place.id === focusedPlaceId
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                  : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
              }`}
            >
              {place.name}
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        onClick={(event) => {
          // Otherwise deleting would also focus the card it just removed.
          event.stopPropagation();
          onDelete();
        }}
        aria-label="삭제"
        className="h-fit shrink-0 rounded-lg px-2 py-1 text-xs text-neutral-400 transition hover:bg-neutral-100 hover:text-red-600 dark:hover:bg-neutral-800"
      >
        삭제
      </button>
    </li>
  );
}
