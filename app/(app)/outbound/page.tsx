"use client";

import { useState } from "react";

export default function OutboundPage() {
  const [imei, setImei] = useState("");
  const [shipmentRef, setShipmentRef] = useState("");
  const [message, setMessage] = useState("");

  async function handleShip() {
    setMessage("");

    const res = await fetch("/api/outbound", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imei, shipment_ref: shipmentRef }),
    });

    const json = await res.json();

    if (json.ok) {
      setMessage("✅ Shipped successfully");
      setImei("");
    } else {
      setMessage("❌ " + json.error);
    }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <div className="text-xs text-slate-500">Outbound</div>
        <h2 className="text-xl font-semibold">Ship IMEI</h2>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">

        <input
          value={shipmentRef}
          onChange={(e) => setShipmentRef(e.target.value)}
          placeholder="Shipment reference (optional)"
          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
        />

        <input
          value={imei}
          onChange={(e) => setImei(e.target.value)}
          placeholder="Scan or enter IMEI"
          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-lg"
        />

        <button
          onClick={handleShip}
          className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-3 font-semibold"
        >
          Ship
        </button>

        {message && (
          <div className="text-sm mt-2">
            {message}
          </div>
        )}
      </div>
    </div>
  );
}