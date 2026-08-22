import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The one full-width primary action at the bottom of a form.
 *
 * It exists because every such button in the app has to look identical and the
 * shape is not expressible as a `Button` variant: `size` controls height and
 * padding but not width, so `w-full` had to be repeated at every call site and
 * drifted — `/profile` used `h-12 text-base`, the phone drawers `h-auto py-3`,
 * and `/settings/password` a hand-rolled crimson `<button>` that skipped
 * `Button` entirely. Three different bottom buttons for the same affordance.
 *
 * Deliberately not a `size` variant: a variant would still let a caller pass
 * `size="lg"` to a form's submit and get the compact shape back. Naming the
 * role instead of the metrics means the only way to get this button is to mean
 * this button.
 *
 * The disabled state stays `Button`'s `opacity-50` over the near-black primary.
 * The password screens previously expressed "not ready" as a *different* colour
 * (muted rose vs. saturated crimson), which read as a second brand rather than
 * one disabled state, and nothing else in the app does that.
 */
function SubmitButton({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button className={cn("h-12 w-full text-base", className)} {...props} />
  );
}

export { SubmitButton };
