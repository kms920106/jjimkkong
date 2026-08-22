"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { PostThumbnail } from "@/components/PostThumbnail";
import type { IngestedPost } from "@/lib/types";

type Props = {
  post: IngestedPost;
  busy: boolean;
  /** Stage text for the button while busy; see UrlSheet's identical prop. */
  busyLabel: string;
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
  busyLabel,
  error,
  onCancel,
  onSubmit,
}: Props) {
  const [caption, setCaption] = useState("");

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <DialogContent
        className="max-w-lg gap-0 p-0 sm:max-w-lg"
        showCloseButton={false}
      >
        <DialogHeader className="flex-row items-start gap-3 border-b p-4">
          {/* Nothing stands in for a thumbnail that fails to load: this
              dialog shows which post is being saved, and the title and author
              beside it already do that. */}
          {/* No key={src} here, unlike the /links cards: this dialog unmounts
              between posts, so the failure state cannot go stale. */}
          <PostThumbnail
            src={post.thumbnail}
            alt=""
            className="h-16 w-16 shrink-0 rounded-lg object-cover"
          />
          {/* The visible header is the post being saved, not a heading. The
              primitive still requires a title, so it is screen-reader only. */}
          <DialogTitle className="sr-only">캡션 직접 입력</DialogTitle>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {post.title ?? post.sourceUrl}
            </p>
            {post.author && (
              <p className="truncate text-xs text-muted-foreground">
                {post.author}
              </p>
            )}
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-3 p-4">
          <p className="text-sm text-muted-foreground">
            게시글 내용을 가져오지 못했습니다. 캡션(본문)을 복사해 아래에
            붙여넣으면 장소를 찾아 저장합니다.
          </p>
          <Textarea
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            rows={6}
            placeholder="게시글 캡션을 붙여넣으세요"
            className="w-full resize-y p-3 text-sm"
          />
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 flex-row gap-2 rounded-b-xl border-t p-4 sm:justify-stretch">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={busy}
            className="h-auto flex-1 px-4 py-2.5"
          >
            취소
          </Button>
          <Button
            type="button"
            onClick={() => onSubmit(caption.trim())}
            disabled={busy || !caption.trim()}
            className="h-auto flex-1 px-4 py-2.5"
          >
            {busy ? busyLabel : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
