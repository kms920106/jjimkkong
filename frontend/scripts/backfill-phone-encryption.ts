/**
 * Seals the phone numbers left in the old plaintext column.
 *
 * Run once, between the `encrypt_phone` migration (which adds phoneHash and
 * phoneEnc) and `drop_phone_plaintext` (which removes the column this reads):
 *
 *   npx tsx scripts/backfill-phone-encryption.ts
 *
 * Needs PHONE_ENCRYPTION_KEY and DIRECT_URL — the same key the app will use, or
 * the sealed values will not match anything the app computes later.
 *
 * Idempotent: only touches rows that still have a plaintext number and no hash,
 * so a partial run is resumed by running it again.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { normalizeKoreanMobile } from "../src/lib/auth/phone";
import { decryptPhone, sealPhone } from "../src/lib/auth/phone-crypto";

// Its own client rather than lib/prisma.ts: that one is wired to the pooled
// DATABASE_URL and caches itself on globalThis for Next's hot reload, neither of
// which suits a one-shot script. The adapter is not optional — the generated
// client uses engineType "client", which has no native engine to fall back on.
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  }),
});

/** One row of the pre-migration shape, which the generated client no longer types. */
type LegacyRow = { id: string; phone: string };

/**
 * Fails before touching anything if PHONE_ENCRYPTION_KEY is not the key the app
 * will use.
 *
 * This is the one mistake this script cannot survive. Sealing under the wrong
 * key succeeds at every step — the rows are written, the script reports done —
 * and the damage only shows up later, as every account silently failing to match
 * on its next sign-in and quietly acquiring a second profile. Nothing downstream
 * detects it, so the check has to happen here, before the first write.
 *
 * Two checks, both read-only:
 *  1. The key round-trips at all (catches a missing or malformed key).
 *  2. Any row sealed by an earlier run still decrypts (catches a *different*
 *     key, which round-tripping alone cannot see).
 */
async function assertKeyIsUsable(): Promise<void> {
  const probe = normalizeKoreanMobile("01012345678");
  if (!probe) throw new Error("normalizeKoreanMobile가 깨졌습니다.");

  const sealed = sealPhone(probe);
  if (decryptPhone(sealed.enc) !== probe) {
    throw new Error("PHONE_ENCRYPTION_KEY로 암호화/복호화 왕복이 실패했습니다.");
  }

  const already = await prisma.$queryRaw<{ phoneEnc: string }[]>`
    SELECT "phoneEnc" FROM "UserProfile" WHERE "phoneEnc" IS NOT NULL LIMIT 1
  `;
  if (already.length > 0 && decryptPhone(already[0].phoneEnc) === null) {
    throw new Error(
      "이미 저장된 값을 현재 PHONE_ENCRYPTION_KEY로 복호화할 수 없습니다. " +
        "키가 앱이 쓰는 것과 다릅니다 — 이 키로 백필하면 모든 계정이 조용히 매칭에 실패합니다.",
    );
  }
}

async function main() {
  await assertKeyIsUsable();

  // The column this reads only exists between the two migrations. Once
  // `drop_phone_plaintext` has run there is nothing left to convert, and saying
  // so beats a raw `column "phone" does not exist` from the driver — this script
  // is most likely to be re-run by someone checking whether it still needs to be.
  const [{ present }] = await prisma.$queryRaw<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'UserProfile' AND column_name = 'phone'
    ) AS present
  `;
  if (!present) {
    console.log(
      "UserProfile.phone 컬럼이 이미 삭제되었습니다. 백필은 완료된 상태이며 할 일이 없습니다.",
    );
    return;
  }

  // Raw SQL because `phone` is gone from the Prisma schema by now — the column
  // still exists in the database until the follow-up migration drops it, but the
  // generated client cannot see it.
  const rows = await prisma.$queryRaw<LegacyRow[]>`
    SELECT "id", "phone" FROM "UserProfile"
    WHERE "phone" IS NOT NULL AND "phoneHash" IS NULL
  `;

  if (rows.length === 0) {
    console.log("변환할 행이 없습니다.");
    return;
  }

  console.log(`${rows.length}개 행을 변환합니다.`);

  let sealed = 0;
  const skipped: LegacyRow[] = [];

  for (const row of rows) {
    // Through the normalizer rather than a string operation on the `+82`: the
    // normalizer is what the app uses, so this guarantees the backfilled hash is
    // byte-identical to the one the app will compute for the same number. A
    // hand-rolled prefix swap here that disagreed in any edge case would produce
    // a row the owner can never match again.
    const local = normalizeKoreanMobile(row.phone);
    if (!local) {
      // Not a valid Korean mobile — predates the current validation, or is
      // corrupt. Left alone rather than guessed at: the plaintext stays in the
      // column, and dropping it later loses only a value that was never usable
      // as a merge key anyway.
      skipped.push(row);
      continue;
    }

    const { hash, enc } = sealPhone(local);
    await prisma.$executeRaw`
      UPDATE "UserProfile"
      SET "phoneHash" = ${hash}, "phoneEnc" = ${enc}
      WHERE "id" = ${row.id}::uuid
    `;
    sealed += 1;
  }

  console.log(`완료: ${sealed}개 변환.`);

  if (skipped.length > 0) {
    // Loud, and printed last, because the next migration drops the source
    // column: whatever is listed here is about to be unrecoverable.
    console.warn(
      `\n경고: ${skipped.length}개 행의 번호가 유효한 휴대폰 번호 형식이 아니어서 건너뛰었습니다.`,
    );
    console.warn(
      "다음 마이그레이션이 원본 컬럼을 삭제하므로, 아래 행들은 번호를 잃게 됩니다:",
    );
    for (const row of skipped) console.warn(`  ${row.id}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
