/**
 * Fills PlaceBlog for the places that were saved before blog reviews existed.
 *
 * Run once, after the PlaceBlog migration is applied:
 *
 *   npx tsx --env-file=.env scripts/backfill-place-blogs.ts
 *
 * Needs NAVER_CLIENT_ID / NAVER_CLIENT_SECRET (the same pair local search uses
 * — see lib/ingest/place-blog.ts on why one pair reaches both endpoints) and
 * DIRECT_URL.
 *
 * ## Why a script and not a runtime path
 *
 * `PlaceBlog` rows are written only inside `place.upsert`'s `create:` branch,
 * because the `Place` row is shared across members and a later save must not
 * change the reviews under someone else's pin. That deliberately leaves no
 * runtime path that can fill a row created before the feature landed: the only
 * way in is a backfill aimed at those rows, which is this.
 *
 * ## The hint is derived, not stored
 *
 * At save time the query is `<hint> <name>`, where the hint is the area the
 * model pulled out of the caption. That value is never persisted — `Place`
 * keeps only `name` and `address` — so this rebuilds an equivalent hint from
 * the address by taking its 시/군/구 token (`서울특별시 마포구 어울마당로 …`
 * -> `마포구`). It is not the same string the model produced, but it plays the
 * same role: without it `런던베이글뮤지엄` returns the 부산, 여의도 and 수원
 * branches mixed together.
 *
 * Not retried unqualified when the hinted query comes back empty, matching
 * findOne() in lib/ingest/place-blog.ts: a name that missed with its district
 * attached tends to match something else entirely, and reviews of the wrong
 * venue are worse than none on a row every member shares.
 *
 * ## Idempotent
 *
 * Candidates are places with no `PlaceBlog` rows at all, and a successful row
 * gets them — so an aborted run is resumed by running it again. A place Naver
 * has nothing for stays a candidate forever, which costs one call per later
 * run rather than a wrong row.
 *
 * Sequential with a delay, because findPlaceBlogs() already parallelises to
 * CONCURRENCY internally and this is a bulk sweep from one client id rather
 * than a single member's save.
 *
 * Options:
 *   --delay-ms=<n>   Pause between places. Default 300.
 *   --limit=<n>      Process at most n places, for a cautious first pass.
 *   --dry-run        Query Naver and report, but write nothing.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { findPlaceBlogs } from "../src/lib/ingest/place-blog";
import { withDeleteGuard } from "../src/lib/prisma-guard";

// Its own client rather than lib/prisma.ts, for the reason the other backfills
// give: that one is wired to the pooled DATABASE_URL and caches itself on
// globalThis for Next's hot reload, neither of which suits a one-shot script.
// The adapter is not optional — the generated client uses engineType "client".
//
// Still wrapped in withDeleteGuard(). A script run by hand against DIRECT_URL
// is the most dangerous client in the repository, not the least.
const prisma = withDeleteGuard(
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
    }),
  }),
);

function numericFlag(name: string, fallback: number): number {
  const raw = process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.split("=")[1];
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const DELAY_MS = numericFlag("delay-ms", 300);
const LIMIT = numericFlag("limit", Number.POSITIVE_INFINITY);
const DRY_RUN = process.argv.includes("--dry-run");

/**
 * The 시/군/구 token of a Korean road address, or null when there is none to
 * find. Matched on the suffix rather than by position because the leading
 * token varies (`서울특별시`, `경기도`, and rows stored as plain `서울`), and a
 * fixed index would hand `경기도` back as the hint for a Suwon address.
 *
 * `구` is checked before `시` so that `성남시 분당구` yields the district, which
 * is the narrower and therefore better hint.
 */
function areaHint(address: string): string | null {
  const tokens = address.split(/\s+/).filter(Boolean);
  for (const suffix of ["구", "군", "시"]) {
    // Length > 1 so a stray one-character token cannot become the hint.
    const found = tokens.find(
      (token) => token.length > 1 && token.endsWith(suffix),
    );
    if (found) return found;
  }
  return null;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
    // findPlaceBlogs() would resolve to empty lists for every place rather than
    // throwing — that contract keeps a save alive, but here it would print a
    // clean run that wrote nothing. Stop instead.
    console.error(
      "NAVER_CLIENT_ID / NAVER_CLIENT_SECRET가 없습니다. 중단합니다.",
    );
    process.exitCode = 1;
    return;
  }

  const candidates = await prisma.place.findMany({
    where: { blogs: { none: {} } },
    select: { id: true, name: true, address: true },
    orderBy: { id: "asc" },
  });

  const targets = Number.isFinite(LIMIT)
    ? candidates.slice(0, LIMIT)
    : candidates;

  console.log(
    `대상 ${targets.length}곳 (블로그 없는 Place 총 ${candidates.length}곳)` +
      (DRY_RUN ? " — dry run, 쓰지 않습니다" : ""),
  );

  let written = 0;
  let empty = 0;

  for (const [index, place] of targets.entries()) {
    const hint = areaHint(place.address);
    // One place at a time: findPlaceBlogs() already runs CONCURRENCY workers,
    // and this is a bulk sweep from a single client id.
    const [entries] = await findPlaceBlogs([{ name: place.name, hint }]);

    const label = `[${index + 1}/${targets.length}] ${place.name}`;

    if (entries.length === 0) {
      empty += 1;
      console.log(`${label} — 결과 없음 (hint=${hint ?? "없음"})`);
    } else if (DRY_RUN) {
      console.log(
        `${label} — ${entries.length}건 (dry run): ${entries[0].title}`,
      );
    } else {
      // createMany rather than a nested write on `place.update`: the parent row
      // must not be touched. It is shared and immutable by design, and this
      // backfill's whole justification is that it adds the missing children
      // without changing anything a member already sees.
      //
      // `position` mirrors the response order, which is newest-first — the same
      // meaning the column has on the save path.
      await prisma.placeBlog.createMany({
        data: entries.map((entry, position) => ({
          placeId: place.id,
          position,
          title: entry.title,
          link: entry.link,
          description: entry.description,
          bloggername: entry.bloggername,
          postdate: entry.postdate,
        })),
      });
      written += 1;
      console.log(`${label} — ${entries.length}건 저장`);
    }

    if (index < targets.length - 1) await sleep(DELAY_MS);
  }

  console.log(
    `\n완료: ${written}곳 저장, ${empty}곳 결과 없음, 남은 후보 ${candidates.length - targets.length}곳`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
