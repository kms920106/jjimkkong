"use client";

import { SettingsHeader } from "@/components/SettingsHeader";
import { useBackLink } from "@/lib/use-back-link";

/**
 * SettingsHeader with the history-pop back link already wired up, for pages
 * that are server components and therefore cannot call useBackLink themselves.
 *
 * /links and /links/[id] don't use this — they are client components for other
 * reasons and call the hook directly. This exists because /author/[id] is a
 * plain server component, and rendering SettingsHeader there *without* the hook
 * is precisely the bug useBackLink was written to fix: a pushed back link grows
 * the history instead of unwinding it, so `/links` → `/links/9` → `/author/4` →
 * back lands on a freshly pushed `/links` and the next back goes *forward* to
 * `/author/4`. See useBackLink for why popping is both correct and cheaper.
 *
 * Any future server-rendered page with a back arrow into another app page
 * should use this rather than SettingsHeader directly.
 */
export function BackHeader({
  href,
  ariaLabel,
  title,
}: {
  href: string;
  ariaLabel: string;
  title: string;
}) {
  const { onBackClick } = useBackLink();

  return (
    <SettingsHeader
      href={href}
      ariaLabel={ariaLabel}
      title={title}
      onBackClick={onBackClick}
    />
  );
}
