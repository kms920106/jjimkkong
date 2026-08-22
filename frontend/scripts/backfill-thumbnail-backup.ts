/**
 * Backs up the Instagram thumbnails of posts saved before the backup existed.
 *
 * Run once, after the `saved_post_thumbnail_backup` migration has been applied
 * and the code that reads `thumbnailSource` is deployed:
 *
 *   npx tsx --env-file=.env scripts/backfill-thumbnail-backup.ts
 *
 * Needs BLOB_READ_WRITE_TOKEN (the store the app writes to) and DIRECT_URL.
 * Without the token every row is skipped, which is a wasted run rather than a
 * harmful one.
 *
 * ## Why re-scraping is unavoidable
 *
 * The stored URLs are `scontent-*.cdninstagram.com` signed URLs whose signature
 * has already expired — fetching one returns `403 URL signature expired`, and no
 * amount of retrying re-signs it. The only way to get bytes is to read the post
 * page again for a fresh og:image, so this goes back through fetchMetadata()
 * rather than hitting the dead URL.
 *
 * That means one Instagram request per row, from a crawler UA we are not
 * entitled to. Hence: sequential, with a delay between rows, and a hard stop
 * after five consecutive block-shaped failures.
 *
 * Idempotent: only rows with `thumbnailSource IS NULL` are candidates, and a
 * success sets it — so a partial or aborted run is resumed by running it again.
 * Nothing is destroyed either way; a skipped row keeps the broken thumbnail it
 * already had.
 *
 * Options:
 *   --delay-ms=<n>   Pause between rows. Default 2500.
 *   --limit=<n>      Process at most n rows, for a cautious first pass.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { Platform } from "../src/generated/prisma/enums";
import { fetchMetadata } from "../src/lib/ingest/metadata";
import { fetchAndPutThumbnail } from "../src/lib/post-thumbnail";
import { withDeleteGuard } from "../src/lib/prisma-guard";

// Its own client rather than lib/prisma.ts: that one is wired to the pooled
// DATABASE_URL and caches itself on globalThis for Next's hot reload, neither of
// which suits a one-shot script. The adapter is not optional — the generated
// client uses engineType "client", which has no native engine to fall back on.
//
// Still wrapped in withDeleteGuard(). A one-shot script run by hand against
// DIRECT_URL is the *most* dangerous client in the repository, not the least:
// it holds the direct connection and nothing reviews what it does. Skipping the
// guard here would leave the widest gap exactly where it matters.
const prisma = withDeleteGuard(
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
    }),
  }),
);

/**
 * How many rows in a row may fail to yield a thumbnail before this gives up.
 *
 * A block and a deleted post look the same from here — Instagram answers a
 * blocked crawler with its logged-out shell, which fetchInstagram reports as
 * "no thumbnail" rather than an error. So both shapes count, and the stop is
 * the only thing standing between a systematic block and a full-table walk of
 * unentitled requests. Stopping costs nothing: the run is idempotent and
 * resumes where it left off.
 */
const MAX_CONSECUTIVE_BLOCKS = 5;

type SkipReason =
  // The post page no longer yields an image — deleted post, private account, or
  // a shape change in the scraper.
  | "no_thumbnail"
  // Fetched an image but could not store it. The token, the size cap, the
  // format check; lib/post-thumbnail.ts logged the specific cause.
  | "backup_failed"
  // fetchMetadata threw. Counts toward the consecutive-block stop.
  | "fetch_error";

type Candidate = { id: string; sourceUrl: string };

