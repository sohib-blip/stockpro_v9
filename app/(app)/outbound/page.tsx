"use client";

export default function OutboundPage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-slate-500">Outbound</div>
        <h2 className="text-xl font-semibold">Outbound</h2>
        <p className="text-sm text-slate-400 mt-1">
          V1: exports + base flow. Next: scan IMEI, assign box, mark out, history.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3">
        <div className="text-sm font-semibold">Exports</div>
        <div className="flex flex-wrap gap-2">
          <a
            href="/api/export/inventory"
            className="rounded-xl bg-slate-950 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
          >
            Export inventory
          </a>
          <a
            href="/api/export/in-stock"
            className="rounded-xl bg-slate-950 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
          >
            Export in-stock
          </a>
        </div>

        <div className="text-xs text-slate-500">
          Prochaine étape: formulaire “Ship” + scan IMEI, sélection client, génération packing list.
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="text-sm font-semibold">Roadmap Outbound</div>
        <ul className="list-disc pl-5 mt-2 text-sm text-slate-300 space-y-1">
          <li>Scan IMEI (ou import list)</li>
          <li>Créer un “shipment” (client, date, reference)</li>
          <li>Marquer items OUT + historique</li>
          <li>Export packing list + preuve</li>
        </ul>
      </div>
    </div>
  );
}