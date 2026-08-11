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
  {
    value: "returned_unprocessed",
    label: "Returned — Unprocessed",
  },
] as const;

export const RETURN_STATUS_VALUES = [
  "available",
  "damaged",
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

export type ReturnStatus = (typeof RETURN_STATUS_VALUES)[number];

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
