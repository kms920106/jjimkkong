import Link from "next/link";
import { Copy, MapPin } from "lucide-react";
import type { SavedPostDTO } from "@/lib/types";
import { PostThumbnail } from "@/components/PostThumbnail";
import { platformLabel } from "@/lib/platform-labels";

/**
 * The square picture grid, shared by /links and /links/author/[author].
 *
 * Extracted from LinksClient once the author page needed the same thing. Not
 * copied: the cell carries several decisions that only make sense together —
 * the hairline gap, the place-count badge position, the accessible name that
 * stands in for text the cell does not draw — and two copies would drift on
 * the first change to any of them, leaving one of the two grids subtly wrong.
 *
 * A plain component with no "use client": it renders links and images and
 * holds no state, so the author page can render it on the server. LinksClient
 * is a client component for its own reasons (tabs, the login drawer) and
 * importing this into it costs nothing.
 */
export function PostGrid({ posts }: { posts: SavedPostDTO[] }) {
  return (
    // `gap-px` on a muted background, not `gap-0`: the hairline between
    // cells is what keeps two adjacent dark thumbnails from reading as one
    // image, and it costs no layout the way a border would.
    <ul className="grid grid-cols-3 gap-px bg-border">
      {posts.map((post) => (
        <PostCell key={post.id} post={post} />
      ))}
    </ul>
  );
}

/**
 * The card's own title, used as the cell's accessible name.
 *
 * The post is the thing the user saved — a reel called "홍대 데이트코스" with
 * six stops in it — so its title leads even when places were extracted. Using
 * the first place instead (as this once did) promoted one arbitrary stop to
 * stand for the whole post and threw the post's identity away.
 *
 * Falls back through the first place to the raw URL, because a post whose
 * metadata fetch came back empty still has to be identifiable.
 */
export function postTitle(post: SavedPostDTO): string {
  return post.title ?? post.places[0]?.name ?? post.sourceUrl;
}

/**
 * One square in the grid: the post's picture and nothing else.
 *
 * The whole cell is the link, so the tap target is the thumbnail itself rather
 * than a caption under it — that is what lets the grid be gapless. Since no
 * text is drawn, the accessible name has to carry the post's identity, and the
 * badges are `aria-hidden` because they restate what that name already says.
 */
function PostCell({ post }: { post: SavedPostDTO }) {
  const title = postTitle(post);
  const count = post.places.length;

  return (
    <li className="relative aspect-square">
      <Link
        href={`/links/${post.id}`}
        aria-label={count > 0 ? `${title} — 장소 ${count}곳` : title}
        className="block size-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <PostThumbnail
          key={post.thumbnail}
          src={post.thumbnail}
          alt=""
          className="size-full bg-muted object-cover"
          fallback={
            // No picture is a normal state, not an error: a map link has no
            // thumbnail at all. The cell still has to fill its square or the
            // grid develops holes, so it names the platform instead.
            <span
              aria-hidden
              className="flex size-full items-center justify-center bg-muted p-1 text-center text-[10px] leading-tight text-muted-foreground"
            >
              {platformLabel(post.platform)}
            </span>
          }
        />

        {/* Top-right, matching where Instagram puts its own multi-item mark —
            the grid this imitates has trained the position. */}
        {count > 1 && (
          <span
            aria-hidden
            className="pointer-events-none absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white"
          >
            <Copy className="size-2.5" strokeWidth={2.5} />
            {count}
          </span>
        )}
        {count === 1 && (
          <span
            aria-hidden
            className="pointer-events-none absolute top-1.5 right-1.5 rounded-full bg-black/55 p-1 text-white"
          >
            <MapPin className="size-2.5" strokeWidth={2.5} />
          </span>
        )}
      </Link>
    </li>
  );
}
