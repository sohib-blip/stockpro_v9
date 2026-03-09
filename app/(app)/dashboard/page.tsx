"use client";

import { useEffect, useState } from "react";

export default function DashboardPage() {

  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch("/api/dashboard")
      .then(r => r.json())
      .then(setData);
  }, []);

  if (!data) return <div>Loading...</div>;

  return (

    <div style={{ padding: 40 }}>

      <h1>Dashboard</h1>

      <h2>Total stock: {data.total_stock}</h2>

      <h3>Stock by device</h3>

      <ul>
        {data.devices.map((d:any) => (
          <li key={d.id}>
            {d.device} — {d.stock}
          </li>
        ))}
      </ul>

    </div>

  );
}