/**
 * Local ESLint rules that mirror the runtime guard in src/lib/prisma-guard.ts.
 *
 * These are an early warning, not the enforcement. A lint rule reads syntax, so
 * `prisma[model].delete()` — or any call through a variable — walks straight
 * past every rule here. The Prisma client extension is what actually stops a
 * blocked delete, because it sits between the call and the wire. What lint buys
 * is the failure arriving at `npm run lint` and in the Vercel build instead of
 * at runtime, on the one line that caused it.
 *
 * Kept as a flat-config plugin object rather than a published package: there is
 * no other consumer, and a local file is one less thing to keep in sync.
 */

/**
 * Must match HARD_DELETE_ALLOWED in src/lib/prisma-guard.ts. The reasoning for
 * each entry lives there, next to the code that enforces it; duplicating it
 * here would let the two copies drift.
 */
const ALLOWED_MODELS = new Set([
  "session",
  "phoneVerification",
  "passwordAttempt",
]);

/** Where `del` from @vercel/blob may be imported. */
// One file, down from two. `post-thumbnail.ts` left when the thumbnail column
// moved to the shared, immutable `Post`: nothing displaces a thumbnail blob any
// more, so there is no delete to own. Adding a file back here means re-arguing
// why a `del()` in it cannot be aimed at another user's image — blob URLs are
// public, so the reasoning has to be about the URL's provenance, not its shape.
const BLOB_DELETE_OWNERS = ["src/lib/profile-image.ts"];

const DESTRUCTIVE_SQL =
  /\b(?:DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|DROP\s+(?:TABLE|DATABASE|SCHEMA|TYPE))\b/i;

const RAW_SQL_METHODS = new Set([
  "$executeRaw",
  "$executeRawUnsafe",
  "$queryRaw",
  "$queryRawUnsafe",
]);

/** The `foo` in `foo.delete(...)`, or null if the object is not a plain name. */
function calleeObjectName(node) {
  const { callee } = node;
  if (callee?.type !== "MemberExpression") return null;
  if (callee.computed) return null;
  const { object } = callee;
  // `prisma.savedPost.delete` and `tx.savedPost.delete` — the model is the
  // property, not the root identifier.
  if (object.type === "MemberExpression" && !object.computed) {
    return object.property.type === "Identifier" ? object.property.name : null;
  }
  return object.type === "Identifier" ? object.name : null;
}

function calleeMethodName(node) {
  const { callee } = node;
  if (callee?.type !== "MemberExpression" || callee.computed) return null;
  return callee.property.type === "Identifier" ? callee.property.name : null;
}

/** Every string literal reachable from a raw-SQL argument. */
function stringsIn(node) {
  if (!node) return [];
  if (node.type === "Literal" && typeof node.value === "string") {
    return [node.value];
  }
  if (node.type === "TemplateLiteral") {
    return node.quasis.map((q) => q.value.cooked ?? q.value.raw);
  }
  if (node.type === "TaggedTemplateExpression") return stringsIn(node.quasi);
  if (node.type === "BinaryExpression" && node.operator === "+") {
    return [...stringsIn(node.left), ...stringsIn(node.right)];
  }
  return [];
}

const noPrismaHardDelete = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid delete()/deleteMany() on models whose rows are user data.",
    },
    schema: [],
    messages: {
      blocked:
        "{{model}}.{{method}}() destroys user data. Use a soft delete (deletedAt / withdrawnAt) instead. If these rows genuinely are not user data, add the model to HARD_DELETE_ALLOWED in src/lib/prisma-guard.ts with the reason why — the runtime guard blocks this call regardless of what lint says.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const method = calleeMethodName(node);
        if (method !== "delete" && method !== "deleteMany") return;

        const model = calleeObjectName(node);
        // Not a recognisable model access: Map.delete(), a computed member, a
        // helper on some other object. The runtime guard covers what this
        // cannot see.
        if (!model) return;
        if (ALLOWED_MODELS.has(model)) return;

        // Only flag names that look like Prisma delegates — a model access is
        // always `<client>.<model>.delete`, never a bare `x.delete`. This is
        // what keeps `map.delete(key)` and `set.delete(v)` quiet.
        const { callee } = node;
        if (callee.object.type !== "MemberExpression") return;

        context.report({ node, messageId: "blocked", data: { model, method } });
      },
    };
  },
};

const noBlobDelImport = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Confine @vercel/blob's del() to the two modules that own blob cleanup.",
    },
    schema: [],
    messages: {
      blocked:
        "Import `del` from @vercel/blob only in src/lib/profile-image.ts. That wrapper is only ever handed a URL read back out of the row being replaced, inside the same transaction — a fresh del() call has no such provenance, and blob URLs are public, so it can be aimed at another user's image.",
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    const normalized = filename.split("\\").join("/");
    const isOwner = BLOB_DELETE_OWNERS.some((owner) =>
      normalized.endsWith(owner),
    );
    if (isOwner) return {};

    return {
      ImportDeclaration(node) {
        if (node.source.value !== "@vercel/blob") return;
        for (const spec of node.specifiers) {
          if (
            spec.type === "ImportSpecifier" &&
            spec.imported.type === "Identifier" &&
            spec.imported.name === "del"
          ) {
            context.report({ node: spec, messageId: "blocked" });
          }
        }
      },
    };
  },
};

const noDestructiveRawSql = {
  meta: {
    type: "problem",
    docs: {
      description: "Forbid row- or schema-destroying SQL in runtime queries.",
    },
    schema: [],
    messages: {
      blocked:
        'Raw SQL containing "{{matched}}" is blocked. Schema and row destruction belong in a reviewed migration, not in a runtime query.',
    },
  },
  create(context) {
    const check = (node, argNode) => {
      for (const text of stringsIn(argNode)) {
        const match = DESTRUCTIVE_SQL.exec(text);
        if (match) {
          context.report({
            node,
            messageId: "blocked",
            data: { matched: match[0] },
          });
          return;
        }
      }
    };

    return {
      CallExpression(node) {
        const method = calleeMethodName(node);
        if (!method || !RAW_SQL_METHODS.has(method)) return;
        check(node, node.arguments[0]);
      },
      // The tagged-template form: prisma.$executeRaw`DELETE FROM ...`
      TaggedTemplateExpression(node) {
        const method = calleeMethodName({ callee: node.tag });
        if (!method || !RAW_SQL_METHODS.has(method)) return;
        check(node, node.quasi);
      },
    };
  },
};

const plugin = {
  rules: {
    "no-prisma-hard-delete": noPrismaHardDelete,
    "no-blob-del-import": noBlobDelImport,
    "no-destructive-raw-sql": noDestructiveRawSql,
  },
};

export default plugin;
