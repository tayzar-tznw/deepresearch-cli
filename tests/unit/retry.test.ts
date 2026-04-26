import { describe, expect, it } from "vitest";
import { isRetryableHttpError, retry } from "../../src/util/retry.js";

describe("retry", () => {
  it("returns the value on first success", async () => {
    let calls = 0;
    const result = await retry(async () => {
      calls++;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries on failure and eventually succeeds", async () => {
    let calls = 0;
    const result = await retry(
      async () => {
        calls++;
        if (calls < 3) throw new Error("transient");
        return "ok";
      },
      { retries: 5, minTimeoutMs: 1, maxTimeoutMs: 1 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("gives up after retries exhausted and throws last error", async () => {
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls++;
          throw new Error(`call ${calls}`);
        },
        { retries: 2, minTimeoutMs: 1, maxTimeoutMs: 1 },
      ),
    ).rejects.toThrow("call 3");
    expect(calls).toBe(3);
  });

  it("respects shouldRetry predicate (no retry for 400)", async () => {
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls++;
          throw Object.assign(new Error("bad request"), { status: 400 });
        },
        { retries: 5, minTimeoutMs: 1, shouldRetry: isRetryableHttpError },
      ),
    ).rejects.toThrow("bad request");
    expect(calls).toBe(1);
  });

  it("isRetryableHttpError flags 429 and 5xx", () => {
    expect(isRetryableHttpError({ status: 429 })).toBe(true);
    expect(isRetryableHttpError({ status: 500 })).toBe(true);
    expect(isRetryableHttpError({ status: 503 })).toBe(true);
    expect(isRetryableHttpError({ status: 400 })).toBe(false);
    expect(isRetryableHttpError({ status: 401 })).toBe(false);
    expect(isRetryableHttpError({ code: "ECONNRESET" })).toBe(true);
  });
});
