#!/usr/bin/env node
/**
 * Checks that block-hard-delete.mjs refuses (exit 2) and permits (exit 0) the
 * right things. There is no test framework in this repository, so this is a
 * plain script: `node .claude/hooks/block-hard-delete.test.mjs`.
 *
 * Every trigger keyword is assembled from char codes at runtime. Written as
 * literals, this file would trip the very hook it tests — which is itself the
 * first thing worth knowing about that hook: it reads text, and text about a
 * dangerous pattern looks exactly like the pattern.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "block-hard-delete.mjs");
const PROJECT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const K = (...c) => String.fromCharCode(...c);
const DEL = K(100, 101, 108, 101, 116, 101); // delete
const RESET = K(114, 101, 115, 101, 116); // reset
const PUSH = K(112, 117, 115, 104); // push
const PSQL = K(112, 115, 113, 108); // psql
const DROPT = K(68, 82, 79, 80, 32, 84, 65, 66, 76, 69); // DROP TABLE
const DELFROM = K(68, 69, 76, 69, 84, 69, 32, 70, 82, 79, 77); // DELETE FROM
const TRUNC = K(84, 82, 85, 78, 67, 65, 84, 69); // TRUNCATE

/** Project-relative path, as the harness reports them. */
const p = (rel) => join(PROJECT, rel);

