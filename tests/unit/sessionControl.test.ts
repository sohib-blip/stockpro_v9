import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  signOutCurrentDevice,
  STOCKPRO_SESSION_KEY,
  touchOwnedSession,
} from "../../lib/session-control";

function createProfileUpdateMock() {
  const currentSessionEq = vi.fn().mockResolvedValue({ error: null });
  const userEq = vi.fn().mockReturnValue({ eq: currentSessionEq });
  const update = vi.fn().mockReturnValue({ eq: userEq });
  const from = vi.fn().mockReturnValue({ update });

  return { currentSessionEq, from, update, userEq };
}

describe("session control", () => {
  it("only clears the profile session owned by the current device", async () => {
    const profile = createProfileUpdateMock();
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
        }),
        signOut,
      },
      from: profile.from,
    } as unknown as SupabaseClient;
    const storage = {
      getItem: vi.fn().mockReturnValue("old-device-session"),
      removeItem: vi.fn(),
    };

    await signOutCurrentDevice(
      supabase,
      storage,
      new Date("2026-07-17T10:00:00.000Z")
    );

    expect(profile.from).toHaveBeenCalledWith("profiles");
    expect(profile.userEq).toHaveBeenCalledWith("user_id", "user-1");
    expect(profile.currentSessionEq).toHaveBeenCalledWith(
      "current_session_id",
      "old-device-session"
    );
    expect(storage.removeItem).toHaveBeenCalledWith(STOCKPRO_SESSION_KEY);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("does not clear a profile when the browser has no StockPro session", async () => {
    const profile = createProfileUpdateMock();
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
        }),
        signOut,
      },
      from: profile.from,
    } as unknown as SupabaseClient;
    const storage = {
      getItem: vi.fn().mockReturnValue(null),
      removeItem: vi.fn(),
    };

    await signOutCurrentDevice(supabase, storage);

    expect(profile.from).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("still clears the browser when reading the profile session fails", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      auth: {
        getUser: vi.fn().mockRejectedValue(new Error("network unavailable")),
        signOut,
      },
      from: vi.fn(),
    } as unknown as SupabaseClient;
    const storage = {
      getItem: vi.fn().mockReturnValue("device-session"),
      removeItem: vi.fn(),
    };

    const result = await signOutCurrentDevice(supabase, storage);

    expect(result.profileError).toBeInstanceOf(Error);
    expect(storage.removeItem).toHaveBeenCalledWith(STOCKPRO_SESSION_KEY);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("only refreshes the heartbeat for the session still owned by the device", async () => {
    const profile = createProfileUpdateMock();
    const supabase = {
      from: profile.from,
    } as unknown as SupabaseClient;

    await touchOwnedSession(
      supabase,
      "user-1",
      "current-device-session",
      new Date("2026-07-17T10:00:00.000Z")
    );

    expect(profile.update).toHaveBeenCalledWith({
      last_seen_at: "2026-07-17T10:00:00.000Z",
    });
    expect(profile.userEq).toHaveBeenCalledWith("user_id", "user-1");
    expect(profile.currentSessionEq).toHaveBeenCalledWith(
      "current_session_id",
      "current-device-session"
    );
  });
});
