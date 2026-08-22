import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { savedPostInclude, toSavedPostDTO } from "@/lib/serialize";
import { classifyUrl } from "@/lib/ingest/metadata";
import { geocodeCandidates } from "@/lib/ingest/geocode";
import { deleteThumbnailBlob, isOwnThumbnailBlob } from "@/lib/post-thumbnail";
import { Platform } from "@/generated/prisma/enums";

// Re-geocoding each confirmed place server-side costs one Naver call apiece,
// though POST /api/ingest has usually just warmed the cache for these same
// names — the lookup is cached, never the decision to re-derive it here.
export const maxDuration = 60;

const httpUrl = z.string().refine((value) => {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}, "http(s) URL만 허용됩니다.");

const BodySchema = z.object({
  post: z.object({
    sourceUrl: httpUrl,
    platform: z.enum(Platform),
    title: z.string().max(500).nullable().optional(),
    caption: z.string().max(20_000).nullable().optional(),
    thumbnail: httpUrl.nullable().optional(),
    // The pre-backup CDN URL, echoed back from the ingest response. Record
    // only: nothing fetches it and nothing decides anything from it.
    //
    // It used to gate the blob delete, and that was a real hole — blob URLs are
    // public and go out in SavedPostDTO, so a caller who could assert "this URL
    // is my backup" could name any blob in our store and have the next save
    // delete it while another user's row still pointed at it. The gate is now
    // isOwnThumbnailBlob(), which reads the URL instead of trusting a claim
    // about it. Do not make this field load-bearing again.
    thumbnailSource: httpUrl.nullable().optional(),
    author: z.string().max(200).nullable().optional(),
  }),
  // Only the name and the area hint are taken from the client; every other
  // field on the shared Place row is re-derived server-side below.
  places: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        hint: z.string().trim().max(200).nullable().optional(),
        memo: z.string().trim().max(500).nullable().optional(),
      }),
    )
    .min(1)
    .max(20),
});

