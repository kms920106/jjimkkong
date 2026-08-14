import type { PlaceCandidate } from "./extract";

export type GeocodedCandidate = {
  /** Model-extracted name; re-sent to /api/posts as the search term on save. */
  query: string;
  /** Area hint the model found, needed to re-run this lookup on save. */
  hint: string | null;
  matched: boolean;
  /**
   * True when the lookup itself failed (timeout, quota, 5xx) rather than
   * returning no result — the UI must not tell the user the place is absent
   * from the map when the service was simply unreachable.
   */
  lookupFailed: boolean;
  name: string;
  address: string;
  lat: number;
  lng: number;
  category: string | null;
  naverLink: string | null;
};

type NaverLocalItem = {
  title: string;
  link?: string;
  category?: string;
  address?: string;
  roadAddress?: string;
  mapx?: string;
  mapy?: string;
};

const ENDPOINT = "https://naverapihub.apigw.ntruss.com/search/v1/local";
const FETCH_TIMEOUT_MS = 5_000;

class LookupFailedError extends Error {
  constructor() {
    super("Naver local search is unavailable");
    this.name = "LookupFailedError";
  }
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

/**
 * Local Search returns mapx/mapy as WGS84 degrees scaled by 1e7 (e.g.
 * "1270276368" -> 127.0276368). Older docs describe a KATECH projection; that
 * format is no longer returned by this endpoint.
 */
function toDegrees(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n / 1e7;
}

/** Resolves to the top hit, null when there is genuinely no match. */
async function search(query: string): Promise<NaverLocalItem | null> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("NAVER_CLIENT_ID / NAVER_CLIENT_SECRET are not set");
  }

  const url = new URL(ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("display", "1");

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "X-NCP-APIGW-API-KEY-ID": clientId,
        "X-NCP-APIGW-API-KEY": clientSecret,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new LookupFailedError();
  }

  // 429 and 5xx mean "ask again later", not "this place does not exist".
  if (!res.ok) throw new LookupFailedError();

  const body = (await res.json()) as { items?: NaverLocalItem[] };
  return body.items?.[0] ?? null;
}

async function geocodeOne(
  candidate: PlaceCandidate,
): Promise<GeocodedCandidate> {
  const base = {
    query: candidate.name,
    hint: candidate.hint,
    matched: false,
    lookupFailed: false,
    name: candidate.name,
    address: "",
    lat: 0,
    lng: 0,
    category: null,
    naverLink: null,
  } satisfies GeocodedCandidate;

  // Try the hint-qualified query first — "성수동 대림창고" beats "대림창고"
  // when the same name exists in several neighborhoods.
  const queries = candidate.hint
    ? [`${candidate.hint} ${candidate.name}`, candidate.name]
    : [candidate.name];

  let sawFailure = false;

  for (const query of queries) {
    let item: NaverLocalItem | null;
    try {
      item = await search(query);
    } catch (error) {
      if (error instanceof LookupFailedError) {
        // Fall through to the un-hinted query — one hiccup should not discard
        // the attempt that was more likely to match anyway.
        sawFailure = true;
        continue;
      }
      throw error;
    }
    if (!item) continue;

    const lng = toDegrees(item.mapx);
    const lat = toDegrees(item.mapy);
    if (lat === null || lng === null) continue;

    return {
      ...base,
      matched: true,
      name: stripTags(item.title) || candidate.name,
      address: item.roadAddress || item.address || "",
      lat,
      lng,
      category: item.category || null,
      naverLink: item.link || null,
    };
  }

  return { ...base, lookupFailed: sawFailure };
}

export async function geocodeCandidates(
  candidates: PlaceCandidate[],
): Promise<GeocodedCandidate[]> {
  const results: GeocodedCandidate[] = [];
  // Sequential: Naver's local search rejects bursts from one client id, and a
  // handful of candidates per post is well inside the latency budget.
  for (const candidate of candidates) {
    results.push(await geocodeOne(candidate));
  }
  return results;
}
