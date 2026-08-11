import { NextResponse } from "next/server";
import { getApiIdentity } from "@/lib/api-identity";
import { supabaseService } from "@/lib/auth";
import {
  PayloadTooLargeError,
  readJsonBodyWithinLimit,
} from "@/lib/security/request-budget";
import {
  acquireWorkloadLease,
  releaseWorkloadLease,
  workloadRejectionResponse,
} from "@/lib/security/workload-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_SEARCH_IMEIS = 200;
const MAX_SEARCH_BYTES = 32 * 1024;

function extractImeis(body: unknown) {
  if (!body || typeof body !== "object") return [];

  const value = body as { imeisText?: unknown; imeis?: unknown };
  const inputs = Array.isArray(value.imeis)
    ? value.imeis
    : [value.imeisText ?? value.imeis ?? ""];

  return Array.from(
    new Set(
      inputs
        .flatMap((input) => String(input ?? "").split(/\D+/g))
        .filter((candidate) => candidate.length === 15)
    )
  );
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await readJsonBodyWithinLimit(req, MAX_SEARCH_BYTES);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof PayloadTooLargeError
            ? "IMEI search request is too large"
            : "Invalid IMEI search request",
      },
      { status: error instanceof PayloadTooLargeError ? 413 : 400 }
    );
  }

  const imeis = extractImeis(body);
  if (imeis.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Enter at least one valid 15-digit IMEI" },
      { status: 400 }
    );
  }
  if (imeis.length > MAX_SEARCH_IMEIS) {
    return NextResponse.json(
      {
        ok: false,
        error: `Search supports at most ${MAX_SEARCH_IMEIS} unique IMEIs`,
      },
      { status: 400 }
    );
  }

  const identity = getApiIdentity(req);
  const admission = await acquireWorkloadLease(req, "imeiSearch", {
    principal: identity.userId,
  });
  if (!admission.ok) return workloadRejectionResponse(admission);

  try {
    const { data, error } = await supabaseService()
      .from("items")
      .select(`
        item_id,
        imei,
        status,
        box_id,
        device_id,
        boxes (
          box_code,
          floor,
          bins (
            name
          )
        )
      `)
      .in("imei", imeis);

    if (error) throw error;

    const found = new Map(
      (data || []).map((item: any) => [String(item.imei), item])
    );
    const rows = imeis.map((imei) => {
      const item: any = found.get(imei);
      const box = item?.boxes;

      return {
        imei,
        found: Boolean(item),
        device: item ? box?.bins?.name || "Unknown" : null,
        box_id: item ? box?.box_code || null : null,
        location: item ? box?.floor || null : null,
        status: item ? String(item.status || "Unknown").toUpperCase() : null,
      };
    });

    return NextResponse.json(
      {
        ok: true,
        total: rows.length,
        found: rows.filter((row) => row.found).length,
        not_found: rows.filter((row) => !row.found).length,
        rows,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("IMEI SEARCH ERROR", error);
    return NextResponse.json(
      { ok: false, error: "IMEI search failed" },
      { status: 500 }
    );
  } finally {
    await releaseWorkloadLease(admission.leaseId);
  }
}
