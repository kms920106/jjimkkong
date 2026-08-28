import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ChevronIcon } from "@/components/ChevronIcon";
import { cn } from "@/lib/utils";

/**
 * Same reason the other force-dynamic pages have one: this page's HTML cannot
 * exist until getMember() and the bookmark query come back, so a prefetch has
 * nothing to pre-build. Without this file the post detail just sits there for
 * the whole server round trip after a place card is tapped, which reads as the
 * card not having been pressed.
 *
 * The header is duplicated from SettingsHeader rather than imported, for the
 * reason the other loading.tsx files record: a static skeleton must render with
 * no props tying it to live navigation. The back href has no post number to
 * point at yet, so it falls back to the grid.
 *
 * The container classes must stay identical to PostMapClient's root — the
 * `min-h-0 flex-1` in particular, since without it the map box overflows the
 * column rather than shrinking to it.
 */
export default function Loading() {
  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden">
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
        <h1 className="text-center text-lg leading-none">지도</h1>
        <span aria-hidden />
      </header>

      <p className="sr-only" role="status">
        지도를 불러오는 중입니다.
      </p>

      {/* A map cannot be skeletoned into anything meaningful — there is no
          layout to hold — so this is just the surface it will occupy, which is
          what keeps the header from jumping when the real map arrives. */}
      <div className="min-h-0 flex-1 animate-pulse bg-muted" aria-hidden />
    </div>
  );
}
