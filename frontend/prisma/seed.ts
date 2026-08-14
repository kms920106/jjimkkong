/**
 * Seeds only the local test profile used by the "테스트 계정으로 로그인" button
 * on /login. Real profiles are created on first sign-in by requireUser(), whose
 * ids must match a Supabase auth.users row — nothing else is seedable here.
 *
 * The dev profile id is deliberately a uuid with no auth.users counterpart, so
 * it can never be reached through Supabase Auth.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { DEV_USER_EMAIL, DEV_USER_ID } from "../src/lib/dev-auth";

const prisma = new PrismaClient();

async function main() {
  const profile = await prisma.userProfile.upsert({
    where: { id: DEV_USER_ID },
    update: { email: DEV_USER_EMAIL },
    create: { id: DEV_USER_ID, email: DEV_USER_EMAIL },
  });
  console.log(`Seeded dev test profile ${profile.id} (${profile.email}).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
