// Pure pseudonymization helpers for scripts/clone-production-data-to-staging.mjs.
//
// Nothing here touches the network or the disk, so the rules can be unit
// tested with fictional people. Every row that leaves Production for Staging
// or for a local file goes through anonymizeTableRows/anonymizeAuthUser and is
// then checked by assertNoPersonalData, which fails closed.

import { createHmac, randomBytes } from "node:crypto";

export const FICTIONAL_EMAIL_DOMAIN = "stockpro.test";
export const REDACTED_TEXT = "[redacted]";

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
const FICTIONAL_EMAIL_PATTERN = /@stockpro\.test$/i;

// Actor values that name a process rather than a person.
const NON_PERSON_ACTORS = new Set(["", "unknown", "system", "cron", "automation"]);

// Column -> rule. Columns not listed here are business data (stock, IMEI,
// references, quantities) and are copied unchanged.
export const PERSONAL_COLUMN_RULES = {
  accessory_movements: { actor: "actor", note: "text", comment: "text" },
  alert_subscribers: { email: "email" },
  inbound_batches: { actor: "actor" },
  movements: { actor: "actor", notes: "text" },
  nrd_time_logs: { user_email: "email", task: "task" },
  profiles: { email: "email", full_name: "person" },
  return_history_entries: { actor: "actor" },
  return_records: {
    actor: "actor",
    customer: "customer",
    sur_id: "surId",
    template_exported_by_email: "email",
  },
  return_template_export_batches: { actor: "actor" },
  supplies: { created_by: "actor", comment: "text", failed_reason: "text" },
  supply_status_history: { changed_by: "actor", failed_reason: "text" },
};

// Technical tables holding IP addresses, devices, sessions or hashed quota
// keys. They are never copied and never written into a local backup.
export const NEVER_EXPORTED_TABLES = new Set([
  "app_sessions",
  "connection_events",
  "inventory_command_receipts",
  "workload_budget_buckets",
  "workload_leases",
]);

