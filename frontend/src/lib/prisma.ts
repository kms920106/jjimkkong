import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { withDeleteGuard } from "./prisma-guard";

// Next.js dev mode hot-reloads modules, which would otherwise create a new
// PrismaClient (and a new connection pool) on every reload. Cache it globally.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Queries go through node-postgres rather than a native engine binary; see the
// generator block in schema.prisma for why. Still the pooled DATABASE_URL —
// only migrations need the direct connection.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// Wrapped, not bare: withDeleteGuard() blocks deletes against models whose
// rows are user data, before the query reaches Postgres. Applied here and in
// both backfill scripts — every place a client is constructed — because the
// guard is only worth as much as its narrowest gap. See lib/prisma-guard.ts.
export const prisma =
  globalForPrisma.prisma ??
  withDeleteGuard(
    new PrismaClient({
      adapter,
      log:
        process.env.NODE_ENV === "development"
          ? ["query", "error", "warn"]
          : ["error"],
    }),
  );

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
