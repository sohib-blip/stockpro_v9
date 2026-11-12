import { describe, expect, it } from "vitest";
import { errorMessage } from "../../lib/error-message";

describe("errorMessage", () => {
  it("returns the message of an Error or a Supabase error object", () => {
    expect(errorMessage(new Error("Boom"), "Fallback")).toBe("Boom");
    expect(errorMessage({ message: "Row not found", code: "PGRST116" }, "Fallback")).toBe("Row not found");
  });

  it("falls back when the thrown value has no usable message", () => {
    expect(errorMessage(new Error(""), "Fallback")).toBe("Fallback");
    expect(errorMessage("plain string", "Fallback")).toBe("Fallback");
    expect(errorMessage(null, "Fallback")).toBe("Fallback");
    expect(errorMessage(undefined, "Fallback")).toBe("Fallback");
    expect(errorMessage({ message: null }, "Fallback")).toBe("Fallback");
  });
});
