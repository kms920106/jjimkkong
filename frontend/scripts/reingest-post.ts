/**
 * Re-runs the ingest pipeline against specific `Post` rows and rewrites them.
 *
 * **This is the one writer that may modify a `Post` after creation, and it exists
 * because `Post` being immutable everywhere else has a cost that needs an escape
 * hatch.** A post is shared by every member who saves that link, so no request
 * may rewrite it — a re-save must not change what another member sees. The
 * consequence: a post whose first ingest ran while Instagram was blocking us is
 * stuck with what that attempt produced (no thumbnail, no caption, no author),
 * and *no user action can fix it*. Every later member who saves that link gets
 * the degraded row and skips the pipeline entirely, so the damage spreads rather
 * than heals.
 *
 * The route path cannot do this job. Doing it there means "a save may rewrite a
 * shared row", which is the property the split is built on. Doing it here means a
 * human named specific rows and read the diff first.
 *
 * **Ids are required and explicit. There is no "repair everything" mode.** A
 * predicate that selects rows to re-scrape is a predicate that can aim the whole
 * Instagram request budget at Meta in one run, which is how this app gets
 * blocked — the very failure that creates the rows being repaired. Find the
 * candidates with the query below, look at them, then pass the ones you mean.
 *
 *   -- posts a block probably damaged
 *   SELECT p.id, p."sourceUrl", p.thumbnail IS NULL AS no_thumb,
 *          p.caption IS NULL AS no_caption, p."authorId" IS NULL AS no_author,
 *          (SELECT count(*) FROM "PostPlace" WHERE "postId" = p.id) AS places,
 *          (SELECT count(*) FROM "Bookmark" WHERE "postId" = p.id
 *             AND "deletedAt" IS NULL) AS live_saves
 *   FROM "Post" p
 *   WHERE p.platform = 'INSTAGRAM'
 *     AND (p.thumbnail IS NULL OR p.caption IS NULL)
 *   ORDER BY live_saves DESC;
 *
 * Usage:
 *
 *   npx tsx --env-file=.env scripts/reingest-post.ts --dry-run 12 34
 *   npx tsx --env-file=.env scripts/reingest-post.ts 12 34
 *
 * `--dry-run` fetches and prints what would change without writing, which is the
 * intended first step every time: the fetch is the part that can come back empty,
 * and overwriting a usable row with a blocked read would make things worse.
 *
 * **Places are added, never removed.** A re-ingest that extracts fewer places
 * than the row already has is far more likely to be a truncated read than a
 * correction, and removing a `PostPlace` row is not permitted anyway (see
 * prisma-guard.ts — it is not on the allowlist, because nothing in normal
 * operation replaces that set). Positions of existing rows are left alone so a
 * partial re-read cannot renumber a route the creator wrote.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { withDeleteGuard } from "../src/lib/prisma-guard";
import { fetchMetadata } from "../src/lib/ingest/metadata";
import { extractPlaces } from "../src/lib/ingest/extract";
import { geocodeCandidates } from "../src/lib/ingest/geocode";
import { backupThumbnail } from "../src/lib/post-thumbnail";
import { backupAuthorImage } from "../src/lib/post-author-image";
import { isOwnThumbnailBlob } from "../src/lib/post-thumbnail";
import { isOwnAuthorImageBlob } from "../src/lib/post-author-image";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const prisma = withDeleteGuard(raw);

const DRY_RUN = process.argv.includes("--dry-run");
const IDS = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith("--"))
  .map(Number);

/** Between rows, so a multi-row run is not a burst at one CDN. */
const DELAY_MS = 2500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (IDS.length === 0 || IDS.some((id) => !Number.isInteger(id) || id < 1)) {
    console.error(
      "Post id를 하나 이상 넘겨주세요:\n" +
        "  npx tsx --env-file=.env scripts/reingest-post.ts --dry-run 12 34",
    );
    process.exitCode = 1;
    return;
  }

  for (const [index, id] of IDS.entries()) {
    if (index > 0) await sleep(DELAY_MS);

    const post = await prisma.post.findUnique({
      where: { id },
      include: {
        author: true,
        places: { include: { place: true }, orderBy: { position: "asc" } },
        _count: { select: { saves: true } },
      },
    });

    if (!post) {
      console.warn(`Post ${id}: 없는 행. 건너뜁니다.`);
      continue;
    }

    console.log(`\n=== Post ${id} — ${post.sourceUrl}`);
    console.log(
      `  현재: thumbnail=${post.thumbnail ? "있음" : "없음"} ` +
        `caption=${post.caption ? `${post.caption.length}자` : "없음"} ` +
        `author=${post.author?.handle ?? "없음"} ` +
        `places=${post.places.length} saves=${post._count.saves}`,
    );

    const fetched = await fetchMetadata(post.sourceUrl).catch((error) => {
      console.error(`  fetch 실패: ${(error as Error).message}`);
      return null;
    });
    if (!fetched) continue;

    if (fetched.needsManualCaption && !fetched.thumbnail) {
      // The exact state this script exists to repair, arriving again. Writing it
      // would replace a possibly-usable row with a known-empty one.
      console.warn(
        "  차단된 것으로 보입니다(캡션·썸네일 모두 없음). 아무것도 쓰지 않습니다.",
      );
      continue;
    }

    // Same order the ingest route uses: the backup overlaps the model and Naver
    // rather than running ahead of them.
    const backup = backupThumbnail(fetched).then(backupAuthorImage);

    const extracted = fetched.place
      ? [fetched.place]
      : fetched.caption || fetched.title
        ? await extractPlaces({ title: fetched.title, caption: fetched.caption })
        : [];

    const resolved = extracted.length
      ? (await geocodeCandidates(extracted)).filter((place) => place.matched)
      : [];

    const backed = await backup;

    // Only values this run actually produced. `?? existing` everywhere, never
    // `?? null`: a field the fetch did not return is a field this run knows
    // nothing about, and overwriting it with null is the loss this script is
    // meant to prevent.
    const next = {
      title: backed.title ?? post.title,
      caption: backed.caption ?? post.caption,
      thumbnail: backed.thumbnail ?? post.thumbnail,
      thumbnailSource: backed.thumbnail
        ? isOwnThumbnailBlob(backed.thumbnail)
          ? backed.thumbnailSource
          : null
        : post.thumbnailSource,
    };

    const existingNames = new Set(post.places.map((link) => link.place.name));
    const newPlaces = resolved.filter((place) => !existingNames.has(place.name));

    console.log(
      `  새로 얻음: thumbnail=${backed.thumbnail ? "있음" : "없음"} ` +
        `caption=${backed.caption ? `${backed.caption.length}자` : "없음"} ` +
        `author=${backed.author ?? "없음"} ` +
        `places=${resolved.length}(추가 ${newPlaces.length})`,
    );

    if (DRY_RUN) {
      console.log("  --dry-run: 쓰지 않았습니다.");
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const authorId = backed.author
        ? (
            await tx.author.upsert({
              where: {
                platform_handle: {
                  platform: post.platform,
                  handle: backed.author,
                },
              },
              create: {
                platform: post.platform,
                handle: backed.author,
                image: backed.authorImage ?? null,
                imageSource: isOwnAuthorImageBlob(backed.authorImage ?? null)
                  ? (backed.authorImageSource ?? null)
                  : null,
              },
              update: backed.authorImage
                ? {
                    image: backed.authorImage,
                    imageSource: isOwnAuthorImageBlob(backed.authorImage)
                      ? (backed.authorImageSource ?? null)
                      : null,
                  }
                : {},
              select: { id: true },
            })
          ).id
        : post.authorId;

      await tx.post.update({
        where: { id: post.id },
        data: { ...next, authorId },
      });

      // Appended after the highest existing position, so the creator's original
      // ordering is preserved and the additions read as "also mentioned" rather
      // than renumbering the route.
      let position = post.places.reduce(
        (max, link) => Math.max(max, link.position),
        -1,
      );

      for (const place of newPlaces) {
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
          // Shared with other posts; leave it alone.
          update: {},
        });

        position += 1;
        await tx.postPlace.upsert({
          where: { postId_placeId: { postId: post.id, placeId: stored.id } },
          create: { postId: post.id, placeId: stored.id, position },
          // Already linked (two queries resolving to one Place): keep the
          // position it already had.
          update: {},
        });
      }
    });

    console.log("  기록했습니다.");
  }

  await raw.$disconnect();
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
