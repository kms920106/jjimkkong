import { ChevronLeft } from "lucide-react";

/**
 * Same reason /links has one: this page is `force-dynamic`, so its HTML cannot
 * exist until getUser() returns and a prefetch has nothing to pre-build. Without
 * this the drawer closes and the previous screen sits there for the whole server
 * round trip, which reads as the pencil not working rather than as slow.
 *
 * The container class must match ProfileEditClient's root exactly, or the layout
 * jumps when the real form replaces this.
 */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-6">
      <header className="flex items-center gap-3">
        <span
          className="flex size-9 items-center justify-center rounded-full text-muted-foreground"
          aria-hidden
        >
          <ChevronLeft />
        </span>
        <h1 className="text-base font-semibold">프로필 수정</h1>
      </header>

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
  );
}
