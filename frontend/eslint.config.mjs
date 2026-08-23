import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import localRules from "./eslint-rules/no-hard-delete.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // The same tree at any depth. `.next/**` is anchored at the config's
    // directory, so a build that ran with the wrong cwd — leaving a nested
    // `frontend/.next` — gets linted: tens of thousands of problems in bundled
    // vendor code, which buries the real ones and fails `--max-warnings 0`.
    "**/.next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma's generated client. Not ignored before, only exempt through the
    // `/* eslint-disable */` header each generated file carries — which the
    // rules below would inherit silently. Named here instead so the exemption
    // is visible: this tree is full of `delete` in generated types and JSDoc,
    // and none of it is a call site.
    "src/generated/prisma/**",
  ]),
  {
    // Hard-delete guardrails. These mirror src/lib/prisma-guard.ts, which is
    // the layer that actually enforces them at runtime; syntax rules cannot see
    // a dynamic `prisma[model].delete()`. Errors rather than warnings because
    // `next build` runs ESLint, and a warning fails nothing.
    plugins: { local: localRules },
    rules: {
      "local/no-prisma-hard-delete": "error",
      "local/no-blob-del-import": "error",
      "local/no-destructive-raw-sql": "error",
    },
  },
  {
    // Scripts that verify the guard have to call a blocked delete and assert it
    // throws. Refusing to let that be written would leave trusting the guard as
    // the only way to check it. The exemption is safe because the runtime guard
    // still rejects the call when the script runs — that rejection is the
    // assertion. Scoped to `verify-` so ordinary scripts stay covered.
    files: ["scripts/verify-*.ts"],
    rules: { "local/no-prisma-hard-delete": "off" },
  },
]);

export default eslintConfig;
