import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ChevronIcon } from "@/components/ChevronIcon";
import { cn } from "@/lib/utils";

/**
 * Same reason /links has one: this page is `force-dynamic`, so its HTML cannot
 * exist until getMember() returns and a prefetch has nothing to pre-build. Without
 * this the drawer closes and the previous screen sits there for the whole server
 * round trip, which reads as the pencil not working rather than as slow.
 *
 * The header markup is duplicated from SettingsHeader rather than importing it,
 * same reason /links/loading.tsx does: it must render without any props tying
 * it to a live handler, and matching the shape by hand keeps this file a static
 * skeleton.
 *
 * The container class must match ProfileEditClient's root exactly, or the layout
 * jumps when the real form replaces this.
 */
export default function Loading() {
  return (
    <div className="flex w-full flex-col gap-6">
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
        <h1 className="text-center text-lg leading-none">프로필 수정</h1>
        <span aria-hidden />
      </header>

      <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4">
        <p className="sr-only" role="status">
          프로필을 불러오는 중입니다.
        </p>

        <div className="flex justify-center py-2" aria-hidden>
          <div className="size-24 animate-pulse rounded-full bg-muted" />
        </div>

        {/* Two label + field pairs, at the heights the real Label and Input
            render at, so only the values arrive late. */}
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-2" aria-hidden>
            <div className="h-4 w-16 animate-pulse rounded bg-muted" />
            <div className="h-9 w-full animate-pulse rounded-md bg-muted" />
          </div>
        ))}

        <div className="h-12 w-full animate-pulse rounded-md bg-muted" aria-hidden />
      </div>
    </div>
  );
}
