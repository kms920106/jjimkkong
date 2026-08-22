"use client";

import { useState } from "react";

import { Progress as ProgressPrimitive } from "@base-ui/react/progress";

import { ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type Props = {
  /**
   * How far along the pipeline is, 0–100, or null when nothing is in flight.
   *
   * Null does not unmount the bar — the track stays in the layout so the sheet
   * does not jump by its own height the moment a save starts.
   */
  value: number | null;
  className?: string;
};

/** Clamped into the primitive's 0–100 range; null reads as empty. */
function clamp(value: number | null): number {
  if (value === null) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * The thin bar across the top of the URL sheet and the caption prompt.
 *
 * It exists because the wait the user is actually trapped in is the *ingest*,
 * not the save: the sheet stays up for the whole fetch → LLM → geocode round,
 * which runs to tens of seconds on a long caption, and the only thing moving
 * was the submit button's label. A label that changes three times in forty
 * seconds reads as a frozen screen between the changes.
 *
 * There is no bar for the save step on purpose. By then the sheet has closed
 * and the optimistic pins are on the map; a second progress indicator there
 * would contradict the whole reason the sheet closes early.
 *
 * ## Never runs backwards
 *
 * The displayed value is latched to its own maximum. Stages can revisit an
 * earlier fraction — the caption-prompt retry re-enters the pipeline at
 * `fetching`, and `geocoding` reports `done/total` against a total that is
 * only known once that stage begins — and a bar that retreats does not read
 * as "still working", it reads as "it failed and started over".
 *
 * The latch resets when `value` goes null, which is what separates one run
 * from the next: a retry after a failure must be able to start from empty.
 *
 * The latch is kept by adjusting state during render against the previous
 * `value`, React's documented pattern for state derived from props. An effect
 * would be wrong twice over: it is not synchronising an external system, and
 * it would paint the stale width for a frame before correcting it.
 */
export default function IngestProgressBar({ value, className }: Props) {
  const [shown, setShown] = useState(() => clamp(value));
  const [lastValue, setLastValue] = useState(value);

  if (value !== lastValue) {
    setLastValue(value);
    // A run ending drops the latch so the next one starts from empty; while
    // one is in flight the bar only ever moves forward.
    setShown(value === null ? 0 : Math.max(shown, clamp(value)));
  }

  const active = value !== null;

  return (
    // ProgressPrimitive.Root rather than the styled `Progress` wrapper: that
    // wrapper renders a track of its own *after* whatever children it is
    // given, so passing a track to it would draw two. The wrapper's real job
    // is the label/value row this bar has no use for; the track and indicator
    // it composes are imported directly and keep their shadcn styling.
    <ProgressPrimitive.Root
      // Always a number, never the primitive's null: null is its
      // *indeterminate* state, which animates a sliding block. Idle here means
      // "nothing is happening", so it renders an empty track instead.
      value={shown}
      // Progress is announced by the submit button's own stage label, which is
      // real text and says what is happening rather than how far along it is.
      // Leaving the primitive's progressbar role in place would have a screen
      // reader read out a percentage on top of that, and the percentage is a
      // rough weighting of pipeline stages — not a quantity worth announcing.
      aria-hidden
      role="presentation"
      className={cn("block", className)}
    >
      <ProgressTrack
        className={cn(
          "h-0.5",
          // The track is kept in the layout while idle so starting a save does
          // not shift the sheet's contents down by the bar's height.
          !active && "bg-transparent",
        )}
      >
        {/* Slower than the primitive's default so a jump between two stage
            weights reads as movement rather than as a snap. */}
        <ProgressIndicator className="duration-500 ease-out" />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  );
}
