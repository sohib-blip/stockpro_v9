import { describe, expect, it } from "vitest";
import { sessionIdFromAccessToken } from "../../lib/security/app-session";

function unsignedToken(payload: Record<string, unknown>) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

describe("Supabase session binding", () => {
  it("extracts the signed Supabase session identifier after token verification", () => {
    expect(
      sessionIdFromAccessToken(
        unsignedToken({ session_id: "c858e844-14d7-4a71-88b6-f8a87eb7997a" })
      )
    ).toBe("c858e844-14d7-4a71-88b6-f8a87eb7997a");
  });

  it("rejects malformed tokens and unsafe session identifiers", () => {
    expect(sessionIdFromAccessToken("not-a-jwt")).toBeNull();
    expect(sessionIdFromAccessToken(unsignedToken({}))).toBeNull();
    expect(
      sessionIdFromAccessToken(unsignedToken({ session_id: "<script>" }))
    ).toBeNull();
  });
});
