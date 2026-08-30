/**
 * Gate for the place-image feature: does Naver's image search actually answer
 * "what does this place look like?"
 *
 * The place-image plan hangs on two unknowns that no amount of reading the code
 * can settle, so this script settles one of them and makes the other visible:
 *
 *   1. ACCURACY. `/search/v1/image` searches the whole web, not a place
 *      database. Querying "대림창고" may return that cafe, or a warehouse, or a
 *      stock photo of a lumber yard. Nothing in the response says which. The
 *      plan sets a bar of 70% correct-on-first-result, and only a human looking
 *      at the pictures can score that — so this prints the URLs and counts, and
 *      a person decides.
 *
 *   2. HOST SHAPE. The backup step needs a host allowlist, and the plan's whole
 *      SSRF argument rests on `thumbnail` being served from Naver's own
 *      re-host (search.pstatic.net) while `link` points at an arbitrary site.
 *      That claim is load-bearing and is asserted from one documentation
 *      example. This tallies the real hosts of both fields so the allowlist is
 *      written from observation.
 *
 * Read-only: it queries Naver and reads `Place`. It writes nothing, so it is
 * safe to run repeatedly and is idempotent by construction.
 *
 *   npx tsx --env-file=.env scripts/verify-place-image.ts
 *   npx tsx --env-file=.env scripts/verify-place-image.ts --limit=10
 *   npx tsx --env-file=.env scripts/verify-place-image.ts --query="성수동 대림창고"
 *
 * Exits non-zero when the API could not be reached at all, so a failed run is
 * never mistaken for a bad-accuracy verdict.
 */

import { prisma } from "@/lib/prisma";

const ENDPOINT = "https://naverapihub.apigw.ntruss.com/search/v1/image";

/**
 * Same 5s budget geocode.ts gives its lookups. Kept identical on purpose: this
 * measures the latency the save path would actually pay, and a more patient
 * timeout here would report a hit rate the route could not reproduce.
 */
const FETCH_TIMEOUT_MS = 5_000;

/**
 * Serialized with a pause between calls. The reason is the one geocode.ts
 * states for its concurrency limit — Naver rejects bursts from a single client
 * id — and this script is not latency-sensitive, so it takes the simplest
 * shape that cannot trip that.
 */
const DELAY_MS = 300;

const DEFAULT_LIMIT = 30;

type NaverImageItem = {
  title: string;
  link: string;
  thumbnail: string;
  sizeheight: string;
  sizewidth: string;
};

type Probe = {
  /** What we searched for, hint included — the query the route would build. */
  query: string;
  /** The place row this came from, for the human scoring the result. */
  placeName: string;
  address: string;
  category: string | null;
};

type Outcome =
  | { kind: "hit"; item: NaverImageItem; total: number }
  | { kind: "empty" }
  | { kind: "failed"; reason: string };

function arg(name: string): string | null {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "(unparseable)";
  }
}

/**
 * The area hint goes in front, exactly as geocode.ts orders it: "성수동 대림창고"
 * beats "대림창고" because the bare name collides across neighbourhoods. Using a
 * different query shape here would measure a hit rate the route never sees.
 */
function buildQuery(placeName: string, hint: string | null): string {
  return hint ? `${hint} ${placeName}` : placeName;
}

/**
 * Derives the area hint from a stored address the way a save would: the address
 * is what the row has, and its second token is the district. Approximate on
 * purpose — the point is to reproduce the route's query shape, not to be a
 * better geocoder than it.
 */
function hintFromAddress(address: string): string | null {
  const parts = address.split(/\s+/).filter(Boolean);
  return parts.length >= 2 ? parts[1] : null;
}

async function search(query: string): Promise<Outcome> {
  // A different NCP application from the one geocoding uses. Naver enables
  // each API per application, and the search keys this app already holds are
  // scoped to local search only — reusing them here answers 401 "requested API
  // is not enabled for this Application". Two applications therefore means two
  // key pairs, and conflating them makes one of the two calls fail.
  const clientId = process.env.NAVER_IMAGE_CLIENT_ID;
  const clientSecret = process.env.NAVER_IMAGE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "NAVER_IMAGE_CLIENT_ID / NAVER_IMAGE_CLIENT_SECRET are not set",
    );
  }

  const url = new URL(ENDPOINT);
  url.searchParams.set("query", query);
  // One result: the plan stores at most one image per place, so the only
  // number that matters is whether the *top* hit is right. Asking for more
  // would measure a choice the route does not get to make.
  url.searchParams.set("display", "1");
  url.searchParams.set("sort", "sim");
  // Large images only. A place photo that renders in a card or a sheet needs
  // real pixels, and this also filters out icon-sized web clutter that would
  // otherwise inflate the hit count with images too small to use.
  url.searchParams.set("filter", "large");

  try {
    const res = await fetch(url, {
      headers: {
        "X-NCP-APIGW-API-KEY-ID": clientId,
        "X-NCP-APIGW-API-KEY": clientSecret,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        kind: "failed",
        reason: `HTTP ${res.status}${body ? ` ${body.slice(0, 120)}` : ""}`,
      };
    }

    const json = (await res.json()) as {
      total?: number;
      items?: NaverImageItem[];
    };
    const item = json.items?.[0];
    if (!item) return { kind: "empty" };

    return { kind: "hit", item, total: json.total ?? 0 };
  } catch (error) {
    const reason =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : "unknown error";
    return { kind: "failed", reason };
  }
}

