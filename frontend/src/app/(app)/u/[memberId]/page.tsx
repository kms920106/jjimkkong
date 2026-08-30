import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { publicListsOf } from "@/lib/place-list";
import { BackHeader } from "@/components/BackHeader";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

// Reads no session, but the underlying rows change per request.
export const dynamic = "force-dynamic";

/**
 * One member's public lists — the design's 공개 리스트 목록.
 *
 * Only `PUBLIC` lists appear, which `publicListsOf()` enforces. A `LINK` list
 * is reachable by its URL and must never be enumerated here: sharing one list
 * with one person is not a decision to publish a directory of everything the
 * member has ever shared. That distinction is the only thing separating the two
 * visibility values, so collapsing them here would quietly delete the feature.
 *
 * The page renders for a member with zero public lists rather than 404ing —
 * "this person publishes nothing" is a truthful answer, and 404ing instead
 * would let a caller enumerate which member ids have published anything.
 */
export default async function PublicProfilePage(
  props: PageProps<"/u/[memberId]">,
) {
  const memberId = Number((await props.params).memberId);
  if (!Number.isInteger(memberId) || memberId < 1) notFound();

  const member = await prisma.member.findFirst({
    // Withdrawn accounts are excluded for the same reason every other lookup
    // excludes them: withdrawal keeps the row, so without this filter a
    // withdrawn member's lists would stay published after they left.
    where: { id: memberId, withdrawnAt: null },
    select: { nickname: true, imageUrl: true },
  });
  if (!member) notFound();

  const lists = await publicListsOf(memberId);

  // Never the email's local part, which is what `displayName()` falls back to
  // elsewhere — that helper is for the member's own drawer. This page is read
  // by strangers, and an email fragment is not something the member chose to
  // publish.
  const name = member.nickname ?? "찜꽁 사용자";

  return (
    <div className="flex w-full flex-col gap-4">
      <BackHeader href="/" ariaLabel="홈으로" title="공개 리스트 목록" />

      <div className="flex items-center gap-3 px-4">
        <Avatar className="size-16">
          {member.imageUrl && <AvatarImage src={member.imageUrl} alt="" />}
          <AvatarFallback>{name.slice(0, 1)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="truncate text-xl font-semibold">{name}</p>
          <p className="text-sm text-muted-foreground">
            공개 리스트 <span className="tabular-nums">{lists.length}</span>
          </p>
        </div>
      </div>

      {lists.length === 0 ? (
        <p className="px-4 py-16 text-center text-sm text-muted-foreground">
          아직 공개한 리스트가 없어요.
        </p>
      ) : (
        <ul className="px-4">
          {lists.map((list) => (
            <li key={list.seq}>
              <Link
                href={`/u/${memberId}/${list.seq}`}
                className="flex items-center gap-3 border-b py-4"
              >
                <span
                  aria-hidden
                  className="size-11 shrink-0 rounded-full"
                  style={{ backgroundColor: list.color }}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium">{list.name}</span>
                  {list.description && (
                    <span className="truncate text-xs text-muted-foreground">
                      {list.description}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {list.count}개
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export async function generateMetadata(props: PageProps<"/u/[memberId]">) {
  const memberId = Number((await props.params).memberId);
  if (!Number.isInteger(memberId) || memberId < 1) return { title: "찜꽁" };
  const member = await prisma.member.findFirst({
    where: { id: memberId, withdrawnAt: null },
    select: { nickname: true },
  });
  return {
    title: member ? `${member.nickname ?? "찜꽁 사용자"}의 공개 리스트 · 찜꽁` : "찜꽁",
  };
}
