import { createHash } from "node:crypto";
import type { DispatchOrder } from "@/lib/dispatch-planning";

export function dispatchComposition(order: DispatchOrder) {
  return order.items
    .map((item) => ({
      item: item.name.trim(),
      quantity: item.quantity,
    }))
    .sort(
      (a, b) =>
        a.item.localeCompare(b.item, undefined, { sensitivity: "base" }) ||
        a.quantity - b.quantity
    );
}

export function dispatchCompositionKey(order: DispatchOrder) {
  return createHash("sha256")
    .update(JSON.stringify(dispatchComposition(order)))
    .digest("hex");
}
