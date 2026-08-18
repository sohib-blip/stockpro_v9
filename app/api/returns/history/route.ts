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
const OPERATION_ITEM_LIMIT = 50_000;
const operationIdSchema = z.string().uuid();
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
  let operationId: string | null;
  try {
    const searchParams = new URL(req.url).searchParams;
    const rawOperationId = searchParams.get("operation_id");
    operationId = rawOperationId
      ? operationIdSchema.parse(rawOperationId)
      : null;
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
    if (operationId) {
      const service = supabaseService();
      const { data, error } = await service
        .from("return_records")
        .select(`
          id,
          operation_id,
          created_at,
          actor,
          return_ref,
          return_reason,
          customer,
          sur_id,
          courier,
          country_code,
          return_status,
          reported_device,
          device_id,
          imei,
          previous_box,
          previous_floor,
          target_box,
          target_floor,
          stock_action
        `)
        .eq("operation_id", operationId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(OPERATION_ITEM_LIMIT);
      if (error) throw error;
      if (!data?.length) {
        return NextResponse.json(
          { ok: false, error: "Return operation not found" },
          { status: 404 }
        );
      }

      const deviceIds = Array.from(
        new Set(data.map((row) => row.device_id).filter(Boolean))
      );
      const { data: bins, error: binsError } = await service
        .from("bins")
        .select("id,name")
        .in(
          "id",
          deviceIds.length
            ? deviceIds
            : ["00000000-0000-0000-0000-000000000000"]
        );
      if (binsError) throw binsError;
      const deviceById = new Map(
        (bins || []).map((bin) => [String(bin.id), String(bin.name || "")])
      );

      return NextResponse.json({
        ok: true,
        operation_id: operationId,
        rows: data.map((row) => ({
          ...row,
          device:
            String(row.reported_device || "").trim() ||
            deviceById.get(String(row.device_id)) ||
            "",
        })),
      });
    }

    const { data, error } = await supabaseService().rpc(
      "get_return_operation_history_page",
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
      rows: rows.map((row: Record<string, unknown>) => {
        const publicRow = { ...row };
        delete publicRow.return_type;
        return publicRow;
      }),
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
