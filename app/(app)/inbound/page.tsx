"use client";

import { useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { parseVendorExcel } from "@/lib/inbound/parsers";
import { toDeviceMatchList } from "@/lib/inbound/vendorParser";

type Vendor = "teltonika" | "quicklink" | "digitalmatter" | "truster";

export default function InboundPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [vendor, setVendor] = useState<Vendor>("teltonika");
  const [file, setFile] = useState<File | null>(null);
  const [floor, setFloor] = useState("1");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");

  async function parse() {
    setErr("");
    setResult(null);
    if (!file) return setErr("Choose a file");

    setBusy(true);

    try {
      const { data: devs } = await supabase
        .from("devices")
        .select("device_id,canonical_name,device,active,units_per_imei");

      const deviceMatches = toDeviceMatchList((devs as any) || []);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = parseVendorExcel(vendor, bytes, deviceMatches);

      setResult(parsed);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveInbound() {
    if (!result?.ok) return;

    setBusy(true);

    try {
      for (const label of result.labels) {
        // 1️⃣ get device_id
        const { data: deviceRow } = await supabase
          .from("devices")
          .select("device_id")
          .eq("device", label.device)
          .single();

        if (!deviceRow) continue;

        // 2️⃣ create box
        const { data: boxRow } = await supabase
          .from("boxes")
          .insert({
            box_no: label.box_no,
            device_id: deviceRow.device_id,
            floor: floor,
          })
          .select()
          .single();

        // 3️⃣ insert items
        const items = label.imeis.map((imei: string) => ({
          imei,
          device_id: deviceRow.device_id,
          box_id: boxRow.box_id,
        }));

        if (items.length > 0) {
          await supabase.from("items").insert(items);
        }
      }

      alert("Inbound saved successfully 🚀");
      setResult(null);
    } catch (e: any) {
      alert("Save failed: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-slate-500">Inbound</div>
        <h2 className="text-xl font-semibold">Inbound Import</h2>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3">

        <select
          value={vendor}
          onChange={(e) => setVendor(e.target.value as Vendor)}
          className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
        >
          <option value="teltonika">Teltonika</option>
          <option value="quicklink">Quicklink</option>
          <option value="digitalmatter">Digital Matter</option>
          <option value="truster">Truster</option>
        </select>

        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
        />

        {/* FLOOR SELECTOR */}
       <select
       value={floor}
       onChange={(e) => setFloor(e.target.value)}
       className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
       >
       <option value="00">Floor 00</option>
       <option value="1">Floor 1</option>
       <option value="6">Floor 6</option>
       <option value="Cabinet">Cabinet</option>
       </select>

        <button
          onClick={parse}
          disabled={busy}
          className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-semibold"
        >
          Parse
        </button>
      </div>

      {result?.ok && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3">
          <div>{result.labels.length} boxes detected</div>

          <button
            onClick={saveInbound}
            disabled={busy}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-sm font-semibold"
          >
            Save to Warehouse
          </button>
        </div>
      )}
    </div>
  );
}