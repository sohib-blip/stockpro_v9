export const RETURN_COURIERS = [
  { value: "DHL", label: "DHL" },
  { value: "EASYPOST", label: "EasyPost" },
] as const;

export const RETURN_COUNTRIES = [
  { code: "BE", label: "🇧🇪 Belgium" },
  { code: "UK", label: "🇬🇧 United Kingdom" },
  { code: "NL", label: "🇳🇱 Netherlands" },
  { code: "DE", label: "🇩🇪 Germany" },
  { code: "FR", label: "🇫🇷 France" },
  { code: "ES", label: "🇪🇸 Spain" },
  { code: "IE", label: "🇮🇪 Ireland" },
  { code: "PT", label: "🇵🇹 Portugal" },
  { code: "IT", label: "🇮🇹 Italy" },
] as const;

export const RETURN_STATUSES = [
  { value: "available", label: "Available" },
  { value: "damaged", label: "Damaged" },
  { value: "disposed", label: "Disposed" },
  {
    value: "returned_unprocessed",
    label: "Returned — Unprocessed",
  },
] as const;

export const RETURN_REASONS = [
  { value: "Returned device", controlCode: 10001 },
  { value: "Other", controlCode: 10002 },
  { value: "Fleet reductions/too many devices", controlCode: 10003 },
  { value: "Replacement (wrong device/swap out)", controlCode: 10004 },
  { value: "Service/Installation issues", controlCode: 10005 },
  { value: "Moving to competitor/price", controlCode: 10006 },
  { value: "Don't see value", controlCode: 10007 },
  { value: "Need more functionality", controlCode: 10008 },
  { value: "Account Transfer", controlCode: 10009 },
  { value: "Device Transfer", controlCode: 10010 },
  { value: "Business Closure", controlCode: 10011 },
  { value: "Returned to Sender", controlCode: 10012 },
  { value: "Credit Stop – Fraud", controlCode: 10013 },
  {
    value: "Credit Stop - Insolvency/administration",
    controlCode: 10014,
  },
  {
    value: "Credit Stop – Non payer/exhausted all recoveries",
    controlCode: 10015,
  },
] as const;

export const RETURN_STATUS_VALUES = [
  "available",
  "damaged",
  "disposed",
  "returned_unprocessed",
] as const;

export const RETURN_COURIER_VALUES = ["DHL", "EASYPOST"] as const;
export const RETURN_COUNTRY_CODES = [
  "BE",
  "UK",
  "NL",
  "DE",
  "FR",
  "ES",
  "IE",
  "PT",
  "IT",
] as const;

export const RETURN_FALLBACK_DEVICE_MODELS = [
  "LMU2640",
  "LMU30G600",
  "FMT100",
  "FMB020",
  "FMB003",
  "FMB920",
  "FMB130",
  "GL50B",
  "FMB640",
  "FMB641",
  "FMB204",
  "Badai",
] as const;

export type ReturnStatus = (typeof RETURN_STATUS_VALUES)[number];
export type ReturnReason = (typeof RETURN_REASONS)[number]["value"];

export const RETURN_REASON_VALUES = RETURN_REASONS.map(
  (reason) => reason.value
) as [ReturnReason, ...ReturnReason[]];

export function returnRequiresCanonicalItem(status: ReturnStatus | string) {
  return status === "available";
}

export function normalizeReturnReasonForTemplate(value: string): ReturnReason {
  const normalized = String(value || "").trim().toLocaleLowerCase("en");
  return (
    RETURN_REASON_VALUES.find(
      (reason) => reason.toLocaleLowerCase("en") === normalized
    ) || "Other"
  );
}

export function returnStatusLabel(value: string) {
  return (
    RETURN_STATUSES.find((status) => status.value === value)?.label || value
  );
}

export function returnCourierLabel(value: string) {
  return (
    RETURN_COURIERS.find((courier) => courier.value === value)?.label || value
  );
}

export function returnCountryLabel(value: string) {
  return (
    RETURN_COUNTRIES.find((country) => country.code === value)?.label || value
  );
}

export function returnStockActionLabel(value: string) {
  return value === "added_to_stock" ? "Added to stock" : "No stock change";
}

export function mergeReturnDeviceOptions(databaseDevices: string[]) {
  const options = [...databaseDevices, ...RETURN_FALLBACK_DEVICE_MODELS];
  const seen = new Set<string>();

  return options
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLocaleLowerCase("en");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function matchReturnDeviceOption(
  value: string,
  options: readonly string[]
) {
  const normalized = value.trim().toLocaleLowerCase("en");
  return options.find(
    (option) => option.toLocaleLowerCase("en") === normalized
  );
}
