import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ChevronIcon } from "@/components/ChevronIcon";
import { cn } from "@/lib/utils";

/**
 * Same reason the sibling routes have one: this page is `force-dynamic`, so
 * its HTML cannot exist until getMember() and the post query come back, and a
 * prefetch has nothing to pre-build. Without this file the post detail page
 * just sits there for the whole server round trip after the author is tapped,
 * which reads as the tap not having registered.
 *
 * The container classes match the real page's top-level exactly
 * (`flex w-full flex-col pb-8` and the header grid), so nothing shifts when
 * the data replaces this.
 *
 * The header is duplicated from SettingsHeader rather than imported, for the
 * reason the other loading.tsx files record: a static skeleton must render
 * with no props tying it to live navigation.
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
        <h1 className="text-center text-lg leading-none">작성자</h1>
        <span aria-hidden />
      </header>

      <p className="sr-only" role="status">
        작성자의 링크를 불러오는 중입니다.
      </p>

      {/* Mirrors the real header block: avatar, handle, count line. */}
      <section
        className="flex flex-col items-center gap-3 px-4 py-6"
        aria-hidden
      >
        <div className="size-20 animate-pulse rounded-full bg-muted" />
        <div className="flex flex-col items-center gap-2">
          <div className="h-5 w-32 animate-pulse rounded bg-muted" />
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        </div>
      </section>

      {/* One full row of squares, matching PostGrid's `grid-cols-3 gap-px`. */}
      <ul className="grid grid-cols-3 gap-px bg-border" aria-hidden>
        {Array.from({ length: 6 }, (_, index) => (
          <li key={index} className="aspect-square animate-pulse bg-muted" />
        ))}
      </ul>
    </div>
  );
}
