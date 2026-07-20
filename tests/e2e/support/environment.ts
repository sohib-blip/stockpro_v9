import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const STOCKPRO_STAGING_PROJECT_REF = "enjusebvcfjudrrnvjgl";

function parseValue(raw: string) {
  const value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function loadE2EEnvironment() {
  const path = resolve(process.cwd(), ".env.e2e.local");
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    const value = parseValue(line.slice(separator + 1));
    process.env[key] = value;
  }
}

export type StagingEnvironment = {
  baseURL: string;
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
};

export function requireStagingEnvironment(): StagingEnvironment {
  const baseURL = String(process.env.E2E_BASE_URL || "http://127.0.0.1:3001").replace(
    /\/$/,
    ""
  );
  const supabaseUrl = String(process.env.E2E_SUPABASE_URL || "");
  const anonKey = String(process.env.E2E_SUPABASE_ANON_KEY || "");
  const serviceRoleKey = String(process.env.E2E_SUPABASE_SERVICE_ROLE_KEY || "");

  let supabaseTarget: URL;
  try {
    supabaseTarget = new URL(supabaseUrl);
  } catch {
    throw new Error("E2E safety stop: E2E_SUPABASE_URL is not a valid URL.");
  }

  if (
    supabaseTarget.protocol !== "https:" ||
    supabaseTarget.hostname !== `${STOCKPRO_STAGING_PROJECT_REF}.supabase.co`
  ) {
    throw new Error(
      `E2E safety stop: E2E_SUPABASE_URL must target StockPro-Staging (${STOCKPRO_STAGING_PROJECT_REF}).`
    );
  }
  if (!anonKey || !serviceRoleKey) {
    throw new Error(
      "E2E setup is incomplete. Copy .env.e2e.example to .env.e2e.local and add the StockPro-Staging keys."
    );
  }

  const target = new URL(baseURL);
  const isLocal = target.hostname === "127.0.0.1" || target.hostname === "localhost";
  const isPreview =
    target.protocol === "https:" &&
    /^stockpro-v9-[a-z0-9-]+\.vercel\.app$/i.test(target.hostname) &&
    target.hostname !== "stockpro-v9.vercel.app";

  if (!isLocal && !isPreview) {
    throw new Error(
      "E2E safety stop: E2E_BASE_URL must be localhost or a StockPro Vercel preview URL, never production."
    );
  }

  return { baseURL, supabaseUrl, anonKey, serviceRoleKey };
}
