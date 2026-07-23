import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  signOutCurrentDevice,
  STOCKPRO_SESSION_KEY,
  touchOwnedSession,
} from "../../lib/session-control";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("session control", () => {
  it("ends the owned application session through the server boundary", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: "signed-token" } },
        }),
        signOut,
      },
    } as unknown as SupabaseClient;
    const storage = {
      getItem: vi.fn().mockReturnValue("owned-session"),
      removeItem: vi.fn(),
    };
    const request = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", request);

    await signOutCurrentDevice(supabase, storage);

    expect(request).toHaveBeenCalledWith("/api/auth/session", {
      method: "DELETE",
      headers: { Authorization: "Bearer signed-token" },
    });
    expect(storage.removeItem).toHaveBeenCalledWith(STOCKPRO_SESSION_KEY);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("does not call the server when the browser has no StockPro session", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const getSession = vi.fn();
    const supabase = {
      auth: { getSession, signOut },
    } as unknown as SupabaseClient;
    const storage = {
      getItem: vi.fn().mockReturnValue(null),
      removeItem: vi.fn(),
    };
    const request = vi.fn();
    vi.stubGlobal("fetch", request);

    await signOutCurrentDevice(supabase, storage);

    expect(getSession).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("still clears the browser when ending the server session fails", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      auth: {
        getSession: vi.fn().mockRejectedValue(new Error("network unavailable")),
        signOut,
      },
    } as unknown as SupabaseClient;
    const storage = {
      getItem: vi.fn().mockReturnValue("owned-session"),
      removeItem: vi.fn(),
    };

    const result = await signOutCurrentDevice(supabase, storage);

    expect(result.profileError).toBeInstanceOf(Error);
    expect(storage.removeItem).toHaveBeenCalledWith(STOCKPRO_SESSION_KEY);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("refreshes activity through the authenticated server boundary", async () => {
    const supabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: "signed-token" } },
        }),
      },
    } as unknown as SupabaseClient;
    const request = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", request);

    const result = await touchOwnedSession(
      supabase,
      "user-1",
      "owned-session",
      new Date("2026-07-17T10:00:00.000Z")
    );

    expect(result.error).toBeNull();
    expect(request).toHaveBeenCalledWith("/api/auth/session", {
      method: "PATCH",
      headers: { Authorization: "Bearer signed-token" },
    });
  });
});
