import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REDACTED_TEXT,
  anonymizeSnapshot,
  assertNoPersonalData,
  collectKnownIdentities,
  createPseudonymizer,
} from "../../scripts/lib/clone-anonymizer.mjs";

// Fictional people only: none of these addresses or names exist.
const REAL_LOOKING = {
  email: "Jeanne.Martin@entreprise-fictive.be",
  emailLower: "jeanne.martin@entreprise-fictive.be",
  name: "Jeanne Martin",
  phone: "+32470000001",
  otherEmail: "paul.dupont@exemple-societe.eu",
  otherName: "Paul Dupont",
  customer: "Garage Lambert Namur",
  surId: "SUR-778899",
  task: "Appel avec Paul Dupont",
};

function productionSnapshot() {
  return {
    createdAt: "2026-11-12T10:00:00.000Z",
    projectRef: "production",
    storageBuckets: [],
    authUsers: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        email: REAL_LOOKING.email,
        phone: REAL_LOOKING.phone,
        created_at: "2026-01-01T00:00:00Z",
        user_metadata: { full_name: REAL_LOOKING.name },
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        email: REAL_LOOKING.otherEmail,
        phone: null,
        created_at: "2026-01-02T00:00:00Z",
        user_metadata: { name: REAL_LOOKING.otherName, avatar_url: "x" },
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        email: "admin@stockpro.test",
        phone: null,
        created_at: "2026-01-03T00:00:00Z",
        user_metadata: {},
      },
    ],
    tables: {
      profiles: [
        {
          user_id: "11111111-1111-4111-8111-111111111111",
          email: REAL_LOOKING.email,
          full_name: REAL_LOOKING.name,
        },
        {
          user_id: "33333333-3333-4333-8333-333333333333",
          email: "admin@stockpro.test",
          full_name: null,
        },
      ],
      user_roles: [
        { user_id: "11111111-1111-4111-8111-111111111111", role: "admin" },
      ],
      bins: [{ id: "bin-1", name: "FMC880\t4", min_stock: 5 }],
      items: [
        { item_id: "item-1", imei: "990000000099001", status: "IN" },
      ],
      movements: [
        {
          movement_id: "mv-1",
          type: "OUT",
          imei: "990000000099001",
          qty: 1,
          shipment_ref: "SO-12345",
          actor: REAL_LOOKING.emailLower,
          notes: `Remis en main propre à ${REAL_LOOKING.otherName}`,
        },
        {
          movement_id: "mv-2",
          type: "IN",
          imei: "990000000099002",
          qty: 1,
          actor: "unknown",
          notes: null,
        },
      ],
      accessory_movements: [
        {
          id: "am-1",
          qty: 3,
          actor: REAL_LOOKING.otherEmail,
          note: "",
          comment: `Voir ${REAL_LOOKING.email}`,
        },
      ],
      inbound_batches: [
        { batch_id: "b-1", actor: REAL_LOOKING.email, vendor: "Teltonika" },
      ],
      nrd_time_logs: [
        {
          id: "nrd-1",
          user_email: REAL_LOOKING.emailLower,
          task: REAL_LOOKING.task,
          duration_minutes: 30,
        },
        {
          id: "nrd-2",
          user_email: REAL_LOOKING.email,
          task: REAL_LOOKING.task,
          duration_minutes: 15,
        },
      ],
      return_records: [
        {
          id: "rr-1",
          actor: REAL_LOOKING.otherEmail,
          customer: REAL_LOOKING.customer,
          sur_id: REAL_LOOKING.surId,
          courier: "DHL",
          return_reason: "Defective",
          template_exported_by_email: REAL_LOOKING.email,
        },
        {
          id: "rr-2",
          actor: REAL_LOOKING.otherEmail,
          customer: REAL_LOOKING.customer,
          sur_id: REAL_LOOKING.surId,
        },
      ],
      supplies: [
        {
          id: "sup-1",
          order_number: "ORD-1",
          tracking_number: "1Z999",
          created_by: REAL_LOOKING.email,
          comment: `Urgent pour ${REAL_LOOKING.name}`,
          failed_reason: null,
        },
      ],
      supply_status_history: [
        {
          id: "ssh-1",
          changed_by: REAL_LOOKING.otherEmail,
          failed_reason: "Adresse de Paul incorrecte",
        },
      ],
      alert_subscribers: [{ id: "as-1", email: REAL_LOOKING.otherEmail }],
      connection_events: [
        {
          id: "ce-1",
          email: REAL_LOOKING.email,
          ip_address: "203.0.113.7",
          user_agent: "Mozilla/5.0",
        },
      ],
      app_sessions: [{ user_id: "11111111-1111-4111-8111-111111111111" }],
    },
  };
}

const REAL_STRINGS = [
  REAL_LOOKING.email,
  REAL_LOOKING.emailLower,
  REAL_LOOKING.name,
  REAL_LOOKING.phone,
  REAL_LOOKING.otherEmail,
  REAL_LOOKING.otherName,
  REAL_LOOKING.customer,
  REAL_LOOKING.surId,
  REAL_LOOKING.task,
  "entreprise-fictive",
  "exemple-societe",
  "203.0.113.7",
  "Mozilla",
];

function anonymized(secret = Buffer.from("test-secret")) {
  const raw = productionSnapshot();
  const knownIdentities = collectKnownIdentities(raw);
  const snapshot = anonymizeSnapshot(raw, createPseudonymizer({ secret }));
  return { raw, knownIdentities, snapshot };
}

describe("clone anonymizer", () => {
  it("lets no real email, name, phone, customer or IP through", () => {
    const { snapshot } = anonymized();
    const output = JSON.stringify(snapshot).toLowerCase();
    for (const value of REAL_STRINGS) {
      expect(output, value).not.toContain(value.toLowerCase());
    }
    expect(output).not.toMatch(/@(?!stockpro\.test)[a-z0-9-]+\./);
  });

  it("gives the same person the same alias in every table", () => {
    const { snapshot } = anonymized();
    const alias = snapshot.authUsers[0].email;
    expect(alias).toMatch(/^user-[0-9a-f]{10}@stockpro\.test$/);
    expect(snapshot.tables.profiles[0].email).toBe(alias);
    expect(snapshot.tables.movements[0].actor).toBe(alias);
    expect(snapshot.tables.inbound_batches[0].actor).toBe(alias);
    expect(snapshot.tables.nrd_time_logs[0].user_email).toBe(alias);
    expect(snapshot.tables.nrd_time_logs[1].user_email).toBe(alias);
    expect(snapshot.tables.supplies[0].created_by).toBe(alias);
    expect(snapshot.tables.return_records[0].template_exported_by_email).toBe(alias);

    const other = snapshot.authUsers[1].email;
    expect(other).not.toBe(alias);
    expect(snapshot.tables.accessory_movements[0].actor).toBe(other);
    expect(snapshot.tables.return_records[0].actor).toBe(other);
    expect(snapshot.tables.supply_status_history[0].changed_by).toBe(other);
    expect(snapshot.tables.alert_subscribers[0].email).toBe(other);
  });

  it("keeps fictional staging addresses and process actors unchanged", () => {
    const { snapshot } = anonymized();
    expect(snapshot.authUsers[2].email).toBe("admin@stockpro.test");
    expect(snapshot.tables.profiles[1].email).toBe("admin@stockpro.test");
    expect(snapshot.tables.movements[1].actor).toBe("unknown");
  });

  it("keeps stock data intact", () => {
    const { raw, snapshot } = anonymized();
    expect(snapshot.tables.bins).toEqual(raw.tables.bins);
    expect(snapshot.tables.items).toEqual(raw.tables.items);
    expect(snapshot.tables.user_roles).toEqual(raw.tables.user_roles);
    const movement = snapshot.tables.movements[0];
    expect(movement).toMatchObject({
      movement_id: "mv-1",
      type: "OUT",
      imei: "990000000099001",
      qty: 1,
      shipment_ref: "SO-12345",
    });
    expect(snapshot.tables.supplies[0]).toMatchObject({
      order_number: "ORD-1",
      tracking_number: "1Z999",
    });
    expect(snapshot.tables.return_records[0]).toMatchObject({
      courier: "DHL",
      return_reason: "Defective",
    });
  });

  it("redacts free text and pseudonymizes customers and tasks consistently", () => {
    const { snapshot } = anonymized();
    expect(snapshot.tables.movements[0].notes).toBe(REDACTED_TEXT);
    expect(snapshot.tables.movements[1].notes).toBeNull();
    expect(snapshot.tables.accessory_movements[0].note).toBe("");
    expect(snapshot.tables.accessory_movements[0].comment).toBe(REDACTED_TEXT);
    expect(snapshot.tables.supplies[0].comment).toBe(REDACTED_TEXT);
    expect(snapshot.tables.supplies[0].failed_reason).toBeNull();
    expect(snapshot.tables.supply_status_history[0].failed_reason).toBe(REDACTED_TEXT);
    expect(snapshot.tables.profiles[0].full_name).toMatch(/^User [0-9a-f]{10}$/);

    const [first, second] = snapshot.tables.return_records;
    expect(first.customer).toMatch(/^Customer [0-9a-f]{10}$/);
    expect(second.customer).toBe(first.customer);
    expect(first.sur_id).toMatch(/^SUR-[0-9a-f]{10}$/);
    expect(second.sur_id).toBe(first.sur_id);

    const [taskA, taskB] = snapshot.tables.nrd_time_logs;
    expect(taskA.task).toMatch(/^Task [0-9a-f]{10}$/);
    expect(taskB.task).toBe(taskA.task);
  });

  it("keeps only id, alias and creation date of auth users", () => {
    const { snapshot } = anonymized();
    for (const user of snapshot.authUsers) {
      expect(Object.keys(user).sort()).toEqual(["created_at", "email", "id"]);
    }
  });

  it("never exports sessions, connections or quota tables", () => {
    const { snapshot } = anonymized();
    expect(snapshot.tables).not.toHaveProperty("connection_events");
    expect(snapshot.tables).not.toHaveProperty("app_sessions");
    expect(snapshot.anonymized).toBe(true);
  });

  it("uses a per-run secret so aliases cannot be rebuilt from known emails", () => {
    const a = createPseudonymizer({ secret: Buffer.from("run-a") });
    const b = createPseudonymizer({ secret: Buffer.from("run-b") });
    const again = createPseudonymizer({ secret: Buffer.from("run-a") });
    expect(a.email(REAL_LOOKING.email)).not.toBe(b.email(REAL_LOOKING.email));
    expect(a.email(REAL_LOOKING.email)).toBe(again.email(REAL_LOOKING.emailLower));
    const random1 = createPseudonymizer().email(REAL_LOOKING.email);
    const random2 = createPseudonymizer().email(REAL_LOOKING.email);
    expect(random1).not.toBe(random2);
  });
});

describe("personal-data guard", () => {
  it("accepts the anonymized snapshot", () => {
    const { snapshot, knownIdentities } = anonymized();
    expect(() =>
      assertNoPersonalData(snapshot, knownIdentities, "test")
    ).not.toThrow();
  });

  it("refuses the raw snapshot without echoing the value", () => {
    const { raw, knownIdentities } = anonymized();
    let message = "";
    try {
      assertNoPersonalData(raw, knownIdentities, "raw");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/Personal-data guard/);
    for (const value of REAL_STRINGS) {
      expect(message.toLowerCase()).not.toContain(value.toLowerCase());
    }
  });

  it("catches a real email hidden in jsonb or an unexpected column", () => {
    expect(() =>
      assertNoPersonalData({ result: { nested: ["ok", "x@real-company.com"] } })
    ).toThrow(/real email address at \$\.result\.nested\[1\]/);
    expect(() => assertNoPersonalData({ note: "a@stockpro.test" })).not.toThrow();
  });

  it("catches a known name left in a column without a rule", () => {
    const raw = productionSnapshot();
    raw.tables.inbound_batches[0] = {
      ...raw.tables.inbound_batches[0],
      vendor: `Livré par ${REAL_LOOKING.name}`,
    };
    const knownIdentities = collectKnownIdentities(raw);
    const snapshot = anonymizeSnapshot(raw, createPseudonymizer());
    expect(() =>
      assertNoPersonalData(snapshot, knownIdentities, "Staging inbound_batches")
    ).toThrow(/known person at \$\.tables\.inbound_batches\[0\]\.vendor/);
  });

  it("does not flag a name that only appears inside a longer word", () => {
    const identities = new Set(["ali"]);
    expect(() => assertNoPersonalData({ name: "Alignment kit" }, identities)).not.toThrow();
    expect(() => assertNoPersonalData({ name: "Box of Ali" }, identities)).toThrow();
  });

  it("refuses a technical table placed in an export", () => {
    expect(() =>
      assertNoPersonalData({ tables: { connection_events: [] } })
    ).toThrow(/technical table connection_events/);
  });
});

describe("newer tables (packaging, dispatch, NRD schedules, IT contacts)", () => {
  const pseudonymizer = () => createPseudonymizer({ secret: Buffer.from("t") });

  function newerSnapshot() {
    const raw = productionSnapshot();
    Object.assign(raw.tables, {
      packaging_types: [
        {
          id: "pt-1",
          code: "BOX-S",
          name: "Small box",
          on_hand_stock: 120,
          created_by_email: REAL_LOOKING.email,
          updated_by_email: REAL_LOOKING.otherEmail,
        },
      ],
      packaging_rules: [
        { id: "pr-1", packaging_type_id: "pt-1", quantity: 1, updated_by_email: REAL_LOOKING.email },
      ],
      packaging_stock_movements: [
        { id: "psm-1", on_hand_delta: -1, reason: "Daily dispatch Commandes Garage Lambert Namur.xlsx", actor_email: REAL_LOOKING.email },
        { id: "psm-2", on_hand_delta: 1, reason: "Undo daily dispatch Commandes Garage Lambert Namur.xlsx", actor_email: REAL_LOOKING.email },
        { id: "psm-3", on_hand_delta: 5, reason: "Initial stock set in Packaging Inventory", actor_email: REAL_LOOKING.otherEmail },
        { id: "psm-4", on_hand_delta: -2, reason: `Cassé par ${REAL_LOOKING.otherName}`, actor_email: REAL_LOOKING.otherEmail },
      ],
      dispatch_batches: [
        {
          id: "db-1",
          source_filename: "Commandes Garage Lambert Namur.xlsx",
          actor_email: REAL_LOOKING.email,
          undone_by_email: null,
          order_count: 1,
          orders: [
            {
              orderId: "SO-1",
              companyName: REAL_LOOKING.customer,
              destinationCountry: "BE",
              items: [{ name: "FMC880", quantity: 2 }],
            },
          ],
          package_usage: [{ code: "BOX-S", quantity: 1 }],
        },
      ],
      dispatch_packaging_preferences: [
        { composition_key: "k", package_quantity: 1, last_actor_email: REAL_LOOKING.email },
      ],
      dispatch_plans: [
        {
          id: "dp-1",
          planner_email: REAL_LOOKING.email,
          closed_by_email: REAL_LOOKING.otherEmail,
          source_filename: "Commandes Garage Lambert Namur.xlsx",
          orders: [{ orderId: "SO-1", companyName: REAL_LOOKING.customer, deviceCount: 2 }],
          labels: [{ orderId: "SO-1", deviceModel: "FMC880", registration: "1-ABC-123" }],
        },
      ],
      dispatch_plan_assignments: [
        { plan_id: "dp-1", order_id: "SO-1", assignee_email: REAL_LOOKING.otherEmail, assigned_by_email: REAL_LOOKING.email },
      ],
      nrd_schedules: [
        { id: "ns-1", user_email: REAL_LOOKING.email, task: REAL_LOOKING.task, start_time: "08:00" },
      ],
      security_alert_recipients: [
        { user_id: "u-2", added_by_email: REAL_LOOKING.email },
      ],
      device_inbound_accessories: [{ id: "dia-1", device_id: "b-1", accessory_bin_id: "a-1", quantity: 1 }],
      device_thresholds: [{ device: "FMC880", min_stock: 5 }],
      audit_events: [{ audit_id: "ae-1", payload: { by: REAL_LOOKING.email } }],
      alert_log: [{ id: "al-1", device: "FMC880", sent_to: REAL_LOOKING.otherEmail }],
    });
    return raw;
  }

  function anonymizedNewer() {
    const raw = newerSnapshot();
    const knownIdentities = collectKnownIdentities(raw);
    const snapshot = anonymizeSnapshot(raw, pseudonymizer());
    return { raw, knownIdentities, snapshot };
  }

  it("lets no real email, customer, plate or free text through", () => {
    const { snapshot, knownIdentities } = anonymizedNewer();
    const output = JSON.stringify(snapshot).toLowerCase();
    for (const value of [...REAL_STRINGS, "1-abc-123", "garage lambert"]) {
      expect(output, value).not.toContain(value.toLowerCase());
    }
    expect(output).not.toMatch(/@(?!stockpro\.test)[a-z0-9-]+\./);
    expect(() => assertNoPersonalData(snapshot, knownIdentities, "newer")).not.toThrow();
  });

  it("uses the same alias and customer code as the older tables", () => {
    const { snapshot } = anonymizedNewer();
    const alias = snapshot.authUsers[0].email;
    const other = snapshot.authUsers[1].email;
    const t = snapshot.tables;
    expect(t.packaging_types[0].created_by_email).toBe(alias);
    expect(t.packaging_types[0].updated_by_email).toBe(other);
    expect(t.packaging_rules[0].updated_by_email).toBe(alias);
    expect(t.packaging_stock_movements[0].actor_email).toBe(alias);
    expect(t.dispatch_batches[0].actor_email).toBe(alias);
    expect(t.dispatch_batches[0].undone_by_email).toBeNull();
    expect(t.dispatch_packaging_preferences[0].last_actor_email).toBe(alias);
    expect(t.dispatch_plans[0].planner_email).toBe(alias);
    expect(t.dispatch_plans[0].closed_by_email).toBe(other);
    expect(t.dispatch_plan_assignments[0].assignee_email).toBe(other);
    expect(t.dispatch_plan_assignments[0].assigned_by_email).toBe(alias);
    expect(t.nrd_schedules[0].user_email).toBe(alias);
    expect(t.security_alert_recipients[0].added_by_email).toBe(alias);

    const customer = t.return_records[0].customer;
    expect(t.dispatch_batches[0].orders[0].companyName).toBe(customer);
    expect(t.dispatch_plans[0].orders[0].companyName).toBe(customer);
    expect(t.nrd_schedules[0].task).toBe(t.nrd_time_logs[0].task);
  });

  it("keeps dispatch and packaging figures readable", () => {
    const { raw, snapshot } = anonymizedNewer();
    const rawTables = raw.tables as Record<string, unknown[]>;
    const t = snapshot.tables;
    const [order] = t.dispatch_batches[0].orders;
    expect(order).toMatchObject({
      orderId: "SO-1",
      destinationCountry: "BE",
      items: [{ name: "FMC880", quantity: 2 }],
    });
    expect(t.dispatch_batches[0].package_usage).toEqual([{ code: "BOX-S", quantity: 1 }]);
    expect(t.dispatch_batches[0].order_count).toBe(1);
    expect(t.packaging_types[0]).toMatchObject({ code: "BOX-S", name: "Small box", on_hand_stock: 120 });
    expect(t.device_inbound_accessories).toEqual(rawTables.device_inbound_accessories);
    expect(t.device_thresholds).toEqual(rawTables.device_thresholds);
    expect(t.dispatch_plans[0].labels[0]).toMatchObject({ orderId: "SO-1", deviceModel: "FMC880" });
    expect(t.dispatch_plans[0].labels[0].registration).toMatch(/^REG-[0-9a-f]{10}$/);
    expect(t.nrd_schedules[0].start_time).toBe("08:00");
  });

  it("keeps the readable part of packaging reasons and codes the file name", () => {
    const { snapshot } = anonymizedNewer();
    const t = snapshot.tables;
    const file = t.dispatch_batches[0].source_filename;
    expect(file).toMatch(/^Dispatch file [0-9a-f]{10}$/);
    expect(t.dispatch_plans[0].source_filename).toBe(file);
    expect(t.packaging_stock_movements.map((row: { reason: string }) => row.reason)).toEqual([
      `Daily dispatch ${file}`,
      `Undo daily dispatch ${file}`,
      "Initial stock set in Packaging Inventory",
      REDACTED_TEXT,
    ]);
  });

  it("never exports the legacy audit and alert tables", () => {
    const { snapshot } = anonymizedNewer();
    expect(snapshot.tables).not.toHaveProperty("audit_events");
    expect(snapshot.tables).not.toHaveProperty("alert_log");
  });
});

describe("clone script wiring", () => {
  const script = readFileSync(
    join(process.cwd(), "scripts/clone-production-data-to-staging.mjs"),
    "utf8"
  );

  it("guards every local file and every Staging insert", () => {
    expect(script).toMatch(
      /async function writeArtifact\(name, value, knownIdentities = new Set\(\)\) \{\n\s+assertNoPersonalData\(value, knownIdentities, name\);/
    );
    expect(script).toContain(
      "assertNoPersonalData(transformed, knownIdentities, `Staging ${table}`);"
    );
    expect(script).toContain("createStagingUsers(\n    stagingClient,\n    productionSnapshot.authUsers,");
  });

  it("creates Staging users without Production metadata or ids in the credentials file", () => {
    expect(script).toContain("app_metadata: {},\n      user_metadata: {},");
    expect(script).not.toContain("user.app_metadata");
    expect(script).not.toContain("production_user_id");
  });

  it("no longer writes raw Production or legacy tables to disk", () => {
    expect(script).not.toContain("LEGACY_PRODUCTION_SNAPSHOT_TABLES");
    expect(script).not.toContain("safeAuthUser");
    expect(script).not.toMatch(/writeArtifact\([^)]*productionUsers/);
  });

  function listedTables(name: string) {
    const match = script.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
    expect(match, name).not.toBeNull();
    return Array.from(match![1].matchAll(/"([a-z_]+)"/g), (entry) => entry[1]);
  }

  it("clears every known table and knows how to delete it", () => {
    const candidates = listedTables("TABLE_CANDIDATES");
    const deleteOrder = listedTables("DELETE_ORDER");
    const copyOrder = listedTables("COPY_ORDER");
    const clearedOnly = listedTables("CLEARED_NOT_COPIED");
    for (const table of [
      "packaging_types",
      "packaging_stock_movements",
      "packaging_rules",
      "dispatch_batches",
      "dispatch_plans",
      "dispatch_plan_assignments",
      "dispatch_packaging_preferences",
      "nrd_schedules",
      "audit_events",
      "security_alert_recipients",
      "device_inbound_accessories",
      "device_thresholds",
      "alert_log",
    ]) {
      expect(candidates, table).toContain(table);
    }
    for (const table of candidates) {
      expect(deleteOrder, table).toContain(table);
      expect(script, table).toMatch(new RegExp(`\\n  ${table}: "`));
    }
    for (const table of clearedOnly) {
      expect(copyOrder, table).not.toContain(table);
    }
    expect(copyOrder.indexOf("nrd_schedules")).toBeLessThan(copyOrder.indexOf("nrd_time_logs"));
    expect(copyOrder.indexOf("dispatch_batches")).toBeLessThan(
      copyOrder.indexOf("dispatch_packaging_preferences")
    );
  });
});
