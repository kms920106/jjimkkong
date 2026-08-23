/**
 * Runtime block on hard deletes.
 *
 * Every invariant in this repository used to live only in prose — AGENTS.md
 * says "ownership checks happen in the application, not the database" and
 * "withdrawal is a state change, not a delete", and nothing failed when that
 * was ignored. Code that deleted user rows passed lint and passed the build.
 * This module is the layer that makes those sentences fail loudly instead.
 *
 * A Prisma Client Extension is the right seam because it sits between the call
 * and the wire: a blocked `delete` never reaches Postgres, no matter which file
 * wrote it or how it got there. Static analysis cannot make that promise —
 * `prisma[model].delete()` defeats any lint rule — so the ESLint rules that
 * accompany this file are an early warning, and this is the enforcement.
 *
 * Applied via a shared factory rather than inside `lib/prisma.ts`, because
 * `new PrismaClient` appears in three places: the app singleton and the two
 * backfill scripts, which build their own client to reach DIRECT_URL. Wrapping
 * only the singleton would leave the scripts — the ones run by hand against
 * live data — unguarded.
 *
 * What this does NOT cover, and why the other layers exist:
 *
 * - **Cascades.** `onDelete: Cascade` is executed by Postgres, below this
 *   extension. `Member` carries three of them (AuthIdentity, Session,
 *   Bookmark), so a single removal of a Member row would take an account's
 *   entire history with it. What stops that is `Member` being absent from the
 *   allowlist: the statement never reaches the database, so the cascade never
 *   fires. Adding `Member` here would re-arm all three at once.
 * - **Raw SQL.** `$executeRawUnsafe("DELETE FROM ...")` is a string, and the
 *   check below is a regex. It catches the mistake, not the determined caller.
 * - **The database itself.** Prisma connects as the table owner. The only
 *   absolute stop is a Postgres role without DELETE, which cannot be applied
 *   wholesale here because Session and friends must remain deletable. See
 *   docs/db-permissions.md.
 */

/**
 * The models whose rows may be permanently removed.
 *
 * Adding a model to this object is a declaration that its rows are not user
 * data and that losing them costs nothing recoverable. Every entry carries the
 * reason it qualifies; an entry without one is a bug in review, not a style
 * problem. Everything absent from this list is soft-deleted instead —
 * `Member` and `AuthIdentity` via `withdrawnAt`, `Bookmark` via `deletedAt` —
 * and `Place` is never removed at all because its rows are shared between
 * members.
 */
const HARD_DELETE_ALLOWED = new Set<string>([
  // A logged-in browser. Deleting the row is the immediate revocation that the
  // database-backed session design exists for: logout, withdrawal, and password
  // reset all have to end other sessions *now*, which a self-contained JWT
  // could not do. Soft-deleting these would put a `revokedAt` filter on the
  // hot auth path where one missed filter resurrects a stolen session.
  "Session",

  // One in-flight SMS challenge. Deleted only as a compensating rollback when
  // the send throws after the row was written. Codes expire in minutes; there
  // is nothing to recover.
  "PhoneVerification",

  // Rate-limit bookkeeping outside the counting window, plus the reset on a
  // successful sign-in. Pure garbage collection — these rows exist to be
  // counted and then forgotten.
  "PasswordAttempt",

]);

// `SavedPostPlace` used to be here, and its removal is the allowlist getting
// strictly stronger rather than an oversight.
//
// It qualified because a re-save *replaced* a post's place set rather than
// appending to it, and that replacement was a bulk removal. The post/bookmark
// split ended that: the place list and its order now live on `PostPlace`, which
// hangs off the shared immutable `Post`, so a re-save rewrites nothing and there
// is no set to replace. The member's own notes moved to `BookmarkMemo`, which is
// keyed per place and updated in place.
//
// Neither belongs here. Do not re-add either one to make a rewrite convenient —
// if a `Post` ever needs re-ingesting, that is a reviewed backfill against a
// specific row, not a runtime path.

/** Thrown instead of issuing a delete against a model that must not lose rows. */
export class HardDeleteBlockedError extends Error {
  constructor(
    readonly model: string,
    readonly operation: string,
  ) {
    super(
      `${model}.${operation}() is blocked: hard-deleting ${model} rows would ` +
        `destroy user data. Use a soft delete (deletedAt / withdrawnAt) instead. ` +
        `If ${model} rows genuinely are not user data, add it to ` +
        `HARD_DELETE_ALLOWED in src/lib/prisma-guard.ts with the reason why.`,
    );
    this.name = "HardDeleteBlockedError";
  }
}

