import { describe, expect, it } from "vitest";
import {
  PayloadTooLargeError,
  readBodyWithinLimit,
  readJsonBodyWithinLimit,
  requestWithBoundedBody,
} from "../../lib/security/request-budget";

describe("bounded request body edge cases", () => {
  it("accepts an exact byte limit and an empty body", async () => {
    const exact = new Request("https://stockpro.test/api", {
      method: "POST",
      body: "12345",
    });
    await expect(readBodyWithinLimit(exact, 5)).resolves.toEqual(
      Buffer.from("12345")
    );

    const empty = new Request("https://stockpro.test/api", { method: "POST" });
    await expect(readBodyWithinLimit(empty, 5)).resolves.toEqual(
      Buffer.alloc(0)
    );
  });

  it("rejects invalid and oversized declared lengths before reading the stream", async () => {
    for (const value of ["-1", "1.5", "not-a-number"]) {
      const request = new Request("https://stockpro.test/api", {
        method: "POST",
        headers: { "content-length": value },
        body: "x",
      });
      await expect(readBodyWithinLimit(request, 10)).rejects.toThrow(
        "Invalid Content-Length"
      );
    }

    const oversized = new Request("https://stockpro.test/api", {
      method: "POST",
      headers: { "content-length": "11" },
      body: "x",
    });
    await expect(readBodyWithinLimit(oversized, 10)).rejects.toBeInstanceOf(
      PayloadTooLargeError
    );
  });

  it("validates limits and surfaces malformed JSON without hiding the parser error", async () => {
    const request = new Request("https://stockpro.test/api", {
      method: "POST",
      body: "{invalid",
    });
    await expect(readBodyWithinLimit(request, 0)).rejects.toThrow(
      "A positive request byte limit is required"
    );
    await expect(readJsonBodyWithinLimit(request, 100)).rejects.toBeInstanceOf(
      SyntaxError
    );
  });

  it("rebuilds a request with the bounded bytes and preserves request metadata", async () => {
    const original = new Request("https://stockpro.test/api/example?x=1", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-request-id": "request-1",
      },
      body: "{\"ignored\":true}",
    });
    const rebuilt = requestWithBoundedBody(
      original,
      Buffer.from('{"accepted":true}')
    );

    expect(rebuilt.method).toBe("PUT");
    expect(rebuilt.url).toBe(original.url);
    expect(rebuilt.headers.get("content-type")).toBe("application/json");
    expect(rebuilt.headers.get("x-request-id")).toBe("request-1");
    await expect(rebuilt.json()).resolves.toEqual({ accepted: true });
  });
});
