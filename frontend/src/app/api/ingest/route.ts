import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireMember } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { describeError, toErrorResponse } from "@/lib/api";
import { describePost, fetchMetadata } from "@/lib/ingest/metadata";
import { extractPlaces } from "@/lib/ingest/extract";
import { geocodeCandidates } from "@/lib/ingest/geocode";
import { backupThumbnail } from "@/lib/post-thumbnail";
import { backupAuthorImage } from "@/lib/post-author-image";
import { Platform } from "@/generated/prisma/enums";
import type { IngestEvent, IngestResponse } from "@/lib/types";

// Metadata fetch + the model + geocoding runs well past Vercel's 10s default on
// longer captions. The thumbnail backup no longer adds to that total — it runs
// alongside the model rather than ahead of it (see below). Not named for a
// specific provider: extract.ts talks to any OpenAI-compatible endpoint.
export const maxDuration = 60;

/** Matches the cap enforced by POST /api/posts. */
const MAX_PLACES = 20;

const BodySchema = z.object({
  url: z.string().min(1),
  manualCaption: z.string().trim().min(1).max(20_000).optional(),
});

/**
 * Streams NDJSON — one JSON object per line — rather than answering once.
 *
 * The whole pipeline is a single button press that can run tens of seconds on a
 * long Instagram caption, and a lone "읽는 중…" for all of it reads as a hang;
 * the user's only recourse is to press save again. Reporting each stage makes
 * the same wait legible.
 *
 * NDJSON, not SSE: this is a POST with a JSON body that answers once and closes,
 * so EventSource (GET-only) does not apply, and SSE's framing would buy nothing
 * over one object per line.
 *
 * The two rules this shape imposes:
 *
 * 1. Failures travel *inside* the body. The status line is committed with the
 *    first byte, so nothing after that can be a 4xx. The `error` event carries
 *    the same message `toErrorResponse()` would have sent, via the shared
 *    `describeError()`, plus the status it would have used.
 * 2. Authentication and body validation happen *before* the stream opens, so
 *    the ordinary 401/400 stay real status codes — those are the failures a
 *    caller is most likely to handle by status.
 */
