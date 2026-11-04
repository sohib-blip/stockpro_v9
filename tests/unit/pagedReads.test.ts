/* eslint-disable @typescript-eslint/no-explicit-any -- the fake PostgREST client handles untyped rows of any table */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import {
  readAllPages,
  readInChunks,
  rowsOrThrow,
} from "../../lib/supabase/read-all-pages";

// A fake Supabase client that behaves like PostgREST where it matters here:
// every response stops at `cap` rows (max_rows), and rows that tie on the
// requested order come back in a different random order on every request, as
// a real database may do. A route that pages on a non-unique order therefore
// repeats or skips rows, and a route that reads in one request is truncated.
type Row = Record<string, any>;

const fake = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  cap: 1000,
  authPageCap: 50,
  users: [] as Row[],
  requests: [] as { table: string; url: number }[],
  random: () => Math.random(),
  qrContents: [] as string[],
}));

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

class FakeQuery implements PromiseLike<{ data: Row[] | null; error: any }> {
  private filters: ((row: Row) => boolean)[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private window: [number, number] | null = null;
  private singleRow = false;
  private inSize = 0;

  constructor(private table: string) {}

  select() {
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  not(column: string, operator: string, value: unknown) {
    if (operator !== "is" || value !== null) throw new Error("unsupported not");
    this.filters.push((row) => row[column] !== null && row[column] !== undefined);
    return this;
  }
  gte(column: string, value: any) {
    this.filters.push((row) => row[column] >= value);
    return this;
  }
  lt(column: string, value: any) {
    this.filters.push((row) => row[column] < value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.inSize = values.length;
    const set = new Set(values);
    this.filters.push((row) => set.has(row[column]));
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }
  range(from: number, to: number) {
    this.window = [from, to];
    return this;
  }
  single() {
    this.singleRow = true;
    return this;
  }

  private run() {
    fake.requests.push({ table: this.table, url: this.inSize });
    if (this.inSize > 300) {
      return { data: null, error: { message: "URI too long" } };
    }
    const rows = (fake.tables[this.table] || [])
      .filter((row) => this.filters.every((keep) => keep(row)))
      .map((row) => ({ row, tie: fake.random() }));
    rows.sort((a, b) => {
      for (const { column, ascending } of this.orders) {
        const left = a.row[column];
        const right = b.row[column];
        if (left === right) continue;
        return (left < right ? -1 : 1) * (ascending ? 1 : -1);
      }
      return a.tie - b.tie;
    });
    let result = rows.map(({ row }) => ({ ...row }));
    if (this.singleRow) return { data: result[0] ?? null, error: null } as any;
    if (this.window) result = result.slice(this.window[0], this.window[1] + 1);
    return { data: result.slice(0, fake.cap), error: null };
  }

  then<A = { data: Row[] | null; error: any }, B = never>(
    onFulfilled?: ((value: { data: Row[] | null; error: any }) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: any) => B | PromiseLike<B>) | null
  ) {
    return Promise.resolve(this.run()).then(onFulfilled, onRejected);
  }
}

const client = vi.hoisted(() => ({
  from: (table: string) => new (globalThis as any).__FakeQuery(table),
  auth: {
    admin: {
      listUsers: async ({ page, perPage }: { page: number; perPage: number }) => {
        // GoTrue may use a smaller page size than requested.
        const size = Math.min(perPage, fake.authPageCap);
        const users = fake.users.slice((page - 1) * size, page * size);
        return { data: { users }, error: null };
      },
    },
  },
}));
(globalThis as any).__FakeQuery = FakeQuery;

vi.mock("@supabase/supabase-js", () => ({ createClient: () => client }));
// Vitest has no "@/" alias here: route imports of real modules are pointed at
// the actual files, the others are replaced by small fakes.
vi.mock("@/lib/supabase/read-all-pages", () => import("../../lib/supabase/read-all-pages"));
vi.mock("@/lib/supply-orders", () => import("../../lib/supply-orders"));
vi.mock("@/lib/returns", () => import("../../lib/returns"));
vi.mock("@/lib/access-control", () => import("../../lib/access-control"));
vi.mock("@/lib/site-url", () => import("../../lib/site-url"));
vi.mock("@/lib/auth", () => ({
  supabaseService: () => client,
  authorizeApiRequest: async () => ({
    ok: true,
    user: { id: "admin-user", email: "admin@stockpro.test" },
  }),
}));
vi.mock("@/lib/security-alert-recipients", () => ({
  securityAlertRecipientIds: async () => new Set<string>(),
  saveSecurityAlertRecipient: async () => undefined,
}));
vi.mock("@/lib/nrd-sync", () => ({ trySyncNrdForEveryone: async () => undefined }));
vi.mock("@/lib/api-identity", () => ({
  getApiIdentity: () => ({ email: "admin@stockpro.test" }),
}));
vi.mock("qrcode", () => ({
  default: {
    toDataURL: async (text: string) => {
      fake.qrContents.push(text);
      return `data:image/png;base64,${PIXEL_PNG}`;
    },
  },
}));

const PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const ROWS = 2500;
const SAME_TIME = "2026-11-04T08:00:00.000Z";
const pad = (n: number, width = 4) => String(n).padStart(width, "0");
const imei = (n: number) => `9900000000${pad(n, 5)}`;
const uuid = (prefix: string, n: number) =>
  `${prefix}000000-0000-4000-8000-${pad(n, 12)}`;

function boxesAndBins(boxCount: number) {
  return {
    boxes: Array.from({ length: boxCount }, (_, i) => ({
      id: uuid("b0", i),
      box_code: `BOX-${pad(i)}`,
      floor: "1",
      bin_id: uuid("d0", i % 3),
    })),
    bins: Array.from({ length: 3 }, (_, i) => ({
      id: uuid("d0", i),
      name: `Device ${i}`,
    })),
  };
}

function sheetRows(body: ArrayBuffer, sheet?: string) {
  const workbook = XLSX.read(new Uint8Array(body), { type: "array" });
  return XLSX.utils.sheet_to_json<Row>(
    workbook.Sheets[sheet ?? workbook.SheetNames[0]]
  );
}

function expectAllOnce(values: unknown[], expected: unknown[]) {
  expect(values).toHaveLength(expected.length);
  expect(new Set(values).size).toBe(expected.length);
  expect([...values].sort()).toEqual([...expected].sort());
}

beforeEach(() => {
  fake.tables = {};
  fake.cap = 1000;
  fake.users = [];
  fake.requests = [];
  fake.random = seededRandom(42);
  fake.qrContents = [];
});

describe("readAllPages", () => {
  it("reads past the response cap, even when the cap is below the page size", async () => {
    const source = Array.from({ length: ROWS }, (_, i) => i);
    const requests: [number, number][] = [];
    const rows = await readAllPages(async (from, to) => {
      requests.push([from, to]);
      return source.slice(from, Math.min(to + 1, from + 400));
    });
    expect(rows).toEqual(source);
    expect(requests[0]).toEqual([0, 999]);
    expect(requests[1]).toEqual([400, 1399]);
    expect(requests.at(-1)).toEqual([ROWS, ROWS + 999]);
  });

  it("stops on an empty or missing page and refuses endless reads", async () => {
    expect(await readAllPages(async () => null)).toEqual([]);
    await expect(readAllPages(async () => [1])).rejects.toThrow("too many pages");
    await expect(readAllPages(async () => [], 0)).rejects.toThrow("page size");
  });

  it("passes database errors through instead of returning a partial list", async () => {
    let calls = 0;
    await expect(
      readAllPages(async () => {
        calls += 1;
        return rowsOrThrow(
          calls === 1
            ? { data: [1, 2, 3], error: null }
            : { data: null, error: new Error("connection lost") }
        );
      })
    ).rejects.toThrow("connection lost");
  });
});

describe("readInChunks", () => {
  it("looks ids up in small unique chunks", async () => {
    const ids = [...Array.from({ length: 450 }, (_, i) => i), 1, 2, 3];
    const chunks: number[][] = [];
    const rows = await readInChunks(ids, async (chunk) => {
      chunks.push(chunk);
      return chunk.map((id) => ({ id }));
    });
    expect(chunks.map((chunk) => chunk.length)).toEqual([200, 200, 50]);
    expect(rows.map((row) => row.id)).toEqual(
      Array.from({ length: 450 }, (_, i) => i)
    );
    expect(await readInChunks([], async () => [{ id: 1 }])).toEqual([]);
  });
});

describe("routes past the 1,000-row cap", () => {
  it("outbound export lists every IMEI of an End-of-Day outbound", async () => {
    const { boxes, bins } = boxesAndBins(400);
    fake.tables = {
      boxes,
      bins,
      movements: [
        ...Array.from({ length: ROWS }, (_, i) => ({
          movement_id: uuid("a0", i),
          type: "OUT",
          operation_id: "op-eod",
          created_at: SAME_TIME,
          actor: "picker@stockpro.test",
          imei: imei(i),
          box_id: boxes[i % boxes.length].id,
          device_id: bins[i % 3].id,
        })),
        {
          movement_id: uuid("a1", 1),
          type: "OUT",
          operation_id: "other-op",
          created_at: SAME_TIME,
          imei: "990000000099999",
        },
      ],
    };

    const { GET } = await import("../../app/api/outbound/export/route");
    const response = await GET(
      new Request("http://localhost/api/outbound/export?operation_id=op-eod")
    );
    expect(response.status).toBe(200);
    const rows = sheetRows(await response.arrayBuffer());
    expectAllOnce(
      rows.map((row) => row.IMEI),
      Array.from({ length: ROWS }, (_, i) => imei(i))
    );
    expect(rows.every((row) => row["Box ID"] && row.Device)).toBe(true);
    expect(fake.requests.every((request) => request.url <= 200)).toBe(true);
  });

  it("returns export lists every return", async () => {
    fake.tables = {
      bins: [{ id: "device-1", name: "FMC130" }],
      return_records: Array.from({ length: ROWS }, (_, i) => ({
        id: uuid("c0", i),
        created_at: SAME_TIME,
        imei: imei(i),
        device_id: "device-1",
        return_status: "available",
        stock_action: "restocked",
      })),
    };

    const { GET } = await import("../../app/api/returns/export/route");
    const response = await GET();
    expect(response.status).toBe(200);
    const rows = sheetRows(await response.arrayBuffer());
    expectAllOnce(
      rows.map((row) => row.IMEI),
      Array.from({ length: ROWS }, (_, i) => imei(i))
    );
    expect(rows[0].Device).toBe("FMC130");
  });

  it("global NRD export counts every task of the month", async () => {
    fake.tables = {
      nrd_time_logs: [
        ...Array.from({ length: ROWS }, (_, i) => ({
          id: uuid("e0", i),
          user_email: `user${i % 2}@stockpro.test`,
          task: `Task ${i}`,
          started_at: "2026-10-15T08:00:00.000Z",
          ended_at: "2026-10-15T08:30:00.000Z",
          duration_minutes: 1,
        })),
        {
          id: uuid("e1", 1),
          user_email: "user0@stockpro.test",
          task: "Still running",
          started_at: "2026-10-15T08:00:00.000Z",
          ended_at: null,
          duration_minutes: 0,
        },
      ],
    };

    const { GET } = await import("../../app/api/nrd/export-global/route");
    const response = await GET(
      new Request("http://localhost/api/nrd/export-global?period_month=2026-10")
    );
    expect(response.status).toBe(200);
    const body = await response.arrayBuffer();
    const summary = sheetRows(body, "Summary Global");
    expect(summary.find((row) => row.Metric === "Total tasks")?.Value).toBe(ROWS);
    expect(summary.find((row) => row.Metric === "Total minutes")?.Value).toBe(ROWS);
    expectAllOnce(
      sheetRows(body, "All Logs").map((row) => row["Task/s"]),
      Array.from({ length: ROWS }, (_, i) => `Task ${i}`)
    );
  });

  it("transfer history returns every transfer with its box", async () => {
    const { boxes } = boxesAndBins(500);
    fake.tables = {
      boxes,
      movements: Array.from({ length: ROWS }, (_, i) => ({
        movement_id: uuid("f0", i),
        type: "TRANSFER",
        created_at: SAME_TIME,
        actor: `mover${i}@stockpro.test`,
        box_id: boxes[i % boxes.length].id,
        to_floor: "2",
      })),
    };

    const { GET } = await import("../../app/api/transfer/history/route");
    const json = await (await GET()).json();
    expect(json.ok).toBe(true);
    expectAllOnce(
      json.rows.map((row: Row) => row.actor),
      Array.from({ length: ROWS }, (_, i) => `mover${i}@stockpro.test`)
    );
    expect(json.rows.every((row: Row) => row.boxes.box_code.startsWith("BOX-"))).toBe(true);
  });

  it("supply list and export keep every order and every line", async () => {
    const supplies = Array.from({ length: 1200 }, (_, i) => ({
      id: uuid("10", i),
      order_number: `SUP-${pad(i)}`,
      from_office: "BE",
      to_office: "NL",
      status: "pending",
      created_at: SAME_TIME,
    }));
    fake.tables = {
      supplies,
      supply_items: Array.from({ length: ROWS }, (_, i) => ({
        id: uuid("11", i),
        supply_id: supplies[i % 1100].id,
        product_name: `Item ${i}`,
        qty: 1,
        created_at: SAME_TIME,
      })),
    };

    const list = await import("../../app/api/supply/list/route");
    const json = await (await list.GET()).json();
    expectAllOnce(
      json.rows.map((row: Row) => row.order_number),
      supplies.map((supply) => supply.order_number)
    );
    expectAllOnce(
      json.rows.flatMap((row: Row) => row.supply_items.map((item: Row) => item.product_name)),
      Array.from({ length: ROWS }, (_, i) => `Item ${i}`)
    );

    const exported = await import("../../app/api/supply/export/route");
    const rows = sheetRows(await (await exported.GET()).arrayBuffer());
    // 2,500 lines plus one row for each of the 100 orders without lines.
    expect(rows).toHaveLength(ROWS + 100);
    expectAllOnce(
      rows.filter((row) => row.Item).map((row) => row.Item),
      Array.from({ length: ROWS }, (_, i) => `Item ${i}`)
    );
  });

  it("automatic accessory rules are all counted and listed", async () => {
    fake.tables = {
      bins: [{ id: "device-1", name: "FMC130" }],
      accessory_bins: [{ id: "acc-1", name: "Cable", active: true }],
      device_accessory_templates: Array.from({ length: ROWS }, (_, i) => ({
        id: uuid("12", i),
        device_id: i < 1500 ? "device-1" : "device-2",
        accessory_bin_id: "acc-1",
        quantity: 1,
        created_at: SAME_TIME,
      })),
    };

    const { GET } = await import("../../app/api/bins/templates/list/route");
    const counts = await (
      await GET(new Request("http://localhost/api/bins/templates/list"))
    ).json();
    expect(counts.rule_counts).toEqual({ "device-1": 1500, "device-2": 1000 });

    const detail = await (
      await GET(new Request("http://localhost/api/bins/templates/list?device_id=device-1"))
    ).json();
    expect(detail.ok).toBe(true);
    expect(new Set(detail.templates.map((t: Row) => t.id)).size).toBe(1500);
    expect(detail.templates[0].accessory_bins.name).toBe("Cable");
  });

  it("user list includes every account, role and permission set", async () => {
    const count = 1234;
    fake.users = Array.from({ length: count }, (_, i) => ({
      id: uuid("13", i),
      email: `user${i}@stockpro.test`,
      created_at: SAME_TIME,
    }));
    fake.tables = {
      user_roles: fake.users.map((user) => ({ user_id: user.id, role: "operator" })),
      user_permissions: fake.users.map((user) => ({ user_id: user.id, can_inbound: true })),
    };

    const { GET } = await import("../../app/api/admin/users/route");
    const json = await (await GET(new Request("http://localhost/api/admin/users"))).json();
    expect(json.ok).toBe(true);
    expectAllOnce(
      json.users.map((user: Row) => user.email),
      fake.users.map((user) => user.email)
    );
    expect(json.users.every((user: Row) => user.role === "operator")).toBe(true);
    expect(json.users.every((user: Row) => user.permissions?.can_inbound)).toBe(true);
  });

  it("inbound export lists every IMEI of a batch exactly once", async () => {
    const { boxes, bins } = boxesAndBins(300);
    fake.tables = {
      boxes,
      bins,
      movements: Array.from({ length: ROWS }, (_, i) => ({
        movement_id: uuid("14", i),
        type: "IN",
        batch_id: "batch-1",
        created_at: SAME_TIME,
        imei: imei(i),
        box_id: boxes[i % boxes.length].id,
      })),
    };

    const { GET } = await import("../../app/api/inbound/export/route");
    const response = await GET(
      new Request("http://localhost/api/inbound/export?batch_id=batch-1")
    );
    expect(response.status).toBe(200);
    const rows = sheetRows(await response.arrayBuffer());
    expectAllOnce(
      rows.map((row) => row.imei),
      Array.from({ length: ROWS }, (_, i) => imei(i))
    );
    expect(rows.every((row) => row.box_code && row.device)).toBe(true);
  });

  it.each([
    ["labels", "../../app/api/inbound/labels/route"],
    ["labels from batch", "../../app/api/inbound/labels/from-batch/route"],
  ])("inbound %s put every IMEI on its box label once", async (_name, path) => {
    // 24 boxes: page boundaries fall inside a box, where box_id ties.
    const { boxes, bins } = boxesAndBins(24);
    fake.tables = {
      boxes,
      bins,
      items: Array.from({ length: ROWS }, (_, i) => ({
        item_id: uuid("15", i),
        import_id: "batch-1",
        imei: imei(i),
        box_id: boxes[i % boxes.length].id,
      })),
    };

    const { GET } = await import(path);
    const response = await GET(
      new Request("http://localhost/api/inbound/labels?batch_id=batch-1")
    );
    expect(response.status).toBe(200);
    const qrContents = fake.qrContents;
    expect(qrContents).toHaveLength(24);
    expectAllOnce(
      qrContents.flatMap((content) => content.split("\n")),
      Array.from({ length: ROWS }, (_, i) => imei(i))
    );
  });
});
