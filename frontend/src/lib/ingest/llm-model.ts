/**
 * The one place the LLM model is chosen.
 *
 * The model is a *tuning value*, not a secret and not a deployment-specific
 * URL, so it lives in TypeScript with the rest of them. That is the rule this
 * repo already follows everywhere else: `CONCURRENCY` in `geocode.ts`,
 * `MAX_ATTEMPTS` here in `extract.ts`, the seven SMS rate limits in `sms.ts`,
 * `SESSION_TTL_MS` in `session.ts` — roughly forty knobs, none of them
 * env-readable. `LLM_MODEL` used to be the only exception.
 */

/**
 * Gemini's tiers, cheapest first. The values are *aliases*, never pinned
 * versions (`gemini-2.5-flash`): a pinned id 404s once Google closes that
 * version to new keys, and the whole point of a named tier is that it keeps
 * pointing at the current model in its class.
 *
 * The ladder is what makes "go one step up" expressible. Without it, raising
 * quality means recalling Google's current alias for the next tier, and typing
 * that from memory is how a silent 404 gets shipped.
 *
 * `deep-think` is deliberately absent. Google does not publish an
 * OpenAI-compatible alias for it, and this task — pulling place names out of a
 * caption under a strict schema — has no use for research-grade reasoning.
 */
export const LLM_MODEL_TIERS = {
  /** Cheapest. Bulk, mechanical work. */
  "flash-lite": "gemini-flash-lite-latest",
  /** Balanced. Agentic workflows, coding, harder extraction. */
  flash: "gemini-flash-latest",
  /**
   * Complex reasoning, creative work.
   *
   * The alias resolves (a bogus name 404s; this one does not), but on a free
   * AI Studio key it answers 429 with `limit: 0` — the free tier grants Pro no
   * requests at all, so this rung needs billing enabled, not just a quieter
   * day. Measured 2026-08-22, when it resolved to gemini-3.1-pro.
   */
  pro: "gemini-pro-latest",
} as const;

export type LlmTier = keyof typeof LLM_MODEL_TIERS;

/**
 * The tier this app runs. Change this line to change the model.
 *
 * Flash-Lite because extraction is not reasoning — under the strict schema it
 * returns the same places from the same captions as Flash — and because the
 * free tier's Flash quota is small enough that starting there would greet a
 * fresh clone with the "quota exhausted" toast.
 *
 * Step up to `flash` when Lite mislabels brands or menu items as places on
 * hard captions; the cost is that quota draining faster. `pro` needs a billed
 * key (see above), so it is not a step you can take on a free one.
 *
 * **Do not move this back to an environment variable.** Two things are lost.
 * The `LlmTier` annotation makes a typo a compile error, where an env string
 * would sail through as a raw model id and 404 at request time. And reading
 * `process.env` here would reintroduce the module-load trap: a value captured
 * in a module-scope `const` outlives a deploy on a warm serverless instance,
 * so the old model keeps going out until that instance recycles. A constant in
 * the source has no such gap — deploying *is* the change.
 */
export const ACTIVE_LLM_TIER: LlmTier = "flash-lite";

/** The model id sent on the wire. */
export const LLM_MODEL: string = LLM_MODEL_TIERS[ACTIVE_LLM_TIER];
