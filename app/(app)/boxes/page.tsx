"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function BoxesPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);

    const { data } = await supabase
      .from("boxes")
      .select("box_id, box_no, floor, devices(device)")
      .order("box_no");

    setRows(data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function updateFloor(box_id: string, floor: string) {
    await supabase.from("boxes").update({ floor }).eq("box_id", box_id);
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-slate-500">Warehouse</div>
        <h2 className="text-xl font-semibold">Boxes</h2>
      </div>

      {loading ? (
        <div>Loading…</div>
      ) : (
        <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
          <thead className="bg-slate-950/50">
            <tr>
              <th className="p-2 border-b border-slate-800 text-left">Device</th>
              <th className="p-2 border-b border-slate-800 text-left">Box</th>
              <th className="p-2 border-b border-slate-800 text-left">Floor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.box_id}>
                <td className="p-2 border-b border-slate-800">
                  {r.devices?.device}
                </td>
                <td className="p-2 border-b border-slate-800">{r.box_no}</td>
                <td className="p-2 border-b border-slate-800">
                 <select
  value={r.floor || ""}
  onChange={(e) =>
    updateFloor(r.box_id, e.target.value)
  }
  className="border border-slate-800 bg-slate-950 rounded-lg px-2 py-1"
>
  <option value="">—</option>
  <option value="00">00</option>
  <option value="1">1</option>
  <option value="6">6</option>
  <option value="Cabinet">Cabinet</option>
</select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}