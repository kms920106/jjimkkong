#!/usr/bin/env node
/**
 * PreToolUse hook: refuses edits and commands that hard-delete data.
 *
 * This is the outermost of three layers and the weakest of them. It reads text,
 * so it is defeated by anything that hides the pattern — a variable holding the
 * model name, a command assembled at runtime, base64. Do not treat a pass here
 * as permission. The enforcement is frontend/src/lib/prisma-guard.ts, which
 * blocks the query between the call and the database; the ESLint rules in
 * frontend/eslint-rules/ are the middle layer.
 *
 * What this layer uniquely buys is *timing*: it refuses before the edit lands,
 * with an explanation the model reads, so the wrong code is never written rather
 * than written and later caught. That matters because the failure mode being
 * guarded against is an agent confidently deleting rows and reporting success.
 *
 * Protocol: read one JSON object on stdin, exit 0 to allow, exit 2 to block
 * with the reason on stderr.
 */

import { readFileSync } from "node:fs";

/** Must match HARD_DELETE_ALLOWED in frontend/src/lib/prisma-guard.ts. */
const ALLOWED_MODELS = new Set([
  "session",
  "phoneVerification",
  "passwordAttempt",
  "savedPostPlace",
]);

const BLOB_DELETE_OWNERS = ["post-thumbnail.ts", "profile-image.ts"];

