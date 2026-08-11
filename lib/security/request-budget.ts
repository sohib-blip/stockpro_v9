export class PayloadTooLargeError extends Error {
  readonly status = 413;

  constructor(message = "Request payload is too large") {
    super(message);
    this.name = "PayloadTooLargeError";
  }
}

function declaredContentLength(req: Request) {
  const value = req.headers.get("content-length");
  if (!value) return null;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new PayloadTooLargeError("Invalid Content-Length");
  }

  return parsed;
}

export async function readBodyWithinLimit(req: Request, maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("A positive request byte limit is required");
  }

  const declared = declaredContentLength(req);
  if (declared !== null && declared > maxBytes) {
    throw new PayloadTooLargeError();
  }

  if (!req.body) return Buffer.alloc(0);

  const reader = req.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("request body limit exceeded").catch(() => {});
        throw new PayloadTooLargeError();
      }

      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, total);
}

export async function readJsonBodyWithinLimit<T = unknown>(
  req: Request,
  maxBytes: number
): Promise<T> {
  const body = await readBodyWithinLimit(req, maxBytes);
  return JSON.parse(body.toString("utf8")) as T;
}

export function requestWithBoundedBody(req: Request, body: Buffer) {
  const bytes = Uint8Array.from(body);
  return new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: bytes,
  });
}
