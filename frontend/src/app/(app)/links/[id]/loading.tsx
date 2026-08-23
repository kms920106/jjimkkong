import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ChevronIcon } from "@/components/ChevronIcon";
import { cn } from "@/lib/utils";

/**
 * Same reason /links has one: this page is `force-dynamic`, so its HTML cannot
 * exist until getMember() and the post query come back and a prefetch has nothing
 * to pre-build. Without this file the grid just sits there for the whole server
 * round trip after a tap, which reads as the cell not having been pressed.
 *
 * That matters more here than anywhere else in the app, because the grid gives
 * no other feedback — a cell is a picture with no pressed state to fall back on.
 *
 * The header is duplicated from SettingsHeader rather than imported, for the
 * reason the other loading.tsx files record: a static skeleton must render with
 * no props tying it to live navigation.
 */
export default function Loading() {
  return (
    <div className="flex min-h-screen w-full flex-col bg-neutral-50 pb-8">
      <header className="grid grid-cols-[2.5rem_1fr_2.5rem] items-center border-b bg-background py-1">
        <Link
          href="/links"
          aria-label="링크 목록으로"
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon-lg" }),
            "size-12 rounded-full",
          )}
        >
          <ChevronIcon direction="left" className="h-[15.5px] w-[9px]" />
        </Link>
        <h1 className="text-center text-lg leading-none">링크</h1>
        <span aria-hidden />
      </header>

      <p className="sr-only" role="status">
        링크를 불러오는 중입니다.
      </p>

      {/* The post block: author row, square picture, source link, caption —
          the same order and the same white surface the real one has, so the
          swap on arrival moves nothing. */}
      <div
        className="flex flex-col gap-3 border-b border-border/60 bg-background pb-4"
        aria-hidden
      >
        <div className="flex min-h-9 items-center justify-between gap-3 px-4 pt-3">
          <div className="flex items-center gap-2">
            <div className="size-7 animate-pulse rounded-full bg-muted" />
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-7 w-24 animate-pulse rounded-md bg-muted" />
        </div>

        {/* Square, matching the real thumbnail: the picture is the tallest
            thing on the page, so anything else here would collapse on
            arrival. */}
        <div className="aspect-square w-full animate-pulse bg-muted" />

        <div className="flex flex-col gap-3 px-4">
          <div className="h-4 w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      </div>

      {/* The grey band between the two blocks is the gap itself — mt-2.5, the
          same value the real 매장 정보 section carries. */}
      <div
        className="mt-2.5 flex flex-col gap-2 border-y border-border/60 bg-background py-4"
        aria-hidden
      >
        <div className="h-4 w-20 animate-pulse rounded bg-muted px-4" />
        <div className="flex flex-col gap-3 px-4">
          <div className="h-28 w-full animate-pulse rounded-xl bg-muted" />
        </div>
      </div>

    </div>
  );
}
