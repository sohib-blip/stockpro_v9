"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Bin = {
  id: string;
  name: string;
};

export default function BinsPage() {
  const supabase = createSupabaseBrowserClient();

  const [bins, setBins] = useState<Bin[]>([]);
  const [newBin, setNewBin] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadBins() {
    const { data } = await supabase
      .from("bins")
      .select("*")
      .order("created_at", { ascending: false });

    setBins(data || []);
  }

  async function addBin() {
    if (!newBin.trim()) return;

    setLoading(true);

    await supabase.from("bins").insert({ name: newBin.trim() });

    setNewBin("");
    setLoading(false);
    loadBins();
  }

  async function deleteBin(id: string) {
    await supabase.from("bins").delete().eq("id", id);
    loadBins();
  }

  useEffect(() => {
    loadBins();
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Bins</h1>

      <div className="flex gap-2">
        <input
          value={newBin}
          onChange={(e) => setNewBin(e.target.value)}
          placeholder="New bin name..."
          className="bg-slate-900 border border-slate-700 px-3 py-2 rounded-xl text-sm w-64"
        />
        <button
          onClick={addBin}
          disabled={loading}
          className="bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-xl text-sm font-medium"
        >
          Add
        </button>
      </div>

      <div className="border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900">
            <tr>
              <th className="text-left p-3">Name</th>
              <th className="text-right p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {bins.map((bin) => (
              <tr key={bin.id} className="border-t border-slate-800">
                <td className="p-3">{bin.name}</td>
                <td className="p-3 text-right">
                  <button
                    onClick={() => deleteBin(bin.id)}
                    className="text-rose-400 hover:text-rose-500"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}

            {bins.length === 0 && (
              <tr>
                <td colSpan={2} className="p-4 text-center text-slate-500">
                  No bins yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}