import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ChevronIcon } from "@/components/ChevronIcon";
import { cn } from "@/lib/utils";

/**
 * Shared header chrome for /settings, /settings/password, and /links: a back
 * link, fixed icon size, and a centred title (a third, empty column balances
 * the back button so the title sits at the true centre). Keeping this in one
 * place means a px change lands on every screen at once instead of drifting
 * between them.
 */
export function SettingsHeader({
  href,
  ariaLabel,
  title,
  onBackClick,
}: {
  href: string;
  ariaLabel: string;
  title: string;
  /**
   * Optional interception for the back link's click, e.g. /links' history-pop
   * optimisation. Call `event.preventDefault()` inside to take over navigation
   * — Link's own href stays as the fallback for modified clicks and when the
   * caller declines to preventDefault.
   */
  onBackClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const backLink = (
    <Link
      href={href}
      aria-label={ariaLabel}
      onClick={onBackClick}
      className={cn(
        buttonVariants({ variant: "ghost", size: "icon-lg" }),
        "size-12 rounded-full",
      )}
    >
      {/* Exact arbitrary values, not a scale class — the source PNG only
          reads as the design's slim arrow at its native 9:15.5 ratio. */}
      <ChevronIcon direction="left" className="h-[15.5px] w-[9px]" />
    </Link>
  );

  return (
    <header className="grid grid-cols-[2.5rem_1fr_2.5rem] items-center border-b bg-background py-1">
      {backLink}
      <h1 className="text-center text-lg leading-none">{title}</h1>
      {/* Balances the back button so the title sits at the true centre. */}
      <span aria-hidden />
    </header>
  );
}
