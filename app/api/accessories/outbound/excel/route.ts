import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const file = form.get("file") as File;
    const shipment_ref = String(form.get("shipment_ref") || "");
    const comment = String(form.get("comment") || "");
    const actor = String(form.get("actor") || "unknown");
    const actor_id = String(form.get("actor_id") || "");

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

    const operation_id = crypto.randomUUID();

    for (const row of finalRows) {
      const newStock = Number(row.accessory.current_stock || 0) - row.qty;

      const { error: updateError } = await supabase
        .from("accessory_bins")
        .update({ current_stock: newStock })
        .eq("id", row.accessory_bin_id);

      if (updateError) throw updateError;

      const { error: moveError } = await supabase
        .from("accessory_movements")
        .insert({
          accessory_bin_id: row.accessory_bin_id,
          qty: row.qty,
          movement_type: "OUT",
          shipment_ref: shipment_ref || null,
          note: comment || null,
          actor,
          actor_id: actor_id || null,
          source: "excel",
          operation_id,
        });

      if (moveError) throw moveError;
    }

    return NextResponse.json({
      ok: true,
      operation_id,
      removed: finalRows.map((r) => ({
        accessory: r.accessory.name,
        qty: r.qty,
      })),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Excel outbound failed" },
      { status: 500 }
    );
  }
}