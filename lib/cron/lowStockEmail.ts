export type LowStockEmailRow = {
  device: unknown;
  imei_count: unknown;
  min_stock: unknown;
};

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildLowStockEmail(rows: readonly LowStockEmailRow[]) {
  const itemLabel = rows.length === 1 ? "item" : "items";
  const htmlItems = rows
    .map(
      (row) =>
        `<li><b>${escapeHtml(row.device)}</b> — IN ` +
        `${escapeHtml(row.imei_count)} ≤ MIN ${escapeHtml(row.min_stock)}</li>`
    )
    .join("");
  const textItems = rows
    .map(
      (row) =>
        `${String(row.device ?? "")} — IN ${String(row.imei_count ?? "")} ` +
        `≤ MIN ${String(row.min_stock ?? "")}`
    )
    .join("\n");

  return {
    subject: `Low Stock Alert — ${rows.length} ${itemLabel}`,
    html: `<h2>Low stock alert</h2><ul>${htmlItems}</ul>`,
    text: `Low stock alert\n\n${textItems}`,
  };
}
