"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { PickingSheet, PickingSheetLine } from "@/lib/dispatch-picking-sheet";

function TotalsList({ lines, empty }: { lines: PickingSheetLine[]; empty: string }) {
  if (lines.length === 0) return <p className="picking-sheet-ok">{empty}</p>;
  return (
    <ul className="picking-sheet-totals">
      {lines.map((line) => (
        <li key={line.name}>
          <span className="picking-sheet-box" aria-hidden="true" />
          <strong>{`${line.quantity} ×`}</strong>
          <span>{line.name}</span>
        </li>
      ))}
    </ul>
  );
}

// Printable A4 picking sheet: devices to fetch from stock, packaging and
// accessories for the day, then the orders grouped by kind with a box to tick.
// Rendered at the end of <body> so printing can hide the rest of the app.
export default function DispatchPickingSheet({
  sheet,
  sourceName,
  onClose,
}: {
  sheet: PickingSheet;
  sourceName: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const today = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date());
  const packageCount = sheet.packaging.reduce((sum, line) => sum + line.quantity, 0);

  return createPortal(
    <div className="picking-sheet-overlay" role="dialog" aria-modal="true" aria-labelledby="picking-sheet-title">
      <div className="picking-sheet-toolbar">
        <strong>Print preview</strong>
        <div>
          <button type="button" className="prototype-button secondary" onClick={onClose}>Close</button>
          <button type="button" className="prototype-button primary" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      <article className="picking-sheet">
        <header>
          <h1 id="picking-sheet-title">Picking Sheet</h1>
          <p>
            {`${today} · ${sheet.orders.length} orders · ${sheet.totalDevices} devices · ${packageCount} packages${sourceName ? ` · ${sourceName}` : ""}`}
          </p>
        </header>

        <section>
          <h2>Go get from stock</h2>
          {sheet.shortages.length === 0 ? (
            <p className="picking-sheet-ok">Everything is in the Cabinet.</p>
          ) : (
            <ul className="picking-sheet-shortages">
              {sheet.shortages.map((line) => (
                <li key={line.device}>
                  <strong>{`${line.missing} × ${line.device}`}</strong>
                  <span>{`needed ${line.needed} · Cabinet ${line.inCabinet}`}</span>
                  {line.outOfStock ? (
                    <em>{`Not enough stock: ${line.outOfStock} missing in the warehouse`}</em>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="picking-sheet-columns">
          <section>
            <h2>Packaging</h2>
            <TotalsList lines={sheet.packaging} empty="No packaging selected." />
          </section>
          <section>
            <h2>Accessories</h2>
            <TotalsList lines={sheet.accessories} empty="No accessories." />
          </section>
        </div>

        {sheet.groups.map((group) => (
          <section key={group.key}>
            <h2>{`${group.title} (${group.orders.length})`}</h2>
            <ul className="picking-sheet-orders">
              {group.orders.map((order) => (
                <li key={order.orderId}>
                  <span className="picking-sheet-box" aria-hidden="true" />
                  <strong>{order.orderId}</strong>
                  <span>
                    {order.devices.length > 0
                      ? order.devices.map((line) => `${line.quantity} × ${line.device}`).join(" · ")
                      : "Accessories only"}
                    {order.carried ? <em className="picking-sheet-carried">Carried over</em> : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </article>
    </div>,
    document.body
  );
}