async function main() {
  const limit = Number(arg("limit") ?? DEFAULT_LIMIT);
  const oneOff = arg("query");

  const probes: Probe[] = [];

  if (oneOff) {
    probes.push({
      query: oneOff,
      placeName: oneOff,
      address: "(직접 지정한 질의)",
      category: null,
    });
  } else {
    // Real rows, because the question is whether this works for what this app
    // actually saves — Korean cafes and restaurants pulled out of reels — not
    // for landmarks that any image search would find.
    const places = await prisma.place.findMany({
      select: { name: true, address: true, category: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    if (places.length === 0) {
      console.log(
        "저장된 Place 행이 없습니다. --query=<검색어>로 한 건만 시험해 보세요.",
      );
      return;
    }

    for (const place of places) {
      probes.push({
        query: buildQuery(place.name, hintFromAddress(place.address)),
        placeName: place.name,
        address: place.address,
        category: place.category,
      });
    }
  }

  console.log(`\n네이버 이미지 검색 검증 — ${probes.length}건\n`);
  console.log(
    "각 결과의 사진이 그 장소가 맞는지 눈으로 확인하세요. 통과 기준은 70%입니다.\n",
  );

  let hits = 0;
  let empty = 0;
  let failed = 0;
  const linkHosts = new Map<string, number>();
  const thumbnailHosts = new Map<string, number>();
  const latencies: number[] = [];

  for (const [index, probe] of probes.entries()) {
    const started = Date.now();
    const outcome = await search(probe.query);
    const elapsed = Date.now() - started;
    latencies.push(elapsed);

    const label = `[${index + 1}/${probes.length}] ${probe.placeName}`;
    console.log(`${label}`);
    console.log(`  질의     : ${probe.query}`);
    console.log(`  주소     : ${probe.address}`);
    if (probe.category) console.log(`  분류     : ${probe.category}`);

    if (outcome.kind === "failed") {
      failed += 1;
      console.log(`  결과     : 실패 — ${outcome.reason} (${elapsed}ms)\n`);
      continue;
    }

    if (outcome.kind === "empty") {
      empty += 1;
      console.log(`  결과     : 검색 결과 없음 (${elapsed}ms)\n`);
      continue;
    }

    hits += 1;
    const { item, total } = outcome;
    const linkHost = hostOf(item.link);
    const thumbHost = hostOf(item.thumbnail);
    linkHosts.set(linkHost, (linkHosts.get(linkHost) ?? 0) + 1);
    thumbnailHosts.set(thumbHost, (thumbnailHosts.get(thumbHost) ?? 0) + 1);

    console.log(`  제목     : ${stripTags(item.title)}`);
    console.log(`  크기     : ${item.sizewidth}x${item.sizeheight}`);
    console.log(`  총 건수  : ${total.toLocaleString()}`);
    console.log(`  link     : ${item.link}`);
    console.log(`  thumbnail: ${item.thumbnail}`);
    console.log(`  (${elapsed}ms)\n`);

    if (index < probes.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }

  const total = probes.length;
  console.log("─".repeat(64));
  console.log(`\n결과 요약 (${total}건)\n`);
  console.log(`  결과 있음 : ${hits} (${Math.round((hits / total) * 100)}%)`);
  console.log(`  결과 없음 : ${empty}`);
  console.log(`  호출 실패 : ${failed}`);

  if (latencies.length > 0) {
    const sorted = [...latencies].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const slowest = sorted[sorted.length - 1];
    console.log(`\n  지연 중앙값: ${median}ms   최대: ${slowest}ms`);
    // The save path geocodes first and then does this, inside one 60s route.
    // Twenty places at the median is the number the plan said to measure.
    console.log(
      `  장소 20곳 직렬 추정: ${((median * 20) / 1000).toFixed(1)}s (동시성 3이면 약 ${(
        (median * 20) /
        3 /
        1000
      ).toFixed(1)}s)`,
    );
  }

  // The allowlist the backup step will be written against. Printed as observed
  // counts rather than a single example so a rare second host cannot hide.
  if (thumbnailHosts.size > 0) {
    console.log("\n  thumbnail 호스트 (백업 allowlist 후보):");
    for (const [host, count] of [...thumbnailHosts].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${host}  ×${count}`);
    }
  }
  if (linkHosts.size > 0) {
    console.log(
      `\n  link 호스트: ${linkHosts.size}종 — 임의의 웹 호스트이므로 fetch 대상이 아닙니다`,
    );
  }

  console.log("\n" + "─".repeat(64));
  console.log("\n다음 판단은 사람이 합니다:\n");
  console.log("  1. 위 사진들이 실제로 그 장소인가? (정확도 70% 이상이어야 함)");
  console.log("  2. 네이버 검색 API 이용약관이 이미지 저장을 허용하는가?");
  console.log("\n둘 다 통과해야 2단계(스키마)로 넘어갑니다.\n");

  if (failed === total && total > 0) {
    console.error("모든 호출이 실패했습니다. 정확도를 판정할 수 없습니다.");
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
