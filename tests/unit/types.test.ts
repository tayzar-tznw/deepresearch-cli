import { describe, expect, it } from "vitest";
import { extractText, InteractionResponseSchema } from "../../src/api/types.js";

describe("InteractionResponseSchema", () => {
  it("parses a minimal in_progress response", () => {
    const parsed = InteractionResponseSchema.parse({ id: "x", status: "in_progress" });
    expect(parsed.status).toBe("in_progress");
  });

  it("parses a completed response with text outputs", () => {
    const parsed = InteractionResponseSchema.parse({
      id: "x",
      status: "completed",
      outputs: [
        { type: "text", text: "Hello" },
        { type: "image", data: "base64data", mime_type: "image/png" },
      ],
    });
    expect(parsed.outputs).toHaveLength(2);
  });

  it("parses unknown status values gracefully via passthrough on the wrapper", () => {
    // status itself is enum-validated, so this should reject:
    expect(() => InteractionResponseSchema.parse({ id: "x", status: "weird" })).toThrow();
  });

  it("parses unknown content types via passthrough", () => {
    const parsed = InteractionResponseSchema.parse({
      id: "x",
      status: "completed",
      outputs: [{ type: "future_unknown", arbitrary: "field" }],
    });
    expect(parsed.outputs?.[0]?.type).toBe("future_unknown");
  });
});

describe("extractText", () => {
  it("concatenates text content blocks", () => {
    expect(
      extractText([
        { type: "text", text: "first" },
        { type: "text", text: "second" },
        { type: "image", data: "..." },
      ]),
    ).toBe("first\n\nsecond");
  });

  it("returns empty string for no outputs", () => {
    expect(extractText(undefined)).toBe("");
    expect(extractText([])).toBe("");
  });
});
