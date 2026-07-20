"use client";

import { AnimatePresence, motion } from "motion/react";
import { ChevronRight } from "lucide-react";

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
    <div className="border border-white/10 rounded-xl overflow-hidden mb-4">

      <button
  type="button"
  onClick={onToggle}
  className="w-full flex items-center justify-between px-5 py-4 bg-white/5 hover:bg-white/10 transition"
>
        <div className="flex items-center gap-3">

          <span className="font-semibold">
            {title}
          </span>

          <span className="text-xs bg-cyan-500/20 text-cyan-400 px-2 py-1 rounded-full">
            {items.length}
          </span>

        </div>

        <motion.span
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronRight size={16} />
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

            <table className="w-full text-sm">

              <thead>

                <tr className="text-left text-slate-400 border-b border-white/5">
                  <th className="py-3 px-4">Accessory</th>
                  <th>Quantity</th>
                  <th>Minimum</th>
                  <th>Status</th>
                </tr>

              </thead>

              <tbody>

                {items.map((a: any) => (

                  <tr
                    key={a.id}
                    className="border-b border-white/5"
                  >

                    <td className="py-3 px-4 font-medium">
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
                        className={`px-2 py-1 rounded text-xs font-semibold
                          ${
                            a.status === "OK"
                              ? "bg-emerald-500/20 text-emerald-400"
                              : ""
                          }
                          ${
                            a.status === "LOW"
                              ? "bg-amber-500/20 text-amber-300"
                              : ""
                          }
                          ${
                            a.status === "EMPTY"
                              ? "bg-red-500/20 text-red-400"
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

          </motion.div>

        )}

      </AnimatePresence>

    </div>
  );
}
