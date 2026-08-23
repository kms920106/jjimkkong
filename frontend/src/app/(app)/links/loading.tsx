import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ChevronIcon } from "@/components/ChevronIcon";
import { cn } from "@/lib/utils";

/**
 * The page is `force-dynamic`: its HTML cannot exist until getUser() and the
 * savedPost query come back, so a prefetch cannot pre-build it either. Without
 * this file the router has nothing to paint on click and the old page just sits
 * there for the whole server round trip — the navigation reads as broken rather
 * than slow. This renders instantly from the client bundle so the header and
 * the row shapes appear the moment the user taps, and only the data pops in
 * late.
 *
 * The header markup is duplicated from SettingsHeader rather than importing it,
 * for the same reason /settings/loading.tsx does: it must render without any
 * props tying it to a live back-navigation handler, and matching the shape by
 * hand keeps this file a static skeleton.
 *
 * The back link still needs to render, just without SettingsHeader's
 * `onBackClick` (LinksClient's history-pop optimisation) — a static skeleton
 * cannot hold a live handler, but a plain `href="/"` Link works during the
 * instant this file is visible and matches the real header's fallback for
 * modified clicks anyway.
 */
export default function Loading() {
  return (
    <div className="flex w-full flex-col gap-4">
      <header className="grid grid-cols-[2.5rem_1fr_2.5rem] items-center border-b bg-background py-1">
        <Link
          href="/"
          aria-label="지도로 돌아가기"
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

      {/* Chip row: fixed widths stand in for the filter labels so the grid
          below does not jump down when the real tabs measure out. The key is
          the index, not the width — two chips can share a width (the last two
          do), and keying on the value makes React see a duplicate key.

          Wrapped in its own `px-4` rather than the container having it, exactly
          as LinksClient does: the grid must reach both screen edges. */}
      <div className="px-4">
        <div className="flex gap-2" aria-hidden>
          {[44, 76, 60, 68, 68].map((w, i) => (
            <div
              key={i}
              className="h-8 shrink-0 animate-pulse rounded-full bg-muted"
              style={{ width: w }}
            />
          ))}
        </div>
      </div>

      <p className="sr-only" role="status">
        링크를 불러오는 중입니다.
      </p>

      {/* Nine cells: three rows is what a phone shows above the fold, so the
          skeleton fills the same space the real grid will. */}
      <ul className="grid grid-cols-3 gap-px bg-border" aria-hidden>
        {Array.from({ length: 9 }, (_, i) => (
          <li key={i} className="aspect-square animate-pulse bg-muted" />
        ))}
      </ul>
    </div>
  );
}
