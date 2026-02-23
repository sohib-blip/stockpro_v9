"use client";

import { useEffect, useState } from "react";

export default function MovementsPage() {
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/movements")
      .then(r => r.json())
      .then(d => setRows(d.rows || []));
  }, []);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Movements History</h2>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        {rows.map(r => (
          <div key={r.movement_id} className="text-sm border-b border-slate-800 py-2">
            {r.type} — {r.imei} — {r.created_at}
          </div>
        ))}
      </div>
    </div>
  );
}