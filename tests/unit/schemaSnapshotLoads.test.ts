import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { describe, expect, it } from "vitest";
import { buildSchemaSnapshot } from "../../scripts/lib/schema-snapshot.mjs";

// Loads the committed snapshot into an empty in-memory Postgres 17 (PGlite,
// no network, no Supabase project) and reads it back with the same catalog
// query: the result must be the same file, so the snapshot can rebuild a database.

const root = join(__dirname, "../..");
const snapshot = readFileSync(join(root, "supabase/schema/staging-schema.sql"), "utf8");
const catalogQuery = readFileSync(join(root, "scripts/sql/schema-snapshot.sql"), "utf8");

// Extensions a Supabase project has but PGlite cannot install.
const UNAVAILABLE_EXTENSION = /^CREATE EXTENSION IF NOT EXISTS (pg_stat_statements|supabase_vault) /;

// Minimal stand-in for what every Supabase project already provides.
const SUPABASE_BASELINE = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN;
  CREATE SCHEMA extensions;
  CREATE SCHEMA auth;
  CREATE SCHEMA vault;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
`;

function headerValue(label: string) {
  const match = snapshot.match(new RegExp(`^-- ${label}: (.+)$`, "m"));
  if (!match) throw new Error(`Missing "${label}" in the snapshot header`);
  return match[1];
}

// Postgres re-prints some expressions with fewer parentheses; same meaning.
function withoutParentheses(text: string) {
  return text.replace(/[()]/g, "");
}

describe("schema snapshot rebuilds a database", () => {
  it(
    "loads into an empty Postgres and reads back identically",
    async () => {
      const db = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
      try {
        await db.exec(SUPABASE_BASELINE);
        const loadable = snapshot
          .split("\n")
          .map((line) => (UNAVAILABLE_EXTENSION.test(line) ? `-- not available in PGlite: ${line}` : line))
          .join("\n");
        await db.exec(loadable);

        const result = await db.query<{ section: number; sort_key: string; ddl: string }>(catalogQuery);
        const rebuilt = buildSchemaSnapshot({
          rows: result.rows,
          projectName: headerValue("Source project"),
          generatedOn: headerValue("Generated on"),
          lastMigration: headerValue("Last migration reflected"),
        });

        const expected = snapshot.split("\n").filter((line) => !UNAVAILABLE_EXTENSION.test(line) && !/^--   Extensions: /.test(line));
        const actual = rebuilt.split("\n").filter((line) => !/^--   Extensions: /.test(line));
        const squash = (lines: string[]) => withoutParentheses(lines.join("\n").replace(/\n{2,}/g, "\n"));
        expect(squash(actual)).toBe(squash(expected));
      } finally {
        await db.close();
      }
    },
    60_000
  );
});
