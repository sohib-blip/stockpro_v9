import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  saveSecurityAlertRecipient,
  securityAlertAudience,
} from "../../lib/security-alert-recipients";

type Rows = { recipients: string[]; admins: string[] };

function fakeSupabase(rows: Rows) {
  const writes: Array<{ action: string; payload?: unknown; userId?: string }> = [];
  const client = {
    from(table: string) {
      if (table === "security_alert_recipients") {
        return {
          select: () =>
            Promise.resolve({
              data: rows.recipients.map((user_id) => ({ user_id })),
              error: null,
            }),
          upsert: (payload: unknown) => {
            writes.push({ action: "upsert", payload });
            return Promise.resolve({ error: null });
          },
          delete: () => ({
            eq: (_column: string, userId: string) => {
              writes.push({ action: "delete", userId });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === "user_roles") {
        return {
          select: () => ({
            eq: (_column: string, role: string) => ({
              in: (_idColumn: string, ids: string[]) =>
                Promise.resolve({
                  data: ids
                    .filter((id) => role === "admin" && rows.admins.includes(id))
                    .map((user_id) => ({ user_id })),
                  error: null,
                }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client: client as unknown as SupabaseClient, writes };
}

describe("security alert IT contacts", () => {
  it("shows the alert to every administrator while no IT contact is chosen", async () => {
    const { client } = fakeSupabase({ recipients: [], admins: ["a1", "a2"] });
    expect(await securityAlertAudience(client, "a2")).toEqual({
      visible: true,
      itContactMissing: true,
    });
  });

  it("shows the alert only to the chosen IT contact", async () => {
    const { client } = fakeSupabase({ recipients: ["a1"], admins: ["a1", "a2"] });
    expect(await securityAlertAudience(client, "a1")).toEqual({
      visible: true,
      itContactMissing: false,
    });
    expect(await securityAlertAudience(client, "a2")).toEqual({
      visible: false,
      itContactMissing: false,
    });
  });

  it("ignores an IT contact who is no longer an administrator", async () => {
    const { client } = fakeSupabase({ recipients: ["former"], admins: ["a1"] });
    expect(await securityAlertAudience(client, "a1")).toEqual({
      visible: true,
      itContactMissing: true,
    });
  });

  it("adds an administrator, and removes the flag from anyone who is not one", async () => {
    const { client, writes } = fakeSupabase({ recipients: [], admins: [] });

    await saveSecurityAlertRecipient(client, "a1", "admin", true, "boss@stockpro.test");
    await saveSecurityAlertRecipient(client, "a2", "admin", false, null);
    await saveSecurityAlertRecipient(client, "o1", "operator", true, null);
    await saveSecurityAlertRecipient(client, "a3", "admin", undefined, null);

    expect(writes).toEqual([
      {
        action: "upsert",
        payload: { user_id: "a1", added_by_email: "boss@stockpro.test" },
      },
      { action: "delete", userId: "a2" },
      { action: "delete", userId: "o1" },
    ]);
  });
});