function numericFlag(name: string, fallback: number): number {
  const raw = process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.split("=")[1];
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const delayMs = numericFlag("delay-ms", 2_500);
  const limit = numericFlag("limit", 0);

  // Saying so beats a raw `column "thumbnailSource" does not exist` from the
  // driver — this script is most likely to be run by someone checking whether
  // the migration landed.
  const [{ present }] = await prisma.$queryRaw<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'SavedPost' AND column_name = 'thumbnailSource'
    ) AS present
  `;
  if (!present) {
    console.error(
      "SavedPost.thumbnailSource 컬럼이 없습니다. 먼저 마이그레이션을 적용하세요: npm run db:deploy",
    );
    process.exitCode = 1;
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error(
      "BLOB_READ_WRITE_TOKEN이 없습니다. 이 토큰 없이는 모든 행을 건너뛰게 됩니다.",
    );
    process.exitCode = 1;
    return;
  }

  const rows = await prisma.savedPost.findMany({
    where: {
      platform: Platform.INSTAGRAM,
      // The predicate for "not yet backed up". Deliberately not a string match
      // on the blob host, which would misjudge every row if that host changed.
      thumbnailSource: null,
      // Only rows that *had* a thumbnail. Filling in ones that never had one
      // would mean more Instagram requests for a UX improvement, not a repair —
      // and more requests is exactly what raises the odds of being blocked.
      thumbnail: { not: null },
      // A withdrawn account's posts are unreachable in the app, so spending
      // Instagram requests and storage on them buys nothing.
      user: { withdrawnAt: null },
    },
    select: { id: true, sourceUrl: true },
    orderBy: { createdAt: "asc" },
    ...(limit > 0 ? { take: limit } : {}),
  });

  if (rows.length === 0) {
    console.log("변환할 행이 없습니다.");
    return;
  }

  console.log(
    `${rows.length}개 행을 처리합니다. (행당 ${delayMs}ms 지연, 순차 실행)`,
  );

  let backedUp = 0;
  let consecutiveBlocks = 0;
  const skipped: Array<Candidate & { reason: SkipReason }> = [];

  for (const [index, row] of rows.entries()) {
    // Before the request, not after, so the first row is not delayed and an
    // early abort has not paid for a pause it did not need.
    if (index > 0 && delayMs > 0) await sleep(delayMs);

    let freshThumbnail: string | null;
    try {
      // Through fetchMetadata rather than a hand-rolled scrape: the embed →
      // og:description fallback, the crawler UA, the timeouts and the failure
      // logging are all already proven there. The caption it also returns is
      // ignored — re-extracting places is a different job, and doing it here
      // would drag geocoding into a repair script.
      const metadata = await fetchMetadata(row.sourceUrl);
      freshThumbnail = metadata.thumbnail;
    } catch (cause) {
      skipped.push({ ...row, reason: "fetch_error" });
      consecutiveBlocks += 1;
      console.warn(
        `  건너뜀 ${row.id}: 게시글을 읽지 못했습니다 (${
          cause instanceof Error ? cause.message : String(cause)
        })`,
      );
      if (consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) {
        console.warn(
          `\n연속 ${MAX_CONSECUTIVE_BLOCKS}회 실패했습니다. 조직적 차단으로 보고 중단합니다 — ` +
            "잠시 후 다시 실행하면 남은 행부터 이어서 처리합니다.",
        );
        break;
      }
      continue;
    }

    if (!freshThumbnail) {
      // Counted toward the stop, not treated as a benign miss. From here a
      // block is indistinguishable from a deleted post: fetchInstagram does
      // not throw when Instagram serves its logged-out shell — it falls
      // through to the og:tags path and returns thumbnail: null. If only
      // thrown errors counted, a systematic block would walk the whole table
      // making exactly the request volume this script exists to avoid.
      skipped.push({ ...row, reason: "no_thumbnail" });
      consecutiveBlocks += 1;
      if (consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) {
        console.warn(
          `\n연속 ${MAX_CONSECUTIVE_BLOCKS}회 썸네일을 얻지 못했습니다. 조직적 차단으로 보고 중단합니다 — ` +
            "잠시 후 다시 실행하면 남은 행부터 이어서 처리합니다.",
        );
        break;
      }
      continue;
    }

    const stored = await fetchAndPutThumbnail(freshThumbnail);
    if (!stored) {
      // lib/post-thumbnail.ts already logged the specific reason.
      skipped.push({ ...row, reason: "backup_failed" });
      consecutiveBlocks = 0;
      continue;
    }

    await prisma.savedPost.update({
      where: { id: row.id },
      // The old `thumbnail` was Instagram's URL, never a blob of ours, so
      // there is nothing to delete as it is replaced.
      data: { thumbnail: stored, thumbnailSource: freshThumbnail },
    });
    backedUp += 1;
    consecutiveBlocks = 0;
    console.log(`  ${backedUp}/${rows.length} ${row.id}`);
  }

  console.log(`\n완료: ${backedUp}개 백업.`);

  if (skipped.length > 0) {
    // Informational, not alarming: unlike the phone backfill, nothing here is
    // about to become unrecoverable. A skipped row still has the broken
    // thumbnail it started with, and the run can simply be repeated.
    const byReason = new Map<SkipReason, Candidate[]>();
    for (const row of skipped) {
      const list = byReason.get(row.reason) ?? [];
      list.push(row);
      byReason.set(row.reason, list);
    }

    console.log(`건너뜀: ${skipped.length}개. 다시 실행하면 재시도합니다.`);
    for (const [reason, list] of byReason) {
      console.log(`\n  [${reason}] ${list.length}개`);
      for (const row of list) console.log(`    ${row.id} ${row.sourceUrl}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
