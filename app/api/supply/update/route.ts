import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function getSupabaseKeyProjectRef() {
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!key) return "MISSING_KEY";

    const payload = JSON.parse(
      Buffer.from(key.split(".")[1], "base64url").toString("utf8")
    );

    return payload.ref || "NO_REF_FOUND";
  } catch {
    return "INVALID_KEY";
  }
}

const VALID_STATUS = [
  "CREATED",
  "SHIPPED",
  "RECEIVED",
  "IMPORTED",
  "FAILED",
] as const;

type SupplyStatus = (typeof VALID_STATUS)[number];

export async function PUT(req: Request) {
  try {
    const body = await req.json();

    console.log("SUPABASE URL:", process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log("SERVICE KEY PROJECT REF:", getSupabaseKeyProjectRef());

    const {
      id,
      status,
      tracking_number,
      failed_reason,
      changed_by,
      changed_by_id,
    } = body;

    if (!id) {
      return NextResponse.json(
        { ok: false, error: "Missing supply id" },
        { status: 400 }
      );
    }

    const requestedStatus = String(status ?? "")
      .trim()
      .toUpperCase() as SupplyStatus;

    if (!VALID_STATUS.includes(requestedStatus)) {
      return NextResponse.json(
        { ok: false, error: "Invalid status" },
        { status: 400 }
      );
    }

    const { data: currentSupply, error: currentError } = await supabase
  .from("supplies")
  .select("*")
  .eq("id", id)
  .single();

console.log("ROW FROM DB =", JSON.stringify(currentSupply, null, 2));

    if (currentError) throw currentError;

    console.log("========== UPDATE API ==========");
console.log("ID:", id);
console.log("DB STATUS:", currentSupply.status);
console.log("REQUESTED:", requestedStatus);

    const currentStatus = String(currentSupply.status ?? "")
      .trim()
      .toUpperCase() as SupplyStatus;

    const transitions: Record<SupplyStatus, SupplyStatus[]> = {
      CREATED: ["CREATED", "SHIPPED", "FAILED"],
      SHIPPED: ["SHIPPED", "RECEIVED", "FAILED"],
      RECEIVED: ["RECEIVED", "IMPORTED", "FAILED"],
      IMPORTED: ["IMPORTED"],
      FAILED: ["FAILED"],
    };

console.log("CURRENT STATUS =", currentStatus);
console.log("ALLOWED =", transitions[currentStatus]);

    if (!transitions[currentStatus]?.includes(requestedStatus)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Invalid status transition: ${currentStatus} → ${requestedStatus}`,
        },
        { status: 400 }
      );
    }

    if (requestedStatus === "FAILED" && !failed_reason?.trim()) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failure reason is required",
        },
        { status: 400 }
      );
    }

    const isImported = requestedStatus === "IMPORTED";
    const now = new Date().toISOString();

    const updateData = {
      status: requestedStatus,
      tracking_number: tracking_number?.trim() || null,
      failed_reason:
        requestedStatus === "FAILED"
          ? failed_reason.trim()
          : null,
      imported: isImported,
      imported_date: isImported ? now : null,
      updated_at: now,
    };

    const { data, error } = await supabase
      .from("supplies")
      .update(updateData)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;

    const { data: historyRow, error: historyError } = await supabase
      .from("supply_status_history")
      .insert({
        supply_id: id,
        status: requestedStatus,
        tracking_number: tracking_number?.trim() || null,
        failed_reason:
          requestedStatus === "FAILED"
            ? failed_reason.trim()
            : null,
        changed_by: changed_by || "unknown",
        changed_by_id: changed_by_id || null,
      })
      .select("*")
      .single();

    if (historyError) {
      console.error("SUPPLY HISTORY INSERT ERROR:", historyError);

      return NextResponse.json(
        {
          ok: false,
          error: historyError.message,
          details: historyError.details,
          code: historyError.code,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      row: data,
      historyRow,
    });
  } catch (e: any) {
    console.error("SUPPLY UPDATE ERROR:", e);

    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "Supply update failed",
      },
      { status: 500 }
    );
  }
}