export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@supabase/supabase-js") {
    return {
      url: new URL("./fake-supabase.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
