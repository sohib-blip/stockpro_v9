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
    <div className="space-y-6">
      <div className="sp-page-header">
        <h1 className="sp-title">Movements History</h1>
      </div>

      <div className="sp-card">
        {rows.map(r => (
          <div key={r.movement_id} className="border-b border-sp-border py-2 text-sm text-sp-body last:border-b-0">
            {r.type} — {r.imei} — {r.created_at}
          </div>
        ))}
      </div>
    </div>
  );
}
