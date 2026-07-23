import { NextResponse } from "next/server";
import { getApiIdentity } from "@/lib/api-identity";
import {
  inventoryCommandErrorMessage,
  inventoryCommandErrorStatus,
} from "@/lib/inventory-command-error";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function norm(value: any) {
  return String(value || "").trim().toLowerCase();
}

function cleanImei(value: any) {
  return String(value || "").replace(/\D/g, "").trim();
}

const operationIdSchema = z.string().uuid();

export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const file = form.get("file") as File;
    const shipment_ref = String(form.get("shipment_ref") || "");
    const comment = String(form.get("comment") || "");
    const requestedOperationId = String(form.get("operation_id") || "");
    const identity = getApiIdentity(req);

    if (!file) {
      return NextResponse.json(
        { ok: false, error: "No file uploaded" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", raw: false });

    const imeis = new Set<string>();
    const itemTypes: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<any[]>(sheet, {
        header: 1,
        raw: false,
        defval: "",
        blankrows: false,
      });

      let headerIndex = -1;
      let imeiIndex = -1;
      let itemTypeIndex = -1;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i].map(norm);

        imeiIndex = row.findIndex((c) =>
          ["imei", "imei / id", "imei/id", "imei id"].includes(c)
        );

        itemTypeIndex = row.findIndex((c) =>
          ["item type", "itemtype", "type"].includes(c)
        );

        if (imeiIndex >= 0 || itemTypeIndex >= 0) {
          headerIndex = i;
          break;
        }
      }

      if (headerIndex === -1) continue;

      for (let i = headerIndex + 1; i < rows.length; i++) {
        const row = rows[i];

        if (imeiIndex >= 0) {
          const imei = cleanImei(row[imeiIndex]);
          if (imei) imeis.add(imei);
        }

        if (itemTypeIndex >= 0) {
          const itemType = String(row[itemTypeIndex] || "").trim();
          if (itemType) itemTypes.push(itemType);
        }
      }
    }

    const { data: accessoryBins, error: accessoryError } = await supabase
      .from("accessory_bins")
      .select("id, name, current_stock")
      .eq("active", true);

    if (accessoryError) throw accessoryError;

    const accessoryMap = new Map(
      (accessoryBins || []).map((a: any) => [norm(a.name), a])
    );

    const accessoryQtyMap = new Map<string, number>();

    for (const itemType of itemTypes) {
      const accessory = accessoryMap.get(norm(itemType));
      if (!accessory) continue;

      accessoryQtyMap.set(
        accessory.id,
        (accessoryQtyMap.get(accessory.id) || 0) + 1
      );
    }

    if (imeis.size > 0) {
      const { data: items, error: itemsError } = await supabase
        .from("items")
        .select("imei, device_id")
        .in("imei", Array.from(imeis));

      if (itemsError) throw itemsError;

      const deviceCountMap = new Map<string, number>();

      for (const item of items || []) {
        if (!item.device_id) continue;

        deviceCountMap.set(
          item.device_id,
          (deviceCountMap.get(item.device_id) || 0) + 1
        );
      }

      if (deviceCountMap.size > 0) {
        const { data: templates, error: templateError } = await supabase
          .from("device_accessory_templates")
          .select("device_id, accessory_bin_id, quantity, per_devices")
          .in("device_id", Array.from(deviceCountMap.keys()));

        if (templateError) throw templateError;

        for (const template of templates || []) {
          const deviceCount = deviceCountMap.get(template.device_id) || 0;
          const qty = Number(template.quantity || 1);
          const perDevices = Number(template.per_devices || 1);

          const needed = Math.ceil(deviceCount / perDevices) * qty;

          accessoryQtyMap.set(
            template.accessory_bin_id,
            (accessoryQtyMap.get(template.accessory_bin_id) || 0) + needed
          );
        }
      }
    }

    if (accessoryQtyMap.size === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No accessories to remove. No matching IMEI templates or Item Type accessories found.",
        },
        { status: 400 }
      );
    }

    const finalRows = Array.from(accessoryQtyMap.entries()).map(
  ([accessory_bin_id, qty]) => {
    const accessory = (accessoryBins || []).find(
      (a: any) => a.id === accessory_bin_id
    );

    if (!accessory) {
      throw new Error(`Accessory not found: ${accessory_bin_id}`);
    }

    return {
      accessory,
      accessory_bin_id,
      qty,
    };
  }
);

const preview = String(form.get("preview") || "") === "1";

if (preview) {
  for (const row of finalRows) {
    if (Number(row.accessory.current_stock || 0) < row.qty) {
      return NextResponse.json(
        {
          ok: false,
          error: `Not enough stock for ${row.accessory.name}. Stock: ${row.accessory.current_stock}, needed: ${row.qty}`,
        },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({
    ok: true,
    preview: true,
    rows: finalRows.map((r) => ({
      accessory_bin_id: r.accessory_bin_id,
      accessory: r.accessory.name,
      qty: r.qty,
      current_stock: Number(r.accessory.current_stock || 0),
      after_stock: Number(r.accessory.current_stock || 0) - r.qty,
    })),
  });
}

    if (
      shipment_ref.length > 500 ||
      comment.length > 1000 ||
      (requestedOperationId &&
        !operationIdSchema.safeParse(requestedOperationId).success)
    ) {
      return NextResponse.json(
        { ok: false, error: "Invalid accessory outbound request" },
        { status: 400 }
      );
    }

    const operationId = requestedOperationId || crypto.randomUUID();
    const { data, error: commandError } = await supabase.rpc(
      "confirm_accessory_outbound",
      {
        p_operation_id: operationId,
        p_actor_id: identity.userId,
        p_actor: identity.email,
        p_source: "excel",
        p_shipment_ref: shipment_ref || null,
        p_note: comment || null,
        p_lines: finalRows.map((row) => ({
          accessory_bin_id: row.accessory_bin_id,
          qty: row.qty,
        })),
      }
    );

    if (commandError) {
      console.error("EXCEL ACCESSORY COMMAND ERROR", commandError);
      return NextResponse.json(
        {
          ok: false,
          error: inventoryCommandErrorMessage(
            commandError,
            "Spreadsheet outbound failed"
          ),
        },
        { status: inventoryCommandErrorStatus(commandError) }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("EXCEL ACCESSORY OUTBOUND ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Excel outbound failed" },
      { status: 500 }
    );
  }
}
