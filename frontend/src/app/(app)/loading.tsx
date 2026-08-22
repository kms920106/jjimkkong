import { Menu, Plus } from "lucide-react";

/**
 * The home page is `force-dynamic`: it reads the session cookie, so its HTML
 * cannot exist until getUser() and the savedPost query come back and the
 * router cannot prefetch it either. Without this file a navigation here — the
 * back button on /links is the common one — paints nothing on click and the
 * previous page just sits there for the whole server round trip, which reads
 * as a dead button rather than a slow one.
 *
 * `/links` already solved the same problem with its own loading.tsx; this is
 * the other half of that pair.
 *
 * There is no skeleton for the map itself. A grey rectangle pretending to be
 * a map would be replaced by a visibly different one a moment later, so the
 * placeholder is a plain surface and the only things drawn in their real
 * positions are the two floating controls — enough for the transition to read
 * as "the map screen is here" without promising content that isn't coming.
 *
 * The container copies HomeClient's box exactly (h-dvh, w-full, fixed) so the
 * controls do not shift when the real page swaps in. See the comment there for
 * why it is not inset-0 / w-screen.
 */
export default function Loading() {
  return (
    <div className="fixed top-0 left-0 h-dvh w-full bg-muted">
      <p className="sr-only" role="status">
        지도를 불러오는 중입니다.
      </p>

      {/* Same geometry as HomeClient's real buttons, drawn inert. They are
          aria-hidden because they cannot be pressed yet — announcing two
          buttons that do nothing is worse than announcing the status line
          above. */}
      <div
        className="absolute top-4 left-4 z-30 flex h-11 w-11 items-center justify-center rounded-full bg-background text-muted-foreground shadow-lg"
        aria-hidden
      >
        <Menu className="h-5 w-5" />
      </div>

      <div
        className="absolute right-5 bottom-6 z-30 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-60 shadow-lg"
        aria-hidden
      >
        <Plus className="h-7 w-7" />
      </div>
    </div>
  );
}
