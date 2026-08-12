import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiIdentity } from "@/lib/api-identity";
import { supabaseService } from "@/lib/auth";
import {
  createReturnTemplateWorkbook,
  returnTemplateFilename,
  type ReturnTemplateRow,
} from "@/lib/return-template-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const operationIdSchema = z.string().uuid();

function workbookResponse(buffer: ArrayBuffer, filename: string, rowCount: number) {
  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-StockPro-Return-Count": String(rowCount),
    },
  });
}

function brusselsDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function GET(req: Request) {
  const service = supabaseService();
  const searchParams = new URL(req.url).searchParams;
  const operationId = searchParams.get("operation_id");

  if (operationId) {
    const parsedOperationId = operationIdSchema.safeParse(operationId);
    if (!parsedOperationId.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid return operation" },
        { status: 400 }
      );
    }

    try {
      const { data, error } = await service
        .from("return_records")
        .select("imei,return_status,return_ref,created_at")
        .eq("operation_id", parsedOperationId.data)
        .order("created_at", { ascending: true });
      if (error) throw error;
      if (!data?.length) {
        return NextResponse.json(
          { ok: false, error: "Return operation not found" },
          { status: 404 }
        );
      }

      const buffer = await createReturnTemplateWorkbook(
        data as ReturnTemplateRow[]
      );
      const operationLabel =
        String(data[0].return_ref || "").trim() || parsedOperationId.data.slice(0, 8);
      return workbookResponse(
        buffer,
        returnTemplateFilename(operationLabel),
        data.length
      );
    } catch (error) {
      console.error("RETURN OPERATION TEMPLATE EXPORT ERROR", error);
      return NextResponse.json(
        { ok: false, error: "Return operation export failed" },
        { status: 500 }
      );
    }
  }

  let identity;
  try {
    identity = getApiIdentity(req);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Authenticated API identity is missing" },
      { status: 401 }
    );
  }

  const batchId = randomUUID();
  let claimed = false;
  try {
    const { data, error } = await service.rpc(
      "claim_return_template_export_batch",
      {
        p_batch_id: batchId,
        p_actor_id: identity.userId,
        p_actor: identity.email,
        p_limit: 50_000,
      }
    );
    if (error) throw error;

    const rows = (data || []) as ReturnTemplateRow[];
    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No new returns are waiting to be exported." },
        { status: 409 }
      );
    }
    claimed = true;

    const buffer = await createReturnTemplateWorkbook(rows);
    return workbookResponse(
      buffer,
      returnTemplateFilename(`${brusselsDate()}-${rows.length}`),
      rows.length
    );
  } catch (error) {
    if (claimed) {
      const { error: releaseError } = await service.rpc(
        "release_return_template_export_batch",
        {
          p_batch_id: batchId,
          p_actor_id: identity.userId,
        }
      );
      if (releaseError) {
        console.error("RETURN TEMPLATE EXPORT RELEASE ERROR", releaseError);
      }
    }
    console.error("RETURN TEMPLATE EXPORT ERROR", error);
    return NextResponse.json(
      { ok: false, error: "New returns export failed" },
      { status: 500 }
    );
  }
}
