// Display helpers for the Accessory Outbound preview.

// "BUZZER\t4" is shown as BUZZER with its product code 4 underneath.
export function accessoryNameParts(name: string): [string, string] {
  const [base, ...code] = String(name || "").split("\t");
  return [base.trim(), code.join(" ").trim()];
}

export function spreadsheetSource(row: {
  report_qty?: number;
  template_qty?: number;
}) {
  const fromReport = Number(row.report_qty || 0);
  const fromRules = Number(row.template_qty || 0);
  if (fromReport > 0 && fromRules > 0) {
    return `Report ${fromReport} + automatic rule ${fromRules}`;
  }
  return fromRules > 0 ? "Automatic rule" : "From report";
}
