import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ChevronIcon } from "@/components/ChevronIcon";
import { cn } from "@/lib/utils";

/**
 * `force-dynamic` like its siblings, so the router has nothing to paint on tap
 * without this. Container class matches PasswordSettingPageClient's root.
 *
 * The header markup is duplicated from SettingsHeader rather than importing
 * it, for the same reason /settings/loading.tsx does: it must render without
 * any props tying it to a live back-navigation handler, and matching the
 * shape by hand keeps this file a static skeleton. The back link itself still
 * renders (plain `href="/settings"`, no live handler needed here since this
 * screen's SettingsHeader doesn't use onBackClick either).
 *
 * The title is fixed at 비밀번호 변경 even though the real page says 설정 when
 * no password exists yet: which one applies depends on the very query still in
 * flight, and the alternative is a blank header that shifts once it lands.
 */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <header className="grid grid-cols-[2.5rem_1fr_2.5rem] items-center border-b bg-background py-1">
        <Link
          href="/settings"
          aria-label="설정으로 돌아가기"
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon-lg" }),
            "size-12 rounded-full",
          )}
        >
          <ChevronIcon direction="left" className="h-[15.5px] w-[9px]" />
        </Link>
        <h1 className="text-center text-lg leading-none">비밀번호 변경</h1>
        <span aria-hidden />
      </header>

      <div className="flex flex-col gap-6 px-4">
        <p className="sr-only" role="status">
          불러오는 중입니다.
        </p>

        {/* Shapes the form's first screen: one label, one field, one submit.
            The field mirrors PasswordSettingForm's FIELD; the submit mirrors
            SubmitButton (h-12, rounded-lg) so the real form lands without
            shifting anything. */}
        <div className="flex flex-col gap-6" aria-hidden>
          <div className="flex flex-col gap-2">
            <div className="h-4 w-20 animate-pulse rounded bg-muted" />
            <div className="h-[54px] w-full animate-pulse rounded-[4px] bg-muted" />
          </div>
          <div className="h-12 w-full animate-pulse rounded-lg bg-muted" />
        </div>
      </div>
    </div>
  );
}
