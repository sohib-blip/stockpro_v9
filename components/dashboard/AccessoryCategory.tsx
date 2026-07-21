"use client";

import { AnimatePresence, motion } from "motion/react";

type Props = {
  title: string;
  items: any[];
  open: boolean;
  onToggle: () => void;
};

export default function AccessoryCategory({
  title,
  items,
  open,
  onToggle,
}: Props) {
  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-sp-border bg-sp-surface">

      <button
  type="button"
  onClick={onToggle}
  className="flex w-full items-center justify-between bg-sp-surface-2 px-5 py-4 text-sp-body transition-colors hover:bg-sp-bg"
>
        <div className="flex items-center gap-3">

          <span className="font-semibold text-sp-text">
            {title}
          </span>

          <span className="sp-badge sp-badge-brand">
            {items.length}
          </span>

        </div>

        <motion.span
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.2 }}
          className="text-sp-muted"
        >
          ▶
        </motion.span>

      </button>

      <AnimatePresence initial={false}>
  {open && (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.25, ease: "easeInOut" }}
      className="overflow-hidden"
    >

            <div className="overflow-x-auto">
            <table className="sp-table">

              <thead>

                <tr>
                  <th>Accessory</th>
                  <th>Qty</th>
                  <th>Min</th>
                  <th>Status</th>
                </tr>

              </thead>

              <tbody>

                {items.map((a: any) => (

                  <tr key={a.id}>

                    <td className="font-medium">
                      {a.name}
                    </td>

                    <td>
                      {a.current_stock}
                    </td>

                    <td>
                      {a.minimum_stock}
                    </td>

                    <td>

                      <span
                        className={`sp-badge
                          ${
                            a.status === "OK"
                              ? "sp-badge-ok"
                              : ""
                          }
                          ${
                            a.status === "LOW"
                              ? "sp-badge-low"
                              : ""
                          }
                          ${
                            a.status === "EMPTY"
                              ? "sp-badge-empty"
                              : ""
                          }
                        `}
                      >
                        {a.status}
                      </span>

                    </td>

                  </tr>

                ))}

              </tbody>

            </table>
            </div>

          </motion.div>

        )}

      </AnimatePresence>

    </div>
  );
}