/** Thrown instead of sending raw SQL that drops or deletes. */
export class DestructiveSqlBlockedError extends Error {
  constructor(readonly matched: string) {
    super(
      `Raw SQL containing "${matched}" is blocked. Schema and row destruction ` +
        `belong in a reviewed migration, not in a runtime query.`,
    );
    this.name = "DestructiveSqlBlockedError";
  }
}

/**
 * Statements that destroy rows or schema.
 *
 * `DROP COLUMN` and `DROP INDEX` are deliberately absent: both appear in
 * legitimate migrations in this repository (20260817160000_encrypt_phone drops
 * the plaintext phone column, 20260817140000_soft_delete_account swaps two
 * unique indexes for partial ones), and migrations do not run through the
 * Prisma client anyway. Blocking them here would only produce false positives.
 */
const DESTRUCTIVE_SQL =
  /\b(?:DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|DROP\s+(?:TABLE|DATABASE|SCHEMA|TYPE))\b/i;

function assertNonDestructive(sql: unknown): void {
  if (typeof sql !== "string") return;
  const match = DESTRUCTIVE_SQL.exec(sql);
  if (match) throw new DestructiveSqlBlockedError(match[0]);
}

/**
 * Reads the SQL text out of whatever `$executeRaw`-family call produced it.
 *
 * The tagged-template forms (`$executeRaw`, `$queryRaw`) receive a
 * TemplateStringsArray whose interpolations are already parameterised, so only
 * the literal fragments can carry a statement keyword. The `Unsafe` forms
 * receive a plain string.
 */
function sqlTextOf(args: unknown[]): string {
  const [first] = args;
  if (typeof first === "string") return first;
  if (Array.isArray(first)) return first.join(" ");
  // Prisma.sql`` produces a { strings, values } shape.
  if (first && typeof first === "object" && "strings" in first) {
    const { strings } = first as { strings?: unknown };
    if (Array.isArray(strings)) return strings.join(" ");
  }
  return "";
}

/**
 * Wraps a PrismaClient so blocked deletes throw before reaching the database.
 *
 * Generic over the client type so the extended client keeps its full model
 * typing at every call site; `$extends` returns a structurally different type,
 * which is why the result is cast back.
 */
export function withDeleteGuard<TClient extends object>(client: TClient): TClient {
  const extended = (
    client as unknown as {
      $extends: (ext: unknown) => unknown;
    }
  ).$extends({
    name: "hard-delete-guard",
    query: {
      $allModels: {
        delete({ model, args, query }: { model: string; args: unknown; query: (a: unknown) => unknown }) {
          if (!HARD_DELETE_ALLOWED.has(model)) {
            throw new HardDeleteBlockedError(model, "delete");
          }
          return query(args);
        },
        deleteMany({ model, args, query }: { model: string; args: unknown; query: (a: unknown) => unknown }) {
          if (!HARD_DELETE_ALLOWED.has(model)) {
            throw new HardDeleteBlockedError(model, "deleteMany");
          }
          return query(args);
        },
      },
    },
    client: {
      // Raw SQL bypasses the model-level hooks above entirely: Prisma has no
      // model to report for it. These four are the only ways to reach the
      // database with hand-written SQL, so each one re-checks its own text.
      $executeRaw(...args: unknown[]) {
        assertNonDestructive(sqlTextOf(args));
        return (
          Reflect.get(client, "$executeRaw") as (...a: unknown[]) => unknown
        ).apply(client, args);
      },
      $executeRawUnsafe(...args: unknown[]) {
        assertNonDestructive(sqlTextOf(args));
        return (
          Reflect.get(client, "$executeRawUnsafe") as (...a: unknown[]) => unknown
        ).apply(client, args);
      },
      $queryRaw(...args: unknown[]) {
        assertNonDestructive(sqlTextOf(args));
        return (
          Reflect.get(client, "$queryRaw") as (...a: unknown[]) => unknown
        ).apply(client, args);
      },
      $queryRawUnsafe(...args: unknown[]) {
        assertNonDestructive(sqlTextOf(args));
        return (
          Reflect.get(client, "$queryRawUnsafe") as (...a: unknown[]) => unknown
        ).apply(client, args);
      },
    },
  });

  return extended as TClient;
}
