import { describe, expect, it } from "vitest";
import { isAuthenticationRoute } from "../../lib/auth-routes";

describe("isAuthenticationRoute", () => {
  it.each(["/login", "/set-password", "/reset-password"])(
    "disables automatic logout on %s",
    (pathname) => {
      expect(isAuthenticationRoute(pathname)).toBe(true);
    }
  );

  it.each(["/dashboard", "/admin", "/inbound"])(
    "keeps automatic logout enabled on %s",
    (pathname) => {
      expect(isAuthenticationRoute(pathname)).toBe(false);
    }
  );
});
