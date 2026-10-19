import { NextResponse } from "next/server";
import { getApiIdentity } from "@/lib/api-identity";
import { supabaseService } from "@/lib/auth";
import {
  buildBoxSearchRows,
  extractBoxCodes,
  MAX_BOX_CODE_LENGTH,
  MAX_SEARCH_BOXES,
} from "@/lib/box-search";
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

const MAX_SEARCH_BYTES = 32 * 1024;

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
            ? "Box search request is too large"
            : "Invalid box search request",
      },
      { status: error instanceof PayloadTooLargeError ? 413 : 400 }
    );
  }

  const boxCodes = extractBoxCodes(body);
  if (boxCodes.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Enter at least one box ID" },
      { status: 400 }
    );
  }
  if (boxCodes.length > MAX_SEARCH_BOXES) {
    return NextResponse.json(
      {
        ok: false,
        error: `Search supports at most ${MAX_SEARCH_BOXES} unique box IDs`,
      },
      { status: 400 }
    );
  }
  if (boxCodes.some((code) => code.length > MAX_BOX_CODE_LENGTH)) {
    return NextResponse.json(
      {
        ok: false,
        error: `Box IDs must be at most ${MAX_BOX_CODE_LENGTH} characters`,
      },
      { status: 400 }
    );
  }

  const identity = getApiIdentity(req);
  const admission = await acquireWorkloadLease(req, "boxSearch", {
    principal: identity.userId,
  });
  if (!admission.ok) return workloadRejectionResponse(admission);

  try {
    const supabase = supabaseService();
    // Exact matches only: the entered spelling plus its upper-case form, so a
    // box typed in lower case is still found without a pattern search.
    const lookupCodes = Array.from(
      new Set(boxCodes.flatMap((code) => [code, code.toUpperCase()]))
    );

    const { data, error } = await supabase
      .from("boxes")
      .select(`
        id,
        box_code,
        floor,
        bins (
          name
        )
      `)
      .in("box_code", lookupCodes);

    if (error) throw error;

    const boxes = (data || []).map((box: any) => ({
      id: String(box.id),
      box_code: String(box.box_code),
      floor: box.floor ? String(box.floor) : null,
      device: box.bins?.name ? String(box.bins.name) : null,
    }));

    const stockCounts = new Map<string, number>();
    if (boxes.length > 0) {
      const { data: counts, error: countError } = await supabase.rpc(
        "get_outbound_box_stock_counts",
        { p_box_ids: boxes.map((box) => box.id) }
      );
      if (countError) throw countError;

      for (const row of counts || []) {
        stockCounts.set(String(row.box_id), Number(row.stock_count || 0));
      }
    }

    const rows = buildBoxSearchRows(boxCodes, boxes, stockCounts);
    const foundQueries = new Set(
      rows.filter((row) => row.found).map((row) => row.query)
    );

    return NextResponse.json(
      {
        ok: true,
        total: boxCodes.length,
        found: foundQueries.size,
        not_found: boxCodes.length - foundQueries.size,
        rows,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("BOX SEARCH ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Box search failed" },
      { status: 500 }
    );
  } finally {
    await releaseWorkloadLease(admission.leaseId);
  }
}
