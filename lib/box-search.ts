export const MAX_SEARCH_BOXES = 100;
export const MAX_BOX_CODE_LENGTH = 200;

export type BoxSearchRow = {
  query: string;
  found: boolean;
  box_id: string | null;
  device: string | null;
  location: string | null;
  imei_count: number | null;
};

export function normalizeBoxCode(value: string) {
  return value.trim().toUpperCase();
}

/**
 * Box codes may contain spaces (for example Truster POD groups), so only new
 * lines, commas, semicolons and tabs separate pasted values. Duplicates are
 * removed case-insensitively while keeping the first spelling entered.
 */
export function extractBoxCodes(body: unknown) {
  if (!body || typeof body !== "object") return [];

  const value = body as { boxCodesText?: unknown; boxCodes?: unknown };
  const inputs = Array.isArray(value.boxCodes)
    ? value.boxCodes
    : [value.boxCodesText ?? value.boxCodes ?? ""];

  const unique = new Map<string, string>();
  for (const candidate of inputs.flatMap((input) =>
    String(input ?? "").split(/[\n\r,;\t]+/g)
  )) {
    const code = candidate.trim();
    if (!code) continue;
    const key = normalizeBoxCode(code);
    if (!unique.has(key)) unique.set(key, code);
  }

  return Array.from(unique.values());
}

type BoxMatch = {
  id: string;
  box_code: string;
  floor: string | null;
  device: string | null;
};

export function buildBoxSearchRows(
  codes: string[],
  boxes: BoxMatch[],
  stockCounts: Map<string, number>
): BoxSearchRow[] {
  return codes.flatMap((query): BoxSearchRow[] => {
    const matches = boxes
      .filter((box) => normalizeBoxCode(box.box_code) === normalizeBoxCode(query))
      .sort((a, b) => String(a.device || "").localeCompare(String(b.device || "")));

    if (matches.length === 0) {
      return [
        {
          query,
          found: false,
          box_id: null,
          device: null,
          location: null,
          imei_count: null,
        },
      ];
    }

    return matches.map((box) => ({
      query,
      found: true,
      box_id: box.box_code,
      device: box.device || "Unknown",
      location: box.floor || null,
      imei_count: stockCounts.get(box.id) ?? 0,
    }));
  });
}
