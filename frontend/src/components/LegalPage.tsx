import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Shared chrome for the two legal documents. A server component on purpose —
 * these pages are static prose with no interaction, so nothing here needs to
 * ship to the browser.
 *
 * The back link goes home rather than using history: these pages are linked
 * from the drawer and from external references (the app store listing, the
 * provider consent screen), so there is often no history to go back to.
 */
export default function LegalPage({
  title,
  effectiveDate,
  children,
}: {
  title: string;
  /** Displayed as-is, so it carries its own "시행일" framing per document. */
  effectiveDate: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
      <header className="flex items-center gap-3">
        <Link
          href="/"
          aria-label="지도로 돌아가기"
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon" }),
            "rounded-full text-muted-foreground",
          )}
        >
          <ChevronLeft aria-hidden />
        </Link>
        <div className="min-w-0">
          <h1 className="text-base font-semibold">{title}</h1>
          <p className="text-xs text-muted-foreground">{effectiveDate}</p>
        </div>
      </header>

      {/* No typography plugin in this project, so the rhythm is set here once
          for every element the documents actually use. */}
      <article
        className={cn(
          "flex flex-col gap-6 text-sm leading-relaxed text-foreground",
          "[&_h2]:text-base [&_h2]:font-semibold",
          "[&_h3]:text-sm [&_h3]:font-semibold",
          "[&_p]:text-muted-foreground",
          "[&_li]:text-muted-foreground",
          "[&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-5",
          "[&_ol]:flex [&_ol]:list-decimal [&_ol]:flex-col [&_ol]:gap-1.5 [&_ol]:pl-5",
          "[&_section]:flex [&_section]:flex-col [&_section]:gap-2.5",
          "[&_a]:underline [&_a]:underline-offset-2",
        )}
      >
        {children}
      </article>
    </div>
  );
}
