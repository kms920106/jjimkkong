"use client";

import { useState } from "react";
import type { IngestedPost } from "@/lib/types";

type Props = {
  post: IngestedPost;
  busy: boolean;
  /** Rendered inside the prompt, which covers the page-level error banner. */
  error: string | null;
  onCancel: () => void;
  /** Re-runs the ingest-and-save flow with a caption the user pasted by hand. */
  onSubmit: (caption: string) => Promise<void>;
};

/**
 * Shown only when the caption could not be fetched (a private or
 * login-walled post). Everything else saves without asking.
 */
export default function CaptionPrompt({
  post,
  busy,
  error,
  onCancel,
  onSubmit,
}: Props) {
  const [caption, setCaption] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="flex w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl dark:bg-neutral-900">
        <header className="flex items-start gap-3 border-b border-neutral-200 p-4 dark:border-neutral-800">
          {post.thumbnail && (
            // Remote thumbnails come from arbitrary CDNs; next/image would
            // need every host allowlisted in next.config.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.thumbnail}
              alt=""
              className="h-16 w-16 shrink-0 rounded-lg object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {post.title ?? post.sourceUrl}
            </p>
            {post.author && (
              <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                {post.author}
              </p>
            )}
          </div>
        </header>

        <div className="flex flex-col gap-3 p-4">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            게시글 내용을 가져오지 못했습니다. 캡션(본문)을 복사해 아래에
            붙여넣으면 장소를 찾아 저장합니다.
          </p>
          <textarea
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            rows={6}
            placeholder="게시글 캡션을 붙여넣으세요"
            className="w-full resize-y rounded-lg border border-neutral-300 bg-transparent p-3 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700"
          />
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>

        <footer className="flex gap-2 border-t border-neutral-200 p-4 dark:border-neutral-800">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-medium disabled:opacity-50 dark:border-neutral-700"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => onSubmit(caption.trim())}
            disabled={busy || !caption.trim()}
            className="flex-1 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {busy ? "저장 중…" : "저장"}
          </button>
        </footer>
      </div>
    </div>
  );
}
