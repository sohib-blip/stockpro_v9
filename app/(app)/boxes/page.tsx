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
      <div className="sp-page-header">
        <div>
          <div className="sp-eyebrow">Warehouse</div>
          <h1 className="sp-title">Boxes</h1>
        </div>
      </div>

      {loading ? (
        <div className="sp-card">
          <p className="sp-desc">Loading…</p>
        </div>
      ) : (
        <div className="sp-card sp-card-flush">
          <div className="overflow-x-auto">
            <table className="sp-table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Box</th>
                  <th>Floor</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.box_id}>
                    <td>{r.devices?.device}</td>
                    <td>{r.box_no}</td>
                    <td>
                      <select
                        value={r.floor || ""}
                        onChange={(e) => updateFloor(r.box_id, e.target.value)}
                        className="sp-select w-auto py-1"
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
          </div>
        </div>
      )}
    </div>
  );
}
