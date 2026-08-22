import { ChevronLeft } from "lucide-react";

/**
 * The page is `force-dynamic`: its HTML cannot exist until getUser() and the
 * savedPost query come back, so a prefetch cannot pre-build it either. Without
 * this file the router has nothing to paint on click and the old page just sits
 * there for the whole server round trip — the navigation reads as broken rather
 * than slow. This renders instantly from the client bundle so the header and
 * the row shapes appear the moment the user taps, and only the data pops in
 * late.
 *
 * The header is duplicated from LinksClient rather than shared because it must
 * render without any of that component's props (posts, mapProvider, signedIn) —
 * those are exactly what we are still waiting for.
 */
export default function Loading() {
  return (
    <div className="flex w-full flex-col gap-4 px-4 py-6">
      <header className="flex items-center gap-3">
        <span
          className="flex size-9 items-center justify-center rounded-full text-muted-foreground"
          aria-hidden
        >
          <ChevronLeft />
        </span>
        {/* No count yet — that is one of the values being fetched. The word
            alone matches the real heading's left edge, so only the number
            appears late rather than the whole title moving. */}
        <h1 className="text-base font-semibold">링크</h1>
      </header>

      {/* Chip row: fixed widths stand in for the filter labels so the list
          below does not jump down when the real tabs measure out. The key is
          the index, not the width — two chips can share a width (the last two
          do), and keying on the value makes React see a duplicate key. */}
      <div className="flex gap-2" aria-hidden>
        {[44, 76, 60, 68, 68].map((w, i) => (
          <div
            key={i}
            className="h-8 shrink-0 animate-pulse rounded-full bg-muted"
            style={{ width: w }}
          />
        ))}
      </div>

      <p className="sr-only" role="status">
        링크를 불러오는 중입니다.
      </p>

      <ul className="flex flex-col gap-3" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <li
            key={i}
            className="rounded-xl border border-border bg-card p-3"
          >
            <div className="flex items-start gap-3">
              <div className="h-16 w-16 shrink-0 animate-pulse rounded-lg bg-muted" />
              <div className="flex min-w-0 flex-1 flex-col gap-2 py-0.5">
                <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                <div className="mt-1 h-6 w-1/2 animate-pulse rounded-full bg-muted" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
