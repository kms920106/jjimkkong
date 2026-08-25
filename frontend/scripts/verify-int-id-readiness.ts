/**
 * Pre-flight check for the 20260825120000_int_ids migration.
 *
 * That migration renumbers every remaining primary key, and it refuses to run
 * while `Session` holds rows — its id rides inside a signed cookie, so
 * renumbering it would leave live cookies resolving to *other members'* rows.
 * The migration's own guard catches that, but only after it has already added
 * and populated columns, and only as a Postgres exception. This says the same
 * thing beforehand, in sentences, before anything is written.
 *
 * PhoneVerification and PasswordAttempt are reported but not enforced: neither
 * has a foreign key, so their rows cannot affect the renumbering. Emptying them
 * avoids one wasted SMS per in-flight phone challenge and nothing more.
 *
 * Read-only. It counts rows and inspects the catalog; it writes nothing and
 * deletes nothing. Emptying the three tables is a manual step by design (the
 * pre-tool hook refuses row destruction in a migration, and withDeleteGuard()
 * refuses it from application code) — this only reports whether it has been
 * done.
 *
 *   npx tsx --env-file=.env scripts/verify-int-id-readiness.ts
 *
 * Exits non-zero when the migration would fail, so it can gate a deploy.
 */

import { prisma } from "@/lib/prisma";

type Check = { label: string; ok: boolean; detail: string };