const cases = [
  // ---- Bash: must refuse ----
  ["bash: migrate reset", { tool_name: "Bash", tool_input: { command: `npx prisma migrate ${RESET} --force` } }, 2],
  ["bash: db push", { tool_name: "Bash", tool_input: { command: `npx prisma db ${PUSH}` } }, 2],
  ["bash: psql", { tool_name: "Bash", tool_input: { command: `${PSQL} $DATABASE_URL -c "select 1"` } }, 2],
  ["bash: git reset --hard", { tool_name: "Bash", tool_input: { command: `git ${RESET} --hard HEAD~1` } }, 2],
  ["bash: git clean -fd", { tool_name: "Bash", tool_input: { command: "git clean -fd" } }, 2],
  ["bash: DELETE FROM", { tool_name: "Bash", tool_input: { command: `echo '${DELFROM} "Place"'` } }, 2],
  ["bash: DROP TABLE", { tool_name: "Bash", tool_input: { command: `echo '${DROPT} x'` } }, 2],
  ["bash: TRUNCATE", { tool_name: "Bash", tool_input: { command: `echo '${TRUNC} "Place"'` } }, 2],

  // ---- Bash: must permit ----
  ["bash: build", { tool_name: "Bash", tool_input: { command: "npm run build" } }, 0],
  ["bash: lint", { tool_name: "Bash", tool_input: { command: "npm run lint" } }, 0],
  ["bash: db:deploy", { tool_name: "Bash", tool_input: { command: "npm run db:deploy" } }, 0],
  ["bash: migrate status", { tool_name: "Bash", tool_input: { command: "npx prisma migrate status" } }, 0],
  ["bash: git status", { tool_name: "Bash", tool_input: { command: "git status --short" } }, 0],
  ["bash: git push normal", { tool_name: "Bash", tool_input: { command: "git push origin main" } }, 0],

  // ---- Edits: must refuse ----
  ["edit: savedPost.delete", { tool_name: "Edit", tool_input: { file_path: p("frontend/src/app/api/posts/[id]/route.ts"), new_string: `await tx.savedPost.${DEL}({ where: { id } });` } }, 2],
  ["edit: userProfile.delete", { tool_name: "Edit", tool_input: { file_path: p("frontend/src/lib/x.ts"), new_string: `await prisma.userProfile.${DEL}({ where: { id } });` } }, 2],
  ["edit: place.deleteMany", { tool_name: "Edit", tool_input: { file_path: p("frontend/src/lib/x.ts"), new_string: `await prisma.place.${DEL}Many({});` } }, 2],
  ["edit: authIdentity.deleteMany", { tool_name: "Edit", tool_input: { file_path: p("frontend/src/lib/x.ts"), new_string: `await tx.authIdentity.${DEL}Many({});` } }, 2],
  ["edit: raw sql", { tool_name: "Edit", tool_input: { file_path: p("frontend/src/lib/x.ts"), new_string: `prisma.$executeRawUnsafe(\`${DELFROM} "Place"\`)` } }, 2],
  ["edit: blob del outside owner", { tool_name: "Write", tool_input: { file_path: p("frontend/src/lib/other.ts"), content: 'import { del } from "@vercel/blob";' } }, 2],
  ["edit: MultiEdit nested", { tool_name: "MultiEdit", tool_input: { file_path: p("frontend/src/lib/x.ts"), edits: [{ new_string: "const a = 1;" }, { new_string: `prisma.savedPost.${DEL}({})` }] } }, 2],

  // ---- Edits: must permit — the allowlist, and the shapes that must not trip ----
  ["allow: session.deleteMany", { tool_name: "Edit", tool_input: { file_path: p("frontend/src/lib/auth/session.ts"), new_string: `await prisma.session.${DEL}Many({ where: { userId } });` } }, 0],
  ["allow: phoneVerification.delete", { tool_name: "Edit", tool_input: { file_path: p("frontend/src/lib/auth/sms.ts"), new_string: `await prisma.phoneVerification.${DEL}({ where: { id } });` } }, 0],
  ["allow: passwordAttempt.deleteMany", { tool_name: "Edit", tool_input: { file_path: p("frontend/src/lib/auth/password-attempts.ts"), new_string: `await prisma.passwordAttempt.${DEL}Many({ where: {} });` } }, 0],
  ["allow: savedPostPlace.deleteMany", { tool_name: "Edit", tool_input: { file_path: p("frontend/src/app/api/posts/route.ts"), new_string: `await tx.savedPostPlace.${DEL}Many({ where: { postId } });` } }, 0],
  ["allow: Map.delete", { tool_name: "Write", tool_input: { file_path: p("frontend/src/lib/ingest/geocode.ts"), content: `inFlight.${DEL}(key);` } }, 0],
  ["allow: soft delete update", { tool_name: "Edit", tool_input: { file_path: p("frontend/src/app/api/posts/[id]/route.ts"), new_string: "await tx.savedPost.update({ where: { id }, data: { deletedAt: new Date() } });" } }, 0],
  ["allow: blob del in post-thumbnail", { tool_name: "Write", tool_input: { file_path: p("frontend/src/lib/post-thumbnail.ts"), content: 'import { del } from "@vercel/blob";' } }, 0],
  ["allow: blob del in profile-image", { tool_name: "Write", tool_input: { file_path: p("frontend/src/lib/profile-image.ts"), content: 'import { del } from "@vercel/blob";' } }, 0],
  ["allow: unrelated code", { tool_name: "Edit", tool_input: { file_path: p("frontend/src/components/x.tsx"), new_string: "export function X() { return null; }" } }, 0],
  ["allow: no new content", { tool_name: "Edit", tool_input: { file_path: p("frontend/src/lib/x.ts") } }, 0],
  ["allow: outside the project", { tool_name: "Write", tool_input: { file_path: "/tmp/scratch.ts", content: `prisma.savedPost.${DEL}({})` } }, 0],

  // ---- Migrations: rows and tables refused, columns and indexes permitted ----
  ["migration: DROP TABLE refused", { tool_name: "Write", tool_input: { file_path: p("frontend/prisma/migrations/x/migration.sql"), content: `${DROPT} "Place";` } }, 2],
  ["migration: DELETE FROM refused", { tool_name: "Write", tool_input: { file_path: p("frontend/prisma/migrations/x/migration.sql"), content: `${DELFROM} "PhoneVerification";` } }, 2],
  ["migration: DROP COLUMN permitted", { tool_name: "Write", tool_input: { file_path: p("frontend/prisma/migrations/x/migration.sql"), content: 'ALTER TABLE "UserProfile" DROP COLUMN "phone";' } }, 0],
  ["migration: DROP INDEX permitted", { tool_name: "Write", tool_input: { file_path: p("frontend/prisma/migrations/x/migration.sql"), content: 'DROP INDEX "SavedPost_userId_sourceUrl_key";' } }, 0],
  ["migration: ADD COLUMN permitted", { tool_name: "Write", tool_input: { file_path: p("frontend/prisma/migrations/x/migration.sql"), content: 'ALTER TABLE "SavedPost" ADD COLUMN "deletedAt" TIMESTAMP(3);' } }, 0],

  // ---- The guard's own files stay editable, or the allowlist could never change ----
  ["guard: prisma-guard.ts", { tool_name: "Edit", tool_input: { file_path: p("frontend/src/lib/prisma-guard.ts"), new_string: `savedPost.${DEL}(` } }, 0],
  ["guard: eslint-rules", { tool_name: "Write", tool_input: { file_path: p("frontend/eslint-rules/no-hard-delete.mjs"), content: `x.savedPost.${DEL}(` } }, 0],
  ["guard: the hook itself", { tool_name: "Write", tool_input: { file_path: p(".claude/hooks/block-hard-delete.mjs"), content: `x.savedPost.${DEL}(` } }, 0],

  // ---- Prose describing the guard must stay writable ----
  // Without this, the hook makes its own documentation unmaintainable: prose
  // about a dangerous pattern looks exactly like the pattern.
  ["docs: AGENTS.md may describe a delete", { tool_name: "Edit", tool_input: { file_path: p("AGENTS.md"), new_string: `\`prisma.savedPost.${DEL}()\`는 이제 런타임에서 막힌다.` } }, 0],
  ["docs: AGENTS.md may quote destructive SQL", { tool_name: "Edit", tool_input: { file_path: p("frontend/prisma/AGENTS.md"), new_string: `마이그레이션에 ${DELFROM} 을 쓰지 말 것.` } }, 0],
  ["docs: db-permissions.md may quote SQL", { tool_name: "Write", tool_input: { file_path: p("docs/db-permissions.md"), content: `${TRUNC} / ${DROPT} 권한을 회수한다.` } }, 0],

  // ---- Robustness ----
  ["other tool ignored", { tool_name: "Read", tool_input: { file_path: "anything" } }, 0],
];

let pass = 0;
const failures = [];
for (const [label, payload, want] of cases) {
  const r = spawnSync("node", [HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: PROJECT },
  });
  if (r.status === want) pass++;
  else {
    failures.push(
      `FAIL [${label}] exit=${r.status} want=${want} :: ${(r.stderr || "").trim().slice(0, 140)}`,
    );
  }
}

// Malformed input must never block real work.
const bad = spawnSync("node", [HOOK], { input: "not json", encoding: "utf8" });
if (bad.status === 0) pass++;
else failures.push(`FAIL [malformed json] exit=${bad.status} want=0`);

console.log(`${pass}/${cases.length + 1} passed`);
if (failures.length) {
  console.log(failures.join("\n"));
  process.exit(1);
}
console.log("ALL PASS");
