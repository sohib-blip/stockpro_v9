// Supabase caps every API response (PostgREST max_rows, 1,000 on StockPro
// projects, staging and production alike). A single select silently stops at
// that cap, so every export or list that may grow past it reads page by page.
//
// The next page starts after the rows actually received and reading stops only
// on an empty page, so a server cap lower than the page size cannot truncate
// the result. fetchPage must use a stable order that ends with a unique column
// (for example created_at, then id): with a non-unique order the database may
// return rows in a different order on each page and repeat or skip some.
export const READ_PAGE_SIZE = 1000;
const MAX_PAGES = 1000;

export async function readAllPages<Row>(
  fetchPage: (from: number, to: number) => PromiseLike<readonly Row[] | null>,
  pageSize = READ_PAGE_SIZE
) {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error("Invalid page size");
  }

  const rows: Row[] = [];
  for (let pages = 0; pages < MAX_PAGES; pages += 1) {
    const from = rows.length;
    const page = (await fetchPage(from, from + pageSize - 1)) || [];
    if (page.length === 0) return rows;
    rows.push(...page);
  }
  throw new Error("Read stopped: too many pages");
}

// Unwraps a Supabase response: throws its error, otherwise returns its rows.
export function rowsOrThrow<Row>(result: {
  data: Row[] | null;
  error: unknown;
}): Row[] {
  if (result.error) throw result.error;
  return result.data ?? [];
}

// `.in("id", ids)` puts every id in the request URL, which becomes too long
// past a few hundred UUIDs. Lookups by id are split into small chunks; each
// chunk returns at most one row per id, far below the response cap.
export const LOOKUP_CHUNK_SIZE = 200;

export async function readInChunks<Id, Row>(
  ids: Iterable<Id>,
  fetchChunk: (chunk: Id[]) => PromiseLike<readonly Row[] | null>,
  chunkSize = LOOKUP_CHUNK_SIZE
) {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error("Invalid chunk size");
  }

  const unique = Array.from(new Set(ids));
  const rows: Row[] = [];
  for (let index = 0; index < unique.length; index += chunkSize) {
    rows.push(...((await fetchChunk(unique.slice(index, index + chunkSize))) || []));
  }
  return rows;
}

// Message of a thrown value: Supabase errors are plain objects, not Errors.
export function errorMessage(error: unknown, fallback: string) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message || "")
      : "";
  return message || fallback;
}