export async function GET() {
  try {
    const user = await requireUser();

    const posts = await prisma.savedPost.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: savedPostInclude,
    });

    return NextResponse.json({ posts: posts.map(toSavedPostDTO) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const { post, places } = BodySchema.parse(await request.json());

    // Throws UnsupportedUrlError (→400) if the body names a host the ingest
    // path would never have produced.
    classifyUrl(post.sourceUrl);

    // Place rows are shared across users and keyed on [name, address], so a
    // client-supplied coordinate would let one user move another user's pin.
    // Resolving them here means the row only ever holds server-derived values.
    const resolved = await geocodeCandidates(
      places.map(({ name, hint }) => ({ name, hint: hint ?? null })),
    );

    const matched = resolved
      .map((place, index) => ({ ...place, memo: places[index].memo ?? null }))
      .filter((place) => place.matched);

    if (matched.length === 0) {
      return NextResponse.json(
        { error: "지도에서 찾은 장소가 없어 저장하지 못했습니다." },
        { status: 422 },
      );
    }

    const saved = await prisma.$transaction(async (tx) => {
      // Read inside the transaction, not from a value fetched before the
      // upload: two concurrent saves of the same post (a double tap, two tabs)
      // would otherwise both hold the same stale URL, and one could mistake
      // the URL its rival had just written for the old one and delete a live
      // blob. Same reasoning as the profile picture route.
      //
      // Not airtight for a *first* save of a post: both requests read null,
      // both upsert, and whichever loses the unique race replaces a blob while
      // believing it displaced nothing — leaking one blob. Accepted rather than
      // fixed, because closing it needs SELECT … FOR UPDATE or serializable
      // isolation on the hot save path, and the cost of the race is storage for
      // one image, only under a double tap on a brand-new link.
      const previous = await tx.savedPost.findUnique({
        where: {
          userId_sourceUrl: { userId: user.id, sourceUrl: post.sourceUrl },
        },
        select: { thumbnail: true },
      });

      // Recorded only alongside a thumbnail that really is one of our blobs, so
      // the column never claims a platform CDN URL was backed up. Purely
      // descriptive — no delete decision reads it.
      //
      // Nothing here rejects a thumbnail URL belonging to another user's post.
      // It cannot: the blob a legitimate first save points at was uploaded by
      // POST /api/ingest moments earlier and is not in any row yet, so "already
      // referenced" and "someone else's" look identical at this point. What
      // stops an adopted URL from doing harm is the reference count guarding
      // every delete — an adopted blob is still referenced by its real owner's
      // row, so it is never the one that gets removed.
      const thumbnailSource = isOwnThumbnailBlob(post.thumbnail ?? null)
        ? (post.thumbnailSource ?? null)
        : null;

      const savedPost = await tx.savedPost.upsert({
        where: {
          userId_sourceUrl: { userId: user.id, sourceUrl: post.sourceUrl },
        },
        create: {
          userId: user.id,
          sourceUrl: post.sourceUrl,
          platform: post.platform,
          title: post.title ?? null,
          caption: post.caption ?? null,
          thumbnail: post.thumbnail ?? null,
          thumbnailSource,
          author: post.author ?? null,
        },
        update: {
          title: post.title ?? null,
          caption: post.caption ?? null,
          author: post.author ?? null,
          // The thumbnail alone is left untouched when null, unlike the fields
          // above. What this column points at may be a blob we own: a
          // re-ingest while Instagram is blocking us arrives with
          // `thumbnail: null`, and overwriting would discard an image that is
          // still perfectly good while orphaning its blob. There is no path
          // by which a user asks to *remove* a thumbnail, so null here never
          // means "clear it". If one is ever added it needs an explicit
          // sentinel — this line will silently ignore a null.
          ...(post.thumbnail ? { thumbnail: post.thumbnail, thumbnailSource } : {}),
        },
      });

      // The blob this write displaced, if it was one of ours and nothing else
      // still points at it.
      //
      // The reference count is the part that matters, and it is not
      // bookkeeping — it is the ownership check. `thumbnail` arrives in the
      // request body, and blob URLs are public: they go out in SavedPostDTO,
      // and GET /api/places/[id]/sources hands out every user's posts without
      // authentication. So a signed-in caller can save someone else's
      // thumbnail URL onto their own post and re-save to displace it. Testing
      // the URL shape alone would then delete a blob the victim's row still
      // renders. Asking whether any row still references it is what makes that
      // attack a no-op, and it is also what keeps two of our own rows sharing
      // a URL from deleting each other's image.
      const candidate =
        previous?.thumbnail &&
        previous.thumbnail !== savedPost.thumbnail &&
        isOwnThumbnailBlob(previous.thumbnail)
          ? previous.thumbnail
          : null;

      const stillReferenced = candidate
        ? await tx.savedPost.count({
            where: { thumbnail: candidate, id: { not: savedPost.id } },
          })
        : 0;

      const superseded = stillReferenced === 0 ? candidate : null;

      // Re-saving the same post replaces its place set rather than appending,
      // so a re-ingest that extracts fewer places leaves no orphans behind.
      await tx.savedPostPlace.deleteMany({ where: { postId: savedPost.id } });

      // The order the caption named them in, captured before the sort below
      // reorders the writes. `/links` numbers these rows as a route, so the
      // creator's sequence is what has to survive: reading the rows back in
      // insertion order would hand the user the alphabetical order instead,
      // or whatever order the query planner happens to pick.
      //
      // Keyed with the same NUL separator the sort below uses, so a name
      // containing whitespace cannot collide with the next field.
      const captionOrder = new Map(
        matched.map((place, index) => [
          `${place.name} ${place.address}`,
          index,
        ]),
      );

      // Sorting makes the lock acquisition order deterministic across
      // concurrent transactions touching an overlapping set of shared rows.
      // It deliberately does not decide the order the user sees --
      // `position` does.
      const ordered = [...matched].sort((a, b) =>
        `${a.name} ${a.address}`.localeCompare(
          `${b.name} ${b.address}`,
        ),
      );

      const linked = new Set<string>();
      for (const place of ordered) {
        const stored = await tx.place.upsert({
          where: { name_address: { name: place.name, address: place.address } },
          create: {
            name: place.name,
            address: place.address,
            lat: place.lat,
            lng: place.lng,
            category: place.category,
            naverLink: place.naverLink,
          },
          // An existing row is shared with other users' posts; leave it alone.
          update: {},
        });

        // Two distinct queries can resolve to one Naver record, and
        // SavedPostPlace is keyed on [postId, placeId].
        if (linked.has(stored.id)) continue;
        linked.add(stored.id);

        await tx.savedPostPlace.create({
          data: {
            postId: savedPost.id,
            placeId: stored.id,
            // From the queried name/address rather than the loop index:
            // two distinct queries can dedupe to one Place (the `linked`
            // guard above), which would leave gaps in the sequence.
            position:
              captionOrder.get(`${place.name} ${place.address}`) ?? 0,
            memo: place.memo,
          },
        });
      }

      return { savedPost, superseded };
    });

    // After the commit, so a failed update never leaves the row pointing at a
    // blob that no longer exists. Best effort — a leaked blob costs storage,
    // a thrown error would fail a save that already succeeded.
    await deleteThumbnailBlob(saved.superseded);

    return NextResponse.json({ id: saved.savedPost.id }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