export function isFictionalEmail(value) {
  return FICTIONAL_EMAIL_PATTERN.test(String(value || "").trim());
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function normalize(value) {
  return String(value).trim().toLowerCase();
}

/**
 * Deterministic within one run (same person -> same alias in every table),
 * keyed by a random secret that is never written anywhere, so an alias cannot
 * be reversed by hashing known email addresses.
 */
export function createPseudonymizer({ secret = randomBytes(32) } = {}) {
  const code = (kind, value) =>
    createHmac("sha256", secret)
      .update(`${kind}\u0000${normalize(value)}`)
      .digest("hex")
      .slice(0, 10);

  const email = (value) => {
    if (isBlank(value)) return value ?? null;
    const normalized = normalize(value);
    if (isFictionalEmail(normalized)) return normalized;
    return `user-${code("email", normalized)}@${FICTIONAL_EMAIL_DOMAIN}`;
  };

  const person = (value) =>
    isBlank(value) ? value ?? null : `User ${code("person", value)}`;

  const actor = (value) => {
    if (value === null || value === undefined) return null;
    if (NON_PERSON_ACTORS.has(normalize(value))) return value;
    if (String(value).includes("@")) return email(value);
    return person(value);
  };

  return {
    email,
    person,
    actor,
    customer: (value) =>
      isBlank(value) ? value ?? null : `Customer ${code("customer", value)}`,
    surId: (value) =>
      isBlank(value) ? value ?? null : `SUR-${code("sur", value)}`,
    task: (value) =>
      isBlank(value) ? value ?? null : `Task ${code("task", value)}`,
    text: (value) => (isBlank(value) ? value ?? null : REDACTED_TEXT),
  };
}

export function anonymizeRow(table, row, pseudonymizer) {
  const rules = PERSONAL_COLUMN_RULES[table];
  if (!rules) return { ...row };
  const result = { ...row };
  for (const [column, rule] of Object.entries(rules)) {
    if (column in result) result[column] = pseudonymizer[rule](result[column]);
  }
  return result;
}

export function anonymizeTableRows(table, rows, pseudonymizer) {
  return rows.map((row) => anonymizeRow(table, row, pseudonymizer));
}

/** The only auth fields kept anywhere: no phone, metadata or sign-in dates. */
export function anonymizeAuthUser(user, pseudonymizer) {
  return {
    id: user.id,
    email: pseudonymizer.email(user.email),
    created_at: user.created_at || null,
  };
}

export function anonymizeTables(tables, pseudonymizer) {
  const result = {};
  for (const [table, rows] of Object.entries(tables)) {
    if (NEVER_EXPORTED_TABLES.has(table)) continue;
    result[table] = anonymizeTableRows(table, rows, pseudonymizer);
  }
  return result;
}

/** Snapshot of a whole project, safe to write to disk. */
export function anonymizeSnapshot(snapshot, pseudonymizer) {
  return {
    ...snapshot,
    anonymized: true,
    authUsers: (snapshot.authUsers || []).map((user) =>
      anonymizeAuthUser(user, pseudonymizer)
    ),
    tables: anonymizeTables(snapshot.tables || {}, pseudonymizer),
  };
}

function addIdentity(target, value) {
  if (isBlank(value)) return;
  const normalized = normalize(value);
  if (isFictionalEmail(normalized)) return;
  if (NON_PERSON_ACTORS.has(normalized)) return;
  if (normalized.length < 3) return;
  target.add(normalized);
}

/**
 * Every real email address and person name visible in the raw source data.
 * The guard refuses any output that still contains one of them.
 *
 * @param {{ authUsers?: any[], tables?: Record<string, any[]> }} source
 * @returns {Set<string>}
 */
export function collectKnownIdentities({ authUsers = [], tables = {} }) {
  const identities = new Set();
  for (const user of authUsers) {
    addIdentity(identities, user.email);
    addIdentity(identities, user.phone);
    for (const key of ["full_name", "name", "display_name"]) {
      addIdentity(identities, user.user_metadata?.[key]);
    }
  }
  for (const [table, rows] of Object.entries(tables)) {
    const rules = Object.entries(PERSONAL_COLUMN_RULES[table] || {});
    for (const row of rows || []) {
      for (const [column, rule] of rules) {
        const value = row[column];
        if (rule === "email" || rule === "person") addIdentity(identities, value);
        // Actors are email addresses; a non-email actor only counts as a
        // person when it looks like "First Last", so one-word process names
        // ("excel", "import") do not block unrelated columns.
        if (rule === "actor" && /@|\s/.test(String(value ?? "").trim())) {
          addIdentity(identities, value);
        }
      }
    }
  }
  // Customers are pseudonymized by their column rule but not hunted
  // elsewhere: they are usually companies whose names can legitimately
  // appear in product or bin names.
  return identities;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function identityMatchers(knownIdentities) {
  return Array.from(knownIdentities, (identity) =>
    identity.includes("@")
      ? (text) => text.includes(identity)
      : (() => {
          const pattern = new RegExp(
            `(^|[^\\p{L}\\p{N}])${escapeRegExp(identity)}($|[^\\p{L}\\p{N}])`,
            "u"
          );
          return (text) => pattern.test(text);
        })()
  );
}

/**
 * Walks every string (including jsonb objects and arrays) and throws when a
 * real email address or a known person name is still present. The message
 * names the location only, never the value.
 */
export function assertNoPersonalData(value, knownIdentities = new Set(), label = "output") {
  const matchers = identityMatchers(knownIdentities);
  const visit = (node, path) => {
    if (typeof node === "string") {
      const emails = node.match(EMAIL_PATTERN) || [];
      if (emails.some((email) => !isFictionalEmail(email))) {
        throw new Error(`Personal-data guard (${label}): real email address at ${path}`);
      }
      const lowered = node.toLowerCase();
      if (matchers.some((matches) => matches(lowered))) {
        throw new Error(`Personal-data guard (${label}): known person at ${path}`);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        if (NEVER_EXPORTED_TABLES.has(key) && path.endsWith(".tables")) {
          throw new Error(`Personal-data guard (${label}): technical table ${key} must not be exported`);
        }
        visit(child, `${path}.${key}`);
      }
    }
  };
  visit(value, "$");
  return value;
}
