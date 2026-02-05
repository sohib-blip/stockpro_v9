export function normalizeDeviceName(input: string) {
  let s = String(input ?? "").trim().replace(/\s+/g, " ");
  if (!s) return "";

  s = s.toUpperCase();

  // FMC234WC3XWU-025-007 -> FMC234WC3XWU
  s = s.split("-")[0].trim();

  return s;
}

export type Location = "00" | "1" | "6" | "Cabinet";

export const LOCATIONS: Location[] = ["00", "1", "6", "Cabinet"];

export function normalizeLocation(loc: string): Location {
  if (LOCATIONS.includes(loc as Location)) return loc as Location;
  return "00";
}