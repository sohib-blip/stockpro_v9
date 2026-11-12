// Regenerates supabase/schema/staging-schema.sql from the Staging database.
// Read-only: the catalog query runs through `supabase db query --read-only`,
// with the Supabase CLI login of the person running it. No data is read.
//
//   npm run db:schema                      -> supabase/schema/staging-schema.sql
//   npm run db:schema -- --production --out <file outside the repository>
//     Production only with the owner's explicit approval; never committed.
import { execFile } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { buildSchemaSnapshot, latestMigration } from "./lib/schema-snapshot.mjs";

const PROJECTS = {
  staging: { ref: "enjusebvcfjudrrnvjgl", name: "StockPro-Staging" },
  production: { ref: "tqoblbwvvvqmwlsfoxni", name: "Radius-Stock-Count" },
};
const SUPABASE_CLI = "supabase@3.1.0";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const target = args.includes("--production") ? "production" : "staging";
const outIndex = args.indexOf("--out");
const outPath = outIndex >= 0 ? resolve(args[outIndex + 1] ?? "") : resolve(root, "supabase/schema/staging-schema.sql");

if (target === "production" && (outIndex < 0 || !relative(root, outPath).startsWith(".."))) {
  throw new Error("--production needs --out with a file outside the repository: a Production snapshot is never committed.");
}

const project = PROJECTS[target];
const queryFile = resolve(root, "scripts/sql/schema-snapshot.sql");
const migrations = await readdir(resolve(root, "supabase/migrations"));

console.log(`Reading the ${target} schema (read-only) from ${project.name}...`);
const { stdout } = await promisify(execFile)(
  "npx",
  ["--yes", SUPABASE_CLI, "db", "query", `--remote=${project.ref}`, "--read-only", "--output-format", "json", "-f", queryFile],
  { cwd: root, maxBuffer: 64 * 1024 * 1024 }
);

const result = JSON.parse(stdout.slice(stdout.indexOf("{")));
if (!Array.isArray(result.rows)) {
  throw new Error(`The Supabase CLI did not return rows: ${JSON.stringify(result.error ?? result).slice(0, 500)}`);
}

const text = buildSchemaSnapshot({
  rows: result.rows,
  projectName: project.name,
  generatedOn: new Date().toISOString().slice(0, 10),
  lastMigration: latestMigration(migrations),
});

let previous = null;
try {
  previous = await readFile(outPath, "utf8");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
await writeFile(outPath, text);
const unchanged = previous !== null && previous.split("\n").slice(4).join("\n") === text.split("\n").slice(4).join("\n");
console.log(`${relative(process.cwd(), outPath)} written (${result.rows.length} statements)${unchanged ? ", structure unchanged" : ""}.`);
