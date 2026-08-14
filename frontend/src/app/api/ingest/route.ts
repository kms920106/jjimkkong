import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/api";
import { describePost, fetchMetadata } from "@/lib/ingest/metadata";
import { extractPlaces } from "@/lib/ingest/extract";
import { geocodeCandidates } from "@/lib/ingest/geocode";
import { Platform } from "@/generated/prisma/enums";

// Metadata fetch + Claude extraction + geocoding runs well past Vercel's
// 10s default on longer captions.
export const maxDuration = 60;

/** Matches the cap enforced by POST /api/posts. */
const MAX_PLACES = 20;

const BodySchema = z.object({
  url: z.string().min(1),
  manualCaption: z.string().trim().min(1).max(20_000).optional(),
});

export async function POST(request: NextRequest) {
  try {
    await requireUser();

    const { url, manualCaption } = BodySchema.parse(await request.json());

    // A pasted caption is authoritative: the user supplies it precisely
    // because the fetch came back empty or blocked. On the Instagram retry
    // that means re-fetching would only burn the timeout budget against a
    // source already known to be blocking — but YouTube's API still carries
    // the title and channel, which are stored alongside the caption.
    const described = manualCaption ? describePost(url) : null;
    const metadata =
      described?.platform === Platform.INSTAGRAM ? described : await fetchMetadata(url);

    const post = manualCaption
      ? { ...metadata, caption: manualCaption, needsManualCaption: false }
      : metadata;

    if (post.needsManualCaption) {
      return NextResponse.json({
        post,
        candidates: [],
        needsManualCaption: true,
      });
    }

    const extracted = await extractPlaces({
      title: post.title,
      caption: post.caption,
    });
    // Each candidate costs up to two sequential Naver calls; cap the fan-out
    // so one long caption cannot exhaust the shared client-id quota.
    const candidates = await geocodeCandidates(extracted.slice(0, MAX_PLACES));

    return NextResponse.json({ post, candidates, needsManualCaption: false });
  } catch (error) {
    return toErrorResponse(error);
  }
}
