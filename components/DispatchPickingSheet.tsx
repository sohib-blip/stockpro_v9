"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { PickingSheet } from "@/lib/dispatch-picking-sheet";

// One printable A4 page: devices to fetch from stock, then each order with a
// box to tick once it is prepared. Rendered at the end of <body> so printing
// can hide the rest of the application.
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
            {`${today} · ${sheet.orders.length} orders · ${sheet.totalDevices} devices${sourceName ? ` · ${sourceName}` : ""}`}
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

        <section>
          <h2>Orders</h2>
          <ul className="picking-sheet-orders">
            {sheet.orders.map((order) => (
              <li key={order.orderId}>
                <span className="picking-sheet-box" aria-hidden="true" />
                <strong>{order.orderId}</strong>
                <span>
                  {order.devices.length > 0
                    ? order.devices.map((line) => `${line.quantity} × ${line.device}`).join(" · ")
                    : "Accessories only"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </article>
    </div>,
    document.body
  );
}
