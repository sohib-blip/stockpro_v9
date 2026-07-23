import { describe, expect, it } from "vitest";
import { getApiIdentity, resolveApiUserEmail } from "../../lib/api-identity";

function request(role: string, email = "operator@example.com") {
  return new Request("https://stockpro.test/api/nrd/current", {
    headers: {
      "x-stockpro-user-id": "00000000-0000-4000-8000-000000000001",
      "x-stockpro-user-email": email,
      "x-stockpro-user-role": role,
    },
  });
}

describe("authenticated API identity", () => {
  it("uses the trusted identity injected by middleware", () => {
    expect(getApiIdentity(request("operator"))).toEqual({
      userId: "00000000-0000-4000-8000-000000000001",
      email: "operator@example.com",
      role: "operator",
    });
  });

  it("prevents non-admin NRD impersonation", () => {
    expect(resolveApiUserEmail(request("operator"), "other@example.com")).toBe(
      "operator@example.com"
    );
  });

  it("lets an administrator inspect another NRD account", () => {
    expect(resolveApiUserEmail(request("admin"), "other@example.com")).toBe(
      "other@example.com"
    );
  });
});
