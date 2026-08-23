import Link from "next/link";
import type { AuthorDTO } from "@/lib/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

/**
 * The post's author: avatar plus handle, linking to that author's own page.
 *
 * A `Link`, not a button, because the destination is a real URL a user may
 * want to open in a new tab or return to with the back gesture — which is also
 * why the whole row is one anchor rather than two separate targets. Tapping
 * the picture and tapping the name go to the same place, so splitting them
 * would only produce a dead zone between them.
 */
export function AuthorLink({
  author,
  variant = "plain",
}: {
  author: AuthorDTO;
  /**
   * `overlay` is the copy that sits on top of the post's picture, where the
   * page's own colours are not available — it carries its own light-on-dark
   * palette and a scrim. `plain` inherits the surrounding text colours.
   */
  variant?: "plain" | "overlay";
}) {
  const overlay = variant === "overlay";

  return (
    <Link
      href={authorHref(author)}
      // The visible text is a bare handle, so the accessible name has to say
      // what following it does or the link reads as a label.
      aria-label={`${author.handle}님의 게시물 보기`}
      className={
        overlay
          ? // The scrim is on the pill rather than the whole image: a full
            // gradient over a photo of food dulls the thing the user came to
            // look at, and the text only needs contrast where it actually sits.
            "flex max-w-[70%] items-center gap-2 rounded-full bg-black/45 py-1 pr-3 pl-1 text-white backdrop-blur-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          : "flex max-w-full items-center gap-2 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      }
    >
      <AuthorAvatar
        author={author.handle}
        authorImage={author.image}
        className={overlay ? "size-7 ring-1 ring-white/60" : "size-7"}
      />
      <span
        className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium ${
          overlay ? "" : "text-muted-foreground"
        }`}
      >
        {author.handle}
      </span>
    </Link>
  );
}

/**
 * Just the picture, with the handle's first character behind it.
 *
 * Split out because the fallback matters more than it looks: most posts have
 * no avatar at all — every YouTube and map row, and any Instagram row saved
 * while the embed page was blocked — so the initial is the common case, not
 * the error case. Base UI's Avatar swaps to it both when `src` is null and
 * when the image fails to load, which covers the rows whose backup did not
 * happen and whose platform URL has since expired.
 */
export function AuthorAvatar({
  author,
  authorImage,
  className,
}: {
  author: string;
  authorImage: string | null;
  className?: string;
}) {
  return (
    <Avatar className={className}>
      {/* Rendering the element only when there is a src, rather than passing
          null: Base UI treats a present-but-empty src as a load attempt and
          briefly shows nothing before falling back. */}
      {authorImage && <AvatarImage src={authorImage} alt="" />}
      <AvatarFallback className="text-[0.625rem] uppercase">
        {author.slice(0, 1)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Where an author leads inside this app.
 *
 * Just the id now. This used to be
 * `/links/author/${encodeURIComponent(handle)}?platform=${platform}` — the
 * handle needed encoding because YouTube's is a channel *title*, free text with
 * spaces and Korean in it, and `platform` had to ride in the query string
 * because a handle is only unique within its platform, so a page keyed on the
 * handle alone would present two different people as one.
 *
 * Both of those were symptoms of the author not having an identifier. `Author`
 * has one, so the encoding and the scoping parameter are both gone.
 */
export function authorHref(author: AuthorDTO): string {
  return `/author/${author.id}`;
}