async function main() {
  const checks: Check[] = [];

  // 1. Has it already been applied? Answering this first stops the rest of the
  //    output from looking alarming on a database that is already converted.
  const [{ applied }] = await prisma.$queryRawUnsafe<{ applied: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM "_prisma_migrations"
       WHERE migration_name = '20260825120000_int_ids' AND finished_at IS NOT NULL
     ) AS applied`,
  );

  if (applied) {
    console.log("이 마이그레이션은 이미 적용되었습니다. 확인할 것이 없습니다.");
    return;
  }

  // 2. The prerequisite: the three tables the migration insists are empty.
  const [counts] = await prisma.$queryRawUnsafe<
    { sessions: number; verifications: number; attempts: number }[]
  >(
    `SELECT (SELECT count(*)::int FROM "Session")           AS sessions,
            (SELECT count(*)::int FROM "PhoneVerification") AS verifications,
            (SELECT count(*)::int FROM "PasswordAttempt")   AS attempts`,
  );
  // Session is the only hard requirement: its id is renumbered while the cookie
  // carrying that id stays in the browser. The other two have no foreign key,
  // so their rows cannot affect the renumbering — reported as advice, not as a
  // blocker, because failing on them would forbid the safest deploy order.
  checks.push({
    label: "Session이 비어 있는지 (필수)",
    ok: counts.sessions === 0,
    detail:
      counts.sessions === 0
        ? "비어 있습니다."
        : `${counts.sessions}행. 마이그레이션 전에 손으로 비워야 합니다 — ` +
          `id가 다시 매겨지므로 기존 쿠키가 다른 회원의 행을 가리킵니다. ` +
          `로그인된 ${counts.sessions}명이 로그아웃되고, 재진입은 SMS rate limit을 지납니다.`,
  });

  const advisory = counts.verifications + counts.attempts;
  console.log(
    advisory === 0
      ? "참고: PhoneVerification·PasswordAttempt도 비어 있습니다.\n"
      : `참고: PhoneVerification ${counts.verifications}행, PasswordAttempt ${counts.attempts}행이 ` +
        "남아 있습니다. FK가 없어 마이그레이션을 막지는 않습니다 — 비우면 진행 중인 휴대폰 인증이 " +
        "SMS 한 통을 더 쓰는 일을 피할 수 있습니다(쿠키 TTL 10분).\n",
  );

  // 3. Orphans. Every foreign key is dropped and recreated, so a row pointing at
  //    a missing parent — tolerated today only if a constraint were ever
  //    disabled — would fail the recreation halfway through.
  const orphans = await prisma.$queryRawUnsafe<{ what: string; n: number }[]>(
    `SELECT 'PostPlace.placeId' AS what, count(*)::int AS n FROM "PostPlace" pp
       LEFT JOIN "Place" p ON p.id = pp."placeId" WHERE p.id IS NULL
     UNION ALL SELECT 'BookmarkMemo.placeId', count(*)::int FROM "BookmarkMemo" bm
       LEFT JOIN "Place" p ON p.id = bm."placeId" WHERE p.id IS NULL
     UNION ALL SELECT 'BookmarkMemo.bookmarkId', count(*)::int FROM "BookmarkMemo" bm
       LEFT JOIN "Bookmark" b ON b.id = bm."bookmarkId" WHERE b.id IS NULL
     UNION ALL SELECT 'Bookmark.memberId', count(*)::int FROM "Bookmark" b
       LEFT JOIN "Member" m ON m.id = b."memberId" WHERE m.id IS NULL
     UNION ALL SELECT 'AuthIdentity.memberId', count(*)::int FROM "AuthIdentity" a
       LEFT JOIN "Member" m ON m.id = a."memberId" WHERE m.id IS NULL`,
  );
  const bad = orphans.filter((row) => row.n > 0);
  checks.push({
    label: "부모가 없는 자식 행이 없는지",
    ok: bad.length === 0,
    detail:
      bad.length === 0
        ? `${orphans.length}개 관계 전부 0건.`
        : bad.map((row) => `${row.what}: ${row.n}건`).join(", "),
  });

  // 4. The two partial unique indexes the migration must not disturb. They are
  //    on other columns, so they should survive untouched — this asserts that
  //    rather than trusting it. Member_phoneHash_live_key is the account-merge
  //    invariant (one live account per number); the AuthIdentity one is what
  //    lets a withdrawn user sign up again.
  const partials = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT indexname::text AS name FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname IN ('Member_phoneHash_live_key',
                         'AuthIdentity_provider_providerUserId_live_key')`,
  );
  checks.push({
    label: "탈퇴 계정용 partial unique index 두 개가 제자리에 있는지",
    ok: partials.length === 2,
    detail:
      partials.length === 2
        ? "둘 다 있습니다. 이 마이그레이션은 건드리지 않습니다."
        : `${partials.length}/2만 찾았습니다: ${partials.map((p) => p.name).join(", ") || "없음"}. ` +
          "이건 이 마이그레이션과 무관한 문제이니 먼저 조사할 것.",
  });

  // 5. Row counts, so the operator knows the size of what is about to be
  //    rewritten. Not a pass/fail — just the number that makes the snapshot
  //    advice concrete.
  const [sizes] = await prisma.$queryRawUnsafe<
    { members: number; places: number; bookmarks: number; identities: number }[]
  >(
    `SELECT (SELECT count(*)::int FROM "Member")       AS members,
            (SELECT count(*)::int FROM "Place")        AS places,
            (SELECT count(*)::int FROM "Bookmark")     AS bookmarks,
            (SELECT count(*)::int FROM "AuthIdentity") AS identities`,
  );

  for (const check of checks) {
    console.log(`${check.ok ? "OK  " : "FAIL"}  ${check.label}\n        ${check.detail}`);
  }
  console.log(
    `\n번호가 다시 매겨지는 행: Member ${sizes.members}, Place ${sizes.places}, ` +
      `Bookmark ${sizes.bookmarks}, AuthIdentity ${sizes.identities}.`,
  );
  console.log(
    "되돌릴 수 없습니다 — 옛 uuid/cuid 값은 컬럼이 삭제되는 순간 사라집니다. " +
      "적용 전에 스냅샷을 받을 것.",
  );

  if (checks.some((check) => !check.ok)) {
    console.log("\n아직 준비되지 않았습니다. 위 FAIL 항목을 먼저 해결하세요.");
    process.exitCode = 1;
    return;
  }
  console.log("\n준비됐습니다. 스냅샷을 받은 뒤 npm run db:deploy.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error("확인에 실패했습니다:", error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });
