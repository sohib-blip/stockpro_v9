import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table?: string; op: string; payload?: unknown; filter?: unknown };

const state = {
  calls: [] as Call[],
  rpcError: null as null | { message: string },
  insertError: null as null | { code?: string; message: string },
};

function tableApi(table: string) {
  return {
    insert(payload: unknown) {
      state.calls.push({ table, op: "insert", payload });
      return {
        select: () => ({
          single: async () =>
            state.insertError
              ? { data: null, error: state.insertError }
              : { data: { id: "11111111-1111-4111-8111-111111111111" }, error: null },
        }),
      };
    },
    update(payload: unknown) {
      return {
        eq: async (column: string, value: unknown) => {
          state.calls.push({ table, op: "update", payload, filter: [column, value] });
          return { error: null };
        },
      };
    },
    delete() {
      return {
        eq: async (column: string, value: unknown) => {
          state.calls.push({ table, op: "delete", filter: [column, value] });
          return { error: null };
        },
      };
    },
  };
}

const client = {
  from: (table: string) => tableApi(table),
  rpc: async (name: string, payload: unknown) => {
    state.calls.push({ op: `rpc:${name}`, payload });
    return { data: state.rpcError ? null : { ok: true }, error: state.rpcError };
  },
};

vi.mock("@supabase/supabase-js", () => ({ createClient: () => client }));
vi.mock("@/lib/accessory-bin-input", () => import("../../lib/accessory-bin-input"));
vi.mock("@/lib/accessory-stock-count", () => import("../../lib/accessory-stock-count"));
vi.mock("@/lib/dispatch-dimensions-input", () => import("../../lib/dispatch-dimensions-input"));
vi.mock("@/lib/api-identity", () => import("../../lib/api-identity"));
vi.mock("@/app/api/dispatch-planning/_server", () => ({
  isMissingDispatchColumns: () => false,
  loadDispatchInventoryItems: async () => ({ available: false, items: [] }),
}));

const ACTOR = {
  "x-stockpro-user-id": "22222222-2222-4222-8222-222222222222",
  "x-stockpro-user-email": "admin@stockpro.test",
  "x-stockpro-user-role": "admin",
};

function post(body: unknown) {
  return new Request("http://localhost/api/accessory-bins", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ACTOR },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.calls = [];
  state.rpcError = null;
  state.insertError = null;
});

describe("accessory creation records the initial stock", () => {
  it("creates the accessory at 0 and sets the initial stock with a movement", async () => {
    const { POST } = await import("../../app/api/accessory-bins/create/route");
    const res = await POST(post({ name: "E2E Cable", current_stock: 40, minimum_stock: 5, category: "Harness" }));

    expect(res.status).toBe(200);
    expect(state.calls[0]).toMatchObject({
      table: "accessory_bins",
      op: "insert",
      payload: { name: "E2E Cable", current_stock: 0, minimum_stock: 5, category: "Harness" },
    });
    expect(state.calls[1]).toMatchObject({
      op: "rpc:save_accessory_stock_count",
      payload: {
        p_accessory_bin_id: "11111111-1111-4111-8111-111111111111",
        p_stock: 40,
        p_actor_id: ACTOR["x-stockpro-user-id"],
        p_actor: "admin@stockpro.test",
        p_reason: "Initial stock set in Inventory Setup",
      },
    });
    expect((state.calls[1].payload as { p_operation_id: string }).p_operation_id).toMatch(
      /^[0-9a-f-]{36}$/
    );
  });

  it("records nothing for an accessory created with no stock", async () => {
    const { POST } = await import("../../app/api/accessory-bins/create/route");
    const res = await POST(post({ name: "E2E Empty", current_stock: 0 }));

    expect(res.status).toBe(200);
    expect(state.calls.map((call) => call.op)).toEqual(["insert"]);
  });

  it("removes the new accessory again when the initial stock cannot be saved", async () => {
    state.rpcError = { message: "boom" };
    const { POST } = await import("../../app/api/accessory-bins/create/route");
    const res = await POST(post({ name: "E2E Cable", current_stock: 40 }));

    expect(res.status).toBe(500);
    expect(state.calls.map((call) => call.op)).toEqual([
      "insert",
      "rpc:save_accessory_stock_count",
      "delete",
    ]);
    expect(state.calls[2].filter).toEqual(["id", "11111111-1111-4111-8111-111111111111"]);
  });

  it("keeps the duplicate-name message", async () => {
    state.insertError = { code: "23505", message: "duplicate" };
    const { POST } = await import("../../app/api/accessory-bins/create/route");
    const res = await POST(post({ name: "E2E Cable", current_stock: 40 }));

    expect(res.status).toBe(409);
    expect(state.calls.map((call) => call.op)).toEqual(["insert"]);
  });
});

describe("accessory edits record the stock count", () => {
  it("saves the other fields without the stock, then the stock with a movement", async () => {
    const { POST } = await import("../../app/api/accessory-bins/update/route");
    const res = await POST(
      post({ id: "33333333-3333-4333-8333-333333333333", name: "E2E Cable", current_stock: 37, minimum_stock: 5, category: "Harness" })
    );

    expect(res.status).toBe(200);
    expect(state.calls[0]).toMatchObject({ table: "accessory_bins", op: "update" });
    expect(state.calls[0].payload).not.toHaveProperty("current_stock");
    expect(state.calls[1]).toMatchObject({
      op: "rpc:save_accessory_stock_count",
      payload: {
        p_accessory_bin_id: "33333333-3333-4333-8333-333333333333",
        p_stock: 37,
        p_reason: "Stock count updated in Inventory Setup",
      },
    });
  });

  it("says when the stock could not be saved", async () => {
    state.rpcError = { message: "boom" };
    const { POST } = await import("../../app/api/accessory-bins/update/route");
    const res = await POST(post({ id: "33333333-3333-4333-8333-333333333333", name: "E2E Cable", current_stock: 37 }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain("the stock was not");
  });
});

describe("accessory stock count migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/20261112100000_trace_accessory_stock_counts.sql"),
    "utf8"
  )
    .replace(/--.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  it("runs in one transaction and only adds nullable columns", () => {
    expect(sql.startsWith("begin;")).toBe(true);
    expect(sql.endsWith("commit;")).toBe(true);
    expect(sql).toContain("add column if not exists stock_before integer");
    expect(sql).toContain("add column if not exists stock_after integer");
    expect(sql).not.toMatch(/\b(delete from|truncate|drop table)\b/i);
  });

  it("locks the accessory, reads the stock before and records before/after", () => {
    expect(sql).toContain("where bin.id = p_accessory_bin_id for update");
    expect(sql).toContain("if v_before <> p_stock then");
    expect(sql).toContain("'ADJUSTMENT'");
    expect(sql).toContain("abs(p_stock - v_before)");
    expect(sql).toMatch(/stock_before, stock_after \) values \(.*v_before, p_stock \)/);
  });

  it("can only be called by the server", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("from public, anon, authenticated;");
    expect(sql).toContain(") to service_role;");
  });
});
