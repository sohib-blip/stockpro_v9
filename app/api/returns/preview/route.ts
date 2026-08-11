import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  RETURN_STATUS_VALUES,
  matchReturnDeviceOption,
  mergeReturnDeviceOptions,
} from "@/lib/returns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const returnPreviewSchema = z
  .object({
    imeisText: z.string().max(25_000),
    return_status: z.enum(RETURN_STATUS_VALUES),
    reported_device: z.string().trim().max(200).nullish(),
  })
  .superRefine((command, context) => {
    if (
      command.return_status !== "available" &&
      !command.reported_device?.trim()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reported_device"],
        message: "A device is required for non-stock returns",
      });
    }
  });

function extractImeis(text: string) {
  return Array.from(
    new Set(
      String(text || "")
        .split(/\s+/)
        .map((x) => x.replace(/\D/g, ""))
        .filter((x) => x.length === 15)
    )
  );
}

export async function POST(req: Request) {
  try {
    const parsed = returnPreviewSchema.safeParse(
      await req.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid return preview" },
        { status: 400 }
      );
    }

    const imeis = extractImeis(parsed.data.imeisText);

    if (imeis.length === 0) {
      return NextResponse.json({ ok: false, error: "No valid IMEIs found" }, { status: 400 });
    }

    if (imeis.length > 500) {
      return NextResponse.json(
        { ok: false, error: "A maximum of 500 IMEIs can be returned at once" },
        { status: 400 }
      );
    }

    let reportedDevice: string | null = null;
    if (parsed.data.return_status !== "available") {
      const { data: bins, error: binsError } = await supabase
        .from("bins")
        .select("name")
        .order("name", { ascending: true });
      if (binsError) throw binsError;

      const options = mergeReturnDeviceOptions(
        (bins || []).map((bin) => String(bin.name || ""))
      );
      reportedDevice =
        matchReturnDeviceOption(parsed.data.reported_device || "", options) ||
        null;
      if (!reportedDevice) {
        return NextResponse.json(
          { ok: false, error: "Select a valid device from the list" },
          { status: 400 }
        );
      }
    }

    const { data, error } = await supabase
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

    const foundMap = new Map((data || []).map((x: any) => [String(x.imei), x]));

    const valid_returns: any[] = [];
    const already_in_stock: string[] = [];
    const unknown_imeis: string[] = [];

    for (const imei of imeis) {
      const item: any = foundMap.get(imei);

      if (!item) {
        unknown_imeis.push(imei);
        continue;
      }

      if (String(item.status).toUpperCase() === "IN") {
        already_in_stock.push(imei);
        continue;
      }

      if (String(item.status).toUpperCase() === "OUT") {
        valid_returns.push({
          item_id: item.item_id,
          imei: item.imei,
          device_id: item.device_id,
          device:
            reportedDevice || item.boxes?.bins?.name || item.device_id,
          previous_box: item.boxes?.box_code || "",
          previous_floor: item.boxes?.floor || "",
          return_status: parsed.data.return_status,
          stock_action:
            parsed.data.return_status === "available"
              ? "added_to_stock"
              : "no_stock_change",
        });
      }
    }

    const breakdown: Record<string, number> = {};
    for (const item of valid_returns) {
      breakdown[item.device] = (breakdown[item.device] || 0) + 1;
    }

    return NextResponse.json({
      ok: true,
      total_scanned: imeis.length,
      valid_returns,
      already_in_stock,
      unknown_imeis,
      return_status: parsed.data.return_status,
      reported_device: reportedDevice,
      stock_action:
        parsed.data.return_status === "available"
          ? "added_to_stock"
          : "no_stock_change",
      breakdown: Object.entries(breakdown).map(([device, qty]) => ({ device, qty })),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Return preview failed" },
      { status: 500 }
    );
  }
}
