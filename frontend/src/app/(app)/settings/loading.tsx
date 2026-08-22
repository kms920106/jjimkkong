import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ChevronIcon } from "@/components/ChevronIcon";
import { cn } from "@/lib/utils";

/**
 * Same reason /links and /profile have one: this page is `force-dynamic`, so
 * its HTML cannot exist until getUser() and the count query return, and a
 * prefetch has nothing to pre-build. Without this the drawer closes and the
 * previous screen sits there for the whole server round trip, which reads as
 * the gear not working rather than as slow.
 *
 * The container, header and row shapes must match SettingsClient's exactly, or
 * the layout jumps when the real list replaces this. The three groups here are
 * the three there: password, the two legal rows, then 로그아웃/회원탈퇴.
 *
 * The back link renders plainly (`href="/"`, same as SettingsClient's own
 * SettingsHeader call, which doesn't use onBackClick either) — no live
 * handler to lose by pre-rendering it here.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-neutral-50">
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
        <h1 className="text-center text-lg leading-none">설정</h1>
        <span aria-hidden />
      </header>

      <p className="sr-only" role="status">
        설정을 불러오는 중입니다.
      </p>

      <nav className="flex flex-col gap-2.5" aria-hidden>
        {[1, 2, 2].map((rows, group) => (
          <div
            key={group}
            className={cn(
              "divide-y divide-border/60 border-b border-border/60",
              group !== 0 && "border-t",
            )}
          >
            {Array.from({ length: rows }, (_, row) => (
              <div
                key={row}
                className="flex w-full items-center bg-background px-4 pr-5 py-5"
              >
                <div className="h-4 w-28 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ))}
      </nav>
    </div>
  );
}
