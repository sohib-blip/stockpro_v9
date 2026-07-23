import { describe, expect, it } from "vitest";
import { parseAuthCallbackSession } from "../../lib/auth-callback";

describe("parseAuthCallbackSession", () => {
  it("extracts the Supabase session from an invitation hash", () => {
    expect(
      parseAuthCallbackSession(
        "#access_token=access-value&refresh_token=refresh-value&type=invite"
      )
    ).toEqual({
      access_token: "access-value",
      refresh_token: "refresh-value",
    });
  });

  it("accepts a hash without the leading marker", () => {
    expect(
      parseAuthCallbackSession(
        "access_token=access-value&refresh_token=refresh-value"
      )
    ).toEqual({
      access_token: "access-value",
      refresh_token: "refresh-value",
    });
  });

  it("rejects incomplete or unrelated callback fragments", () => {
    expect(parseAuthCallbackSession("#type=invite")).toBeNull();
    expect(parseAuthCallbackSession("#access_token=access-value")).toBeNull();
    expect(parseAuthCallbackSession("")).toBeNull();
  });
});