/** `<client>.<model>.delete(` / `.deleteMany(` — the Prisma delegate shape. */
const PRISMA_DELETE = /(?:\w+)\.(\w+)\s*\.\s*(delete|deleteMany)\s*\(/g;

const DESTRUCTIVE_SQL =
  /\b(?:DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|DROP\s+(?:TABLE|DATABASE|SCHEMA|TYPE))\b/i;

/**
 * Commands that destroy data or schema.
 *
 * `prisma migrate reset` and `db push` are here because both answer a drift
 * warning by offering to drop everything, and this project's DATABASE_URL
 * points at live Supabase — CLAUDE.md documents an incident where the right
 * fix was deleting one stale `_prisma_migrations` row, not a reset.
 */
const DANGEROUS_COMMANDS = [
  [/prisma\s+migrate\s+reset/i, "prisma migrate reset drops the live Supabase database. Diagnose the drift first — see the PRISMA 마이그레이션 규칙 section of CLAUDE.md."],
  [/prisma\s+db\s+push/i, "prisma db push drops columns to match the schema, against live data. Use db:migrate or db:deploy."],
  [/prisma\s+db\s+execute/i, "prisma db execute runs arbitrary SQL against the live database. Put it in a reviewed migration instead."],
  [/\bpsql\b/i, "Direct psql access bypasses every guardrail. Use a migration or a reviewed tsx script."],
  [/\bTRUNCATE\b/i, "TRUNCATE destroys every row in the table."],
  [/\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b/i, "Dropping a table or database is irreversible against live data."],
  [/\bDELETE\s+FROM\b/i, "Row deletion belongs in a reviewed migration, not an ad-hoc command."],
  [/rm\s+-rf\s+\/(?:\s|$)/, "`rm -rf /` would destroy the machine."],
  [/git\s+reset\s+--hard/i, "git reset --hard discards uncommitted work irrecoverably."],
  [/git\s+clean\s+-[a-z]*f/i, "git clean -f deletes untracked files, including new migrations not yet added."],
  [/git\s+push\s+.*--force(?!-with-lease)/i, "Force-pushing rewrites published history. Use --force-with-lease if this is really intended."],
  [/vercel\s+blob\s+del/i, "Deleting blobs by hand can remove an image another user's row still renders. The reference count in the delete routes is what prevents that."],
];

function deny(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

let payload;
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  // A hook that cannot parse its input must not block real work.
  process.exit(0);
}

const tool = payload.tool_name ?? payload.toolName ?? "";
const input = payload.tool_input ?? payload.toolInput ?? {};

if (tool === "Bash") {
  const command = String(input.command ?? "");
  for (const [pattern, reason] of DANGEROUS_COMMANDS) {
    if (pattern.test(command)) deny(`Blocked: ${reason}`);
  }
  process.exit(0);
}

if (tool === "Edit" || tool === "Write" || tool === "MultiEdit") {
  const path = String(input.file_path ?? input.filePath ?? "");
  // Only the strings being introduced, so pre-existing code in a file being
  // edited elsewhere is not re-litigated on every touch.
  const added = [
    input.content,
    input.new_string,
    input.newString,
    ...(Array.isArray(input.edits)
      ? input.edits.map((e) => e?.new_string ?? e?.newString)
      : []),
  ]
    .filter((v) => typeof v === "string")
    .join("\n");

  if (!added) process.exit(0);

  // Only files inside this project. A path outside it — a scratchpad script, a
  // note, a file in another repo — is not what this hook is protecting, and
  // scanning it produced a concrete false positive: the hook refused to let its
  // own test fixtures be written, because those fixtures necessarily contain
  // the patterns they assert on.
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const absolute = path.startsWith("/");
  if (absolute && !path.startsWith(projectDir)) process.exit(0);

  // Migrations: DROP COLUMN and DROP INDEX are deliberately absent from the SQL
  // pattern — both appear in legitimate migrations here (the phone-encryption
  // pair drops a column, the soft-delete pair swaps unique indexes for partial
  // ones). Row and table destruction is what gets refused.
  if (/prisma\/migrations\/.*\.sql$/.test(path)) {
    const match = DESTRUCTIVE_SQL.exec(added);
    if (match) {
      deny(
        `Blocked: this migration contains "${match[0]}". Destroying rows or tables ` +
          `in a migration is irreversible against live Supabase data. If it is ` +
          `genuinely required, apply it by hand after confirming with the user.`,
      );
    }
    process.exit(0);
  }

  // The guard's own files must stay editable: they contain these patterns by
  // definition, and the allowlist has to be changeable when a model genuinely
  // qualifies.
  //
  // Verification scripts are exempt for the same reason, and it is not a
  // loophole worth closing. A script that proves the guard works has to *call*
  // a blocked delete and assert it throws — refusing to let that be written
  // means the only way to check the guard is to trust it. The runtime guard
  // still rejects the call when the script runs, which is precisely what such a
  // script asserts, so the exemption cannot be used to actually delete
  // anything.
  // Prose is exempt for a third reason, found the hard way: this hook refused
  // every attempt to write the AGENTS.md passages that document it. Text *about*
  // a dangerous pattern is indistinguishable from the pattern to a regex, so a
  // guardrail that scans prose makes its own documentation unmaintainable — and
  // undocumented guardrails are the ones people delete when they get in the way.
  // Markdown is never executed, so nothing is lost by not scanning it.
  if (
    /prisma-guard\.ts$/.test(path) ||
    /eslint-rules\//.test(path) ||
    /\.claude\/hooks\//.test(path) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) ||
    /scripts\/verify-/.test(path) ||
    /\.mdx?$/.test(path)
  ) {
    process.exit(0);
  }

  for (const match of added.matchAll(PRISMA_DELETE)) {
    const [, model, method] = match;
    if (ALLOWED_MODELS.has(model)) continue;
    deny(
      `Blocked: ${model}.${method}() destroys user data. Soft-delete instead ` +
        `(deletedAt / withdrawnAt) — SavedPost, UserProfile and AuthIdentity all ` +
        `already work this way. Place rows are shared between users and are never ` +
        `deleted. The runtime guard in src/lib/prisma-guard.ts rejects this call ` +
        `too, so writing it would fail at request time.`,
    );
  }

  const sql = DESTRUCTIVE_SQL.exec(added);
  if (sql) {
    deny(
      `Blocked: raw SQL containing "${sql[0]}". Schema and row destruction ` +
        `belong in a reviewed migration, not in application code.`,
    );
  }

  if (
    /from\s+["']@vercel\/blob["']/.test(added) &&
    /\bdel\b/.test(added) &&
    !BLOB_DELETE_OWNERS.some((owner) => path.endsWith(owner))
  ) {
    deny(
      `Blocked: import del from @vercel/blob only in src/lib/post-thumbnail.ts ` +
        `or src/lib/profile-image.ts. Blob URLs are public and go out in API ` +
        `responses, so a delete must be preceded by a reference count — those ` +
        `two wrappers are the only callers that have one.`,
    );
  }
}

process.exit(0);
