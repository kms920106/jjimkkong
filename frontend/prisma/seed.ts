import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "demo@jjimkkong.dev" },
    update: {},
    create: {
      email: "demo@jjimkkong.dev",
      name: "Demo User",
      posts: {
        create: [{ title: "Hello Prisma", content: "Seeded post.", published: true }],
      },
    },
  });

  console.log(`Seeded user ${user.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
