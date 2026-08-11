import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiIdentity } from "@/lib/api-identity";
import { supabaseService } from "@/lib/auth";
import {
  RETURN_COUNTRY_CODES,
  RETURN_COURIER_VALUES,
  RETURN_STATUS_VALUES,
} from "@/lib/returns";
import {
  acquireWorkloadLease,
  releaseWorkloadLease,
  workloadRejectionResponse,
} from "@/lib/security/workload-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const HISTORY_PAGE_SIZE = 50;
const cursorSchema = z.object({
  created_at: z.string().datetime({ offset: true }),
  history_key: z.string().min(1).max(500),
});
const historyFiltersSchema = z.object({
  search: z.string().trim().max(200),
  month: z
    .string()
    .regex(/^$|^\d{4}-(0[1-9]|1[0-2])$/),
  status: z.enum(RETURN_STATUS_VALUES).or(z.literal("")),
  courier: z.enum(RETURN_COURIER_VALUES).or(z.literal("")),
  country: z.enum(RETURN_COUNTRY_CODES).or(z.literal("")),
});

function decodeCursor(value: string | null) {
  if (!value) return null;
  if (value.length > 1_000) throw new Error("Invalid history cursor");

  const decoded = JSON.parse(
    Buffer.from(value, "base64url").toString("utf8")
  );
  const parsed = cursorSchema.safeParse(decoded);
  if (!parsed.success) throw new Error("Invalid history cursor");
  return parsed.data;
}

function encodeCursor(row: { created_at: string; history_key: string }) {
  return Buffer.from(
    JSON.stringify({
      created_at: row.created_at,
      history_key: row.history_key,
    }),
    "utf8"
  ).toString("base64url");
}

export async function GET(req: Request) {
  let cursor: z.infer<typeof cursorSchema> | null;
  let filters: z.infer<typeof historyFiltersSchema>;
  try {
    const searchParams = new URL(req.url).searchParams;
    cursor = decodeCursor(searchParams.get("cursor"));
    filters = historyFiltersSchema.parse({
      search: searchParams.get("search") || "",
      month: searchParams.get("month") || "",
      status: searchParams.get("status") || "",
      courier: searchParams.get("courier") || "",
      country: searchParams.get("country") || "",
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid return history query" },
      { status: 400 }
    );
  }

  const identity = getApiIdentity(req);
  const admission = await acquireWorkloadLease(req, "returnsHistory", {
    principal: identity.userId,
  });
  if (!admission.ok) return workloadRejectionResponse(admission);

  try {
    const { data, error } = await supabaseService().rpc(
      "get_return_history_page",
      {
        p_cursor_created_at: cursor?.created_at || null,
        p_cursor_history_key: cursor?.history_key || null,
        p_limit: HISTORY_PAGE_SIZE + 1,
        p_search: filters.search || null,
        p_month: filters.month ? `${filters.month}-01` : null,
        p_return_status: filters.status || null,
        p_courier: filters.courier || null,
        p_country_code: filters.country || null,
      }
    );

    if (error) throw error;

    const fetched = data || [];
    const hasMore = fetched.length > HISTORY_PAGE_SIZE;
    const rows = fetched.slice(0, HISTORY_PAGE_SIZE);
    const last = rows.at(-1);

    return NextResponse.json({
      ok: true,
      rows,
      has_more: hasMore,
      next_cursor:
        hasMore && last
          ? encodeCursor({
              created_at: last.created_at,
              history_key: last.history_key,
            })
          : null,
    });
  } catch (error) {
    console.error("RETURNS HISTORY ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Returns history failed" },
      { status: 500 }
    );
  } finally {
    await releaseWorkloadLease(admission.leaseId);
  }
}
