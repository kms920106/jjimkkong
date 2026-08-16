"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SavedPostDTO } from "@/lib/types";

export default function PostsClient({
  initialPosts,
}: {
  initialPosts: SavedPostDTO[];
}) {
  const router = useRouter();
  const [posts, setPosts] = useState(initialPosts);
  const [error, setError] = useState<string | null>(null);

  /**
   * The map lives on the home page now, so focusing a place is a navigation.
   * Home reads ?place= and moves the camera there on mount.
   */
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <header className="flex items-center gap-3">
        <Link
          href="/"
          aria-label="지도로 돌아가기"
          className="rounded-full p-2 text-neutral-500 transition hover:bg-neutral-100 dark:hover:bg-neutral-900"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </Link>
        <h1 className="text-base font-semibold">
          저장한 게시글 {posts.length}개
        </h1>
      </header>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {posts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          아직 저장한 게시글이 없습니다. 지도에서 + 버튼을 눌러 링크를
          붙여넣으세요.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onFocusPlace={focusOnMap}
              onDelete={() => handleDelete(post.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function PostCard({
  post,
  onFocusPlace,
  onDelete,
}: {
  post: SavedPostDTO;
  onFocusPlace: (id: string) => void;
  onDelete: () => void;
}) {
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
      className={`flex gap-3 rounded-xl border border-neutral-200 p-3 transition dark:border-neutral-800 ${
        firstPlace ? "cursor-pointer" : ""
      } focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500`}
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
            // The card behind it also navigates on click; without stopping
            // propagation, opening the link would also leave the page.
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
              className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
            >
              {place.name}
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        onClick={(event) => {
          // Otherwise deleting would also navigate to the card it just removed.
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
