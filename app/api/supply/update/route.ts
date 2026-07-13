import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const VALID_STATUS = [
  "CREATED",
  "SHIPPED",
  "RECEIVED",
  "IMPORTED",
  "FAILED",
] as const;

type SupplyStatus = (typeof VALID_STATUS)[number];

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

const transitions: Record<SupplyStatus, SupplyStatus[]> = {
  CREATED: ["CREATED", "SHIPPED", "FAILED"],
  SHIPPED: ["SHIPPED", "RECEIVED", "FAILED"],
  RECEIVED: ["RECEIVED", "IMPORTED", "FAILED"],
  IMPORTED: ["IMPORTED"],
  FAILED: ["FAILED"],
};

export async function PUT(req: Request) {
  try {
    const body = await req.json();

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
        {
          ok: false,
          error: "Missing supply id",
        },
        {
          status: 400,
        }
      );
    }

    const requestedStatus = String(status ?? "")
      .trim()
      .toUpperCase() as SupplyStatus;

    if (!VALID_STATUS.includes(requestedStatus)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid status",
        },
        {
          status: 400,
        }
      );
    }

    const cleanTrackingNumber =
      typeof tracking_number === "string" && tracking_number.trim()
        ? tracking_number.trim()
        : null;

    const cleanFailedReason =
      typeof failed_reason === "string" && failed_reason.trim()
        ? failed_reason.trim()
        : null;

    if (requestedStatus === "FAILED" && !cleanFailedReason) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failure reason is required",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * Lecture du statut réellement enregistré dans supplies.
     */
    const { data: currentSupply, error: currentError } = await supabase
      .from("supplies")
      .select("id, order_number, status")
      .eq("id", id)
      .single();

    if (currentError) {
      console.error("SUPPLY READ ERROR:", currentError);
      throw currentError;
    }

    const currentStatus = String(currentSupply.status ?? "")
      .trim()
      .toUpperCase() as SupplyStatus;

    console.log("========== SUPPLY UPDATE ==========");
    console.log({
      id,
      orderNumber: currentSupply.order_number,
      currentStatus,
      requestedStatus,
      allowedStatuses: transitions[currentStatus],
    });

    if (!VALID_STATUS.includes(currentStatus)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Unknown current status: ${currentStatus}`,
        },
        {
          status: 400,
        }
      );
    }

    if (!transitions[currentStatus].includes(requestedStatus)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Invalid status transition: ${currentStatus} → ${requestedStatus}`,
        },
        {
          status: 400,
        }
      );
    }

    const now = new Date().toISOString();
    const isImported = requestedStatus === "IMPORTED";

    const updateData = {
      status: requestedStatus,
      tracking_number: cleanTrackingNumber,
      failed_reason:
        requestedStatus === "FAILED" ? cleanFailedReason : null,
      imported: isImported,
      imported_date: isImported ? now : null,
      updated_at: now,
    };

    /*
     * Mise à jour de la commande.
     * On vérifie aussi l'ancien statut dans le WHERE afin d'éviter
     * qu'une ancienne requête modifie une commande entre-temps.
     */
    const { data: updatedSupply, error: updateError } = await supabase
      .from("supplies")
      .update(updateData)
      .eq("id", id)
      .eq("status", currentSupply.status)
      .select("*")
      .single();

    if (updateError) {
      console.error("SUPPLY UPDATE ERROR:", updateError);
      throw updateError;
    }

    /*
     * Ajout de la nouvelle ligne dans l'historique.
     */
    const { data: historyRow, error: historyError } = await supabase
      .from("supply_status_history")
      .insert({
        supply_id: id,
        status: requestedStatus,
        tracking_number: cleanTrackingNumber,
        failed_reason:
          requestedStatus === "FAILED" ? cleanFailedReason : null,
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
        {
          status: 500,
        }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        row: updatedSupply,
        historyRow,
      },
      {
        status: 200,
        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  } catch (error: unknown) {
    console.error("SUPPLY UPDATE FAILED:", error);

    const message =
      error instanceof Error ? error.message : "Supply update failed";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}