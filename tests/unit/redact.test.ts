import { describe, expect, it } from "vitest";
import { redact, redactObject } from "../../src/util/redact.js";

const SAMPLE_KEY = "AIzaSy" + "A".repeat(33);

describe("redact", () => {
  it("scrubs Google API keys (AIza...) from strings", () => {
    const out = redact(`my key is ${SAMPLE_KEY} please don't leak`);
    expect(out).not.toContain(SAMPLE_KEY);
    expect(out).toContain("AIza***REDACTED***");
  });

  it("scrubs Bearer tokens", () => {
    const out = redact("Authorization: Bearer abcdef123456ghijkl7890");
    expect(out).toContain("Bearer ***REDACTED***");
    expect(out).not.toContain("abcdef123456ghijkl7890");
  });

  it("recursively scrubs objects", () => {
    const obj = {
      message: `error with ${SAMPLE_KEY}`,
      nested: { token: "Bearer abcdef123456ghijkl7890" },
      headers: { authorization: "Bearer secret-token-1234567890" },
      apiKey: SAMPLE_KEY,
      list: [SAMPLE_KEY, "safe"],
    };
    const out = redactObject(obj);
    const json = JSON.stringify(out);
    expect(json).not.toContain(SAMPLE_KEY);
    expect(json).not.toContain("secret-token");
    expect(out.headers.authorization).toBe("***REDACTED***");
    expect(out.apiKey).toBe("***REDACTED***");
  });

  it("handles primitives and null safely", () => {
    expect(redactObject(null)).toBe(null);
    expect(redactObject(undefined)).toBe(undefined);
    expect(redactObject(42)).toBe(42);
    expect(redactObject(true)).toBe(true);
  });
});