export async function POST(request: NextRequest) {
  // Deliberately outside the stream: a 401 here must stay a 401, since an
  // expired session is the failure most likely to be handled by status rather
  // than by message.
  let body: z.infer<typeof BodySchema>;
  try {
    await requireMember();
    body = BodySchema.parse(await request.json());
  } catch (error) {
    return toErrorResponse(error);
  }

  const encoder = new TextEncoder();
  // Set when the reader goes away, so the pipeline can stop at the next stage
  // boundary instead of running to completion for nobody. Not a full abort:
  // threading request.signal into every fetch in metadata/extract/geocode would
  // change all of their signatures, and the in-flight call still finishes. This
  // bounds the waste to one stage rather than the whole 60s budget.
  let aborted = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      aborted = true;
    },
    async start(controller) {
      /**
       * One event per line. Wrapped because a client that has navigated away
       * leaves the controller closed, and enqueueing onto it throws — which
       * would turn an abandoned request into an unhandled rejection rather than
       * the no-op it should be.
       */
      const send = (event: IngestEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The reader is gone; nothing left to report to.
        }
      };

      try {
        const { url, manualCaption } = body;

        send({ type: "progress", stage: "fetching" });

        // Already ingested by whoever saved this link first, so none of the
        // pipeline below has to run again: no crawl of a source that blocks us,
        // no model call, no round of Naver lookups. This short-circuit is the
        // reason Post was split out of the per-member row — the values were
        // always going to be identical, and paying for them a second time only
        // spent the Instagram request budget that gets us blocked.
        //
        // Nothing is written here. The bookmark is created by POST /api/posts,
        // which resolves the same URL to the same row; this route only answers
        // what the confirm sheet needs to render.
        //
        // A manual caption is deliberately not a reason to skip this. The user
        // pastes one because *their* fetch came back empty, but a post already in
        // the table was read successfully by someone — the stored caption is the
        // better of the two, and re-extracting from theirs would produce a second
        // opinion about a shared row this route may not change.
        const known = await findExistingPost(url);
        if (known) {
          send({ type: "result", result: known });
          return;
        }

        // A pasted caption is authoritative: the user supplies it precisely
        // because the fetch came back empty or blocked. On the Instagram retry
        // that means re-fetching would only burn the timeout budget against a
        // source already known to be blocking — but YouTube's API still carries
        // the title and channel, which are stored alongside the caption.
        const described = manualCaption ? describePost(url) : null;
        const metadata =
          described?.platform === Platform.INSTAGRAM
            ? described
            : await fetchMetadata(url);

        const fetched = manualCaption
          ? { ...metadata, caption: manualCaption, needsManualCaption: false }
          : metadata;

        // Instagram thumbnail URLs are signed and expire, so the bytes are
        // copied to our own blob store here and `post.thumbnail` becomes that
        // URL. Done in this route rather than in POST /api/posts on purpose:
        // here the URL is one the server itself just parsed out of Instagram's
        // HTML, whereas at save time it would arrive in the request body — and
        // fetching a URL a client chose is an SSRF sink, which is the same
        // reason POST /api/posts refuses client coordinates and re-geocodes.
        //
        // Started here but deliberately not awaited yet. The backup costs a 6s
        // fetch plus an upload, and nothing downstream reads `thumbnail`:
        // extractPlaces() reads title/caption and geocodeCandidates() reads
        // place names. Awaiting it here put that cost in series ahead of the
        // model and Naver for no reason; running it alongside them hides it
        // behind work that was going to happen anyway.
        //
        // It cannot instead be deferred past the response with after(). The
        // blob URL round-trips through the client into POST /api/posts, which
        // is what writes the row — at this point no row exists to update later,
        // so a deferred backup would mean saving the expiring CDN URL and
        // reintroducing exactly the breakage post-thumbnail.ts prevents.
        //
        // Safe to leave floating across the early return below: neither
        // backupThumbnail() nor backupAuthorImage() rejects (see their
        // contracts), so this can neither throw here nor surface as an
        // unhandled rejection.
        //
        // The author's avatar expires for exactly the same reason the
        // thumbnail does and is copied on the same trip. Sequenced after
        // rather than run in parallel with it: both hit the same Instagram
        // CDN, this one is the less important of the two, and Meta answers a
        // burst from one origin less reliably than two ordered requests. The
        // pair together still overlaps the model and Naver, which is where the
        // cost was actually hiding.
        const backup = backupThumbnail(fetched).then(backupAuthorImage);

        // Nothing downstream to report to; stop before paying for the model.
        if (aborted) return;

        if (fetched.needsManualCaption) {
          // Awaited on this path too, so CaptionPrompt renders the backed-up
          // URL rather than the expiring one. Nothing runs concurrently here —
          // there is no caption to extract from yet — so the cost is unchanged.
          send({
            type: "result",
            result: {
              post: await backup,
              candidates: [],
              needsManualCaption: true,
            },
          });
          return;
        }

        // A map link names one place outright, so there is no prose to read and
        // nothing for the model to infer — going through it would only risk
        // rewriting a name the vendor already gave us verbatim. No `extracting`
        // event for that path: the stage does not run, and reporting a step
        // that is skipped is worse than reporting nothing.
        let extracted;
        if (fetched.place) {
          extracted = [fetched.place];
        } else {
          send({ type: "progress", stage: "extracting" });
          extracted = await extractPlaces({
            title: fetched.title,
            caption: fetched.caption,
          });
        }

        // Checked again: extraction is the longest single stage, so this is
        // where an abandoned request is most likely to have gone away.
        if (aborted) return;

        const targets = extracted.slice(0, MAX_PLACES);
        // Sent before the first lookup so the count appears immediately rather
        // than only once one has already finished.
        send({
          type: "progress",
          stage: "geocoding",
          done: 0,
          total: targets.length,
        });
        // Each candidate costs up to two Naver calls, run at concurrency 3 and
        // served from a shared cache on repeat queries. The cap still matters:
        // it bounds the burst one long caption can aim at the shared client id.
        const candidates = await geocodeCandidates(targets, (done, total) =>
          send({ type: "progress", stage: "geocoding", done, total }),
        );

        // By now the backup has almost certainly finished under the model and
        // geocoding; this is where the remainder, if any, is paid.
        const post = await backup;

        send({
          type: "result",
          result: { post, candidates, needsManualCaption: false },
        });
      } catch (error) {
        // The status line went out with the first progress event, so this
        // cannot be a 4xx any more. describeError() is the same mapping
        // toErrorResponse() uses, so the message the user sees — an
        // unsupported link, an exhausted LLM quota — is identical to what the
        // non-streamed route would have produced.
        const { status, message } = describeError(error);
        send({ type: "error", status, error: message });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by an aborted request.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      // Not application/json: the body is a sequence of JSON values, and
      // labelling it json invites a consumer to JSON.parse() the whole thing.
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Tells a proxy that buffers by default to pass bytes through, without
      // which the progress events arrive together with the result and the
      // whole feature silently does nothing.
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * The ingest result for a link somebody has already saved, or null if new.
 *
 * Returns the shape POST /api/ingest would have produced, assembled from the
 * stored row instead of the network. Every candidate comes back `matched: true`
 * with real coordinates because these places were geocoded once and kept — the
 * confirm sheet renders them exactly as it would a fresh run.
 *
 * `describePost()` rather than the raw string: `sourceUrl` is the identity of the
 * shared row, so the lookup has to use the same canonical form the first save
 * stored — otherwise a tracking parameter would make an existing post look new
 * and the whole pipeline would run for nothing.
 *
 * Unsupported URLs throw out of `describePost()`, which is correct here: this
 * runs before the stream opens, so it still becomes a real 400.
 */
async function findExistingPost(url: string): Promise<IngestResponse | null> {
  const { sourceUrl } = describePost(url);

  const post = await prisma.post.findUnique({
    where: { sourceUrl },
    include: {
      author: true,
      places: { include: { place: true }, orderBy: { position: "asc" } },
    },
  });
  if (!post) return null;

  return {
    post: {
      sourceUrl: post.sourceUrl,
      platform: post.platform,
      title: post.title,
      caption: post.caption,
      thumbnail: post.thumbnail,
      thumbnailSource: post.thumbnailSource,
      author: post.author?.handle ?? null,
      authorImage: post.author?.image ?? null,
      authorImageSource: post.author?.imageSource ?? null,
    },
    candidates: post.places.map(({ place }) => ({
      // The stored name, not the original query: that query was one member's
      // extraction and is not kept. The resolved name is what the row means.
      query: place.name,
      hint: null,
      matched: true,
      lookupFailed: false,
      name: place.name,
      address: place.address,
      lat: place.lat,
      lng: place.lng,
      category: place.category,
      naverLink: place.naverLink,
    })),
    // A stored post has whatever caption the first ingest managed to read. Even
    // if that was null, asking this member to paste one would be asking them to
    // supply input for a row nobody may rewrite.
    needsManualCaption: false,
  };
}
