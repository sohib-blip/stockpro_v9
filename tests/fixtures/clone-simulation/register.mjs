// Loaded with `node --import` by tests/unit/cloneScriptSimulation.test.ts.
// Replaces @supabase/supabase-js with the fake clients and cuts the network:
// the only "request" allowed is the OpenAPI read of the two fake projects.
import { register } from "node:module";
import { definitionsFor } from "./fake-supabase.mjs";

register("./hooks.mjs", import.meta.url);

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  const definitions = url.pathname === "/rest/v1/" ? definitionsFor(url.hostname) : null;
  if (!definitions) {
    throw new Error(`Offline simulation: network call refused (${url.hostname}${url.pathname})`);
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ definitions }),
  };
};
