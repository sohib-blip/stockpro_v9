import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const autoLogout = readFileSync(join(root, "components/AutoLogout.tsx"), "utf8");
const login = readFileSync(join(root, "app/(auth)/login/page.tsx"), "utf8");

describe("session expiry UI", () => {
  it("redirects a replaced session to login with an explicit reason", () => {
    expect(autoLogout).toContain('router.replace("/login?reason=session-expired")');
    expect(autoLogout).toContain("STOCKPRO_SESSION_NOTICE_KEY");
  });

  it("explains the secure session takeover on the login page", () => {
    expect(login).toContain('reason === "session-expired"');
    expect(login).toContain("window.sessionStorage.getItem(STOCKPRO_SESSION_NOTICE_KEY)");
    expect(login).toContain(
      "Your previous session was closed because this account signed in on another device."
    );
  });
});
