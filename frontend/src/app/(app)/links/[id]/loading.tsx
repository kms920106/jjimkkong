import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ChevronIcon } from "@/components/ChevronIcon";
import { cn } from "@/lib/utils";

/**
 * Same reason /links has one: this page is `force-dynamic`, so its HTML cannot
 * exist until getUser() and the post query come back and a prefetch has nothing
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
    <div className="flex w-full flex-col pb-8">
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

      {/* Square, matching the real thumbnail: the picture is the tallest thing
          on the page, so anything else here would collapse on arrival. */}
      <div className="aspect-square w-full animate-pulse bg-muted" aria-hidden />

      <div className="flex flex-col gap-2 px-4 pt-4" aria-hidden>
        <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
      </div>

      {/* One card and the edge of the next, which is what the real swiper
          shows — a single full-width block would not read as a scroller. */}
      <div className="mt-4 flex gap-3 overflow-hidden px-4" aria-hidden>
        <div className="h-28 w-[78%] max-w-72 shrink-0 animate-pulse rounded-xl bg-muted" />
        <div className="h-28 w-[78%] max-w-72 shrink-0 animate-pulse rounded-xl bg-muted" />
      </div>
    </div>
  );
}
