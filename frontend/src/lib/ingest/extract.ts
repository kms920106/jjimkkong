import { z } from "zod";

export type PlaceCandidate = {
  name: string;
  /** Neighborhood or city hint that narrows the map search, when mentioned. */
  hint: string | null;
};

/** Thrown when the free-tier quota is exhausted; maps to a 429 for the client. */
export class LlmRateLimitedError extends Error {
  constructor() {
    super("LLM provider rate limit exceeded");
    this.name = "LlmRateLimitedError";
  }
}

const ExtractionSchema = z.object({
  places: z.array(
    z.object({
      name: z.string(),
      hint: z.string().nullable(),
    }),
  ),
});

/**
 * Hand-written JSON Schema mirror of ExtractionSchema, sent as OpenAI
 * `response_format`. Kept strict-mode compatible: every object closes
 * additionalProperties and lists all keys as required.
 */
const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    places: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "장소 이름. 게시글에 적힌 표기를 그대로 사용한다.",
          },
          hint: {
            type: ["string", "null"],
            description: "지역 힌트(동네·구·도시). 언급이 없으면 null.",
          },
        },
        required: ["name", "hint"],
        additionalProperties: false,
      },
    },
  },
  required: ["places"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `너는 소셜 미디어 게시글에서 실제로 방문할 수 있는 장소를 뽑아내는 도구다.

추출 대상: 식당, 카페, 바, 상점, 숙소, 관광지, 전시·공연장처럼 지도에서 찾아 방문할 수 있는 곳.
제외 대상: 브랜드·제품명, 메뉴 이름, 인물·계정 이름, 해시태그 자체, "서울"·"제주" 같은 넓은 행정 구역만 단독으로 언급된 경우.

장소 이름은 한국 지도 검색에 그대로 넣을 수 있는 형태로 적는다. 지역 힌트(동네, 구, 도시)가 본문에 있으면 hint에 담고, 없으면 null로 둔다.
방문 가능한 장소가 없으면 빈 배열을 반환한다. 본문에 없는 장소를 지어내지 않는다.`;

// Gemini's window is far larger than this, but a caption that long is almost
// certainly boilerplate past the first few thousand characters.
const MAX_INPUT_CHARS = 12_000;

// Gemini's latency is bimodal: usually ~2s, but a minority of calls stall for
// well over a minute. Cutting a stalled attempt off and retrying beats waiting.
const ATTEMPT_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_000;

// Gemini's OpenAI-compatibility layer. Any other OpenAI-shaped endpoint works
// by overriding LLM_BASE_URL / LLM_MODEL.
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
// Tracks the current stable flash model. Pinning a version (e.g.
// gemini-2.5-flash) risks a 404 once Google closes it to new keys.
const DEFAULT_MODEL = "gemini-flash-latest";

type ChatCompletionResponse = {
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string;
  }>;
};

/**
 * POSTs the completion request, retrying the transient failures this endpoint
 * produces in normal operation: 5xx overload and slow responses that trip the
 * per-attempt timeout. 429 is not retried — the quota will not clear in
 * seconds, and the caller surfaces it as a distinct message.
 */
async function postWithRetry(
  url: string,
  apiKey: string,
  payload: string,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_BASE_DELAY_MS * attempt),
      );
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: payload,
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        cache: "no-store",
      });

      if (res.status === 429) throw new LlmRateLimitedError();
      if (res.ok) return res;

      const detail = await res.text().catch(() => "");
      const error = new Error(
        `LLM request failed (${res.status}): ${detail.slice(0, 300)}`,
      );
      // 4xx other than 429 is a bad request; retrying sends the same body.
      if (res.status < 500) throw error;
      lastError = error;
    } catch (error) {
      if (error instanceof LlmRateLimitedError) throw error;
      // A timeout (AbortError) or network failure is worth another attempt;
      // anything already classified above is rethrown by the branch that made it.
      if (error instanceof Error && error.message.startsWith("LLM request failed (4")) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("LLM request failed after retries");
}

/**
 * Parses the model's reply, tolerating providers that ignore `response_format`
 * and wrap the JSON in prose or a markdown fence. Returns undefined when
 * nothing parseable is present.
 */
function parseJsonLoosely(content: string): unknown {
  const candidates = [content];

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]);

  // Last resort: the outermost {...} span in the reply.
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(content.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate.trim());
    } catch {
      // try the next shape
    }
  }
  return undefined;
}

/**
 * Extracts visitable place names from a post via any OpenAI-compatible
 * endpoint. Defaults target Google Gemini's compatibility layer, which is free
 * with an AI Studio key; pointing LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
 * elsewhere swaps the provider without a code change.
 */
export async function extractPlaces(input: {
  title: string | null;
  caption: string | null;
}): Promise<PlaceCandidate[]> {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new Error("LLM_API_KEY is not set");

  const text = [input.title, input.caption]
    .filter(Boolean)
    .join("\n\n")
    .trim()
    .slice(0, MAX_INPUT_CHARS);
  if (!text) return [];

  const baseUrl = (process.env.LLM_BASE_URL ?? DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );

  const payload = JSON.stringify({
    model: process.env.LLM_MODEL ?? DEFAULT_MODEL,
    max_tokens: 2048,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: text },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "place_extraction",
        strict: true,
        schema: RESPONSE_JSON_SCHEMA,
      },
    },
    // Gemini 3.x reasons before answering, which on this task adds tens of
    // seconds and can burn the whole output budget before any text is emitted
    // (finish_reason "length" with zero content). Pulling out a place name is
    // extraction, not reasoning, so the budget buys nothing here.
    // Ignored by providers that don't recognize it.
    extra_body: { google: { thinking_config: { thinking_budget: 0 } } },
  });

  const res = await postWithRetry(`${baseUrl}/chat/completions`, apiKey, payload);

  const body = (await res.json()) as ChatCompletionResponse;
  const content = body.choices?.[0]?.message?.content;
  if (!content) return [];

  // Re-validate even under strict json_schema: a provider swap via
  // LLM_BASE_URL may not honor response_format at all.
  const parsed = parseJsonLoosely(content);
  if (parsed === undefined) {
    console.warn(
      `LLM returned unparseable content: ${content.slice(0, 200)}`,
    );
    return [];
  }
  const result = ExtractionSchema.safeParse(parsed);
  if (!result.success) {
    console.warn(
      `LLM response did not match the expected shape: ${content.slice(0, 200)}`,
    );
    return [];
  }

  // Same place mentioned twice in one caption should surface once.
  const seen = new Set<string>();
  return result.data.places
    .map((place) => ({
      name: place.name.trim(),
      hint: place.hint?.trim() || null,
    }))
    .filter((place) => {
      if (!place.name) return false;
      const key = place.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
