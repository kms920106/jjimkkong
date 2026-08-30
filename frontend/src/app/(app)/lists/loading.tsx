import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ChevronIcon } from "@/components/ChevronIcon";
import { cn } from "@/lib/utils";

/**
 * The page is `force-dynamic`: its HTML cannot exist until getMember() and the
 * list query come back, so a prefetch cannot pre-build it either. Without this
 * file the router has nothing to paint on click and the old page just sits
 * there for the whole round trip — the navigation reads as broken rather than
 * slow.
 *
 * The outer container classes are copied from ListsClient exactly, which is the
 * point: when the real component swaps in, nothing may shift. The header markup
 * is duplicated from SettingsHeader rather than imported for the reason
 * /links/loading.tsx records — a static skeleton cannot hold the live
 * `onBackClick` handler, and a plain href matches the real header's fallback.
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
        <h1 className="text-center text-lg leading-none">저장</h1>
        <span aria-hidden />
      </header>

      <p className="sr-only" role="status">
        리스트를 불러오는 중입니다.
      </p>

      {/* Four rows: about what a phone shows above the fold, so the skeleton
          occupies the space the real list will. */}
      <ul className="px-4" aria-hidden>
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i} className="flex items-center gap-3 border-b py-4">
            <span className="size-11 shrink-0 animate-pulse rounded-full bg-muted" />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="h-4 w-32 animate-pulse rounded bg-muted" />
              <span className="h-3 w-20 animate-pulse rounded bg-muted" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
