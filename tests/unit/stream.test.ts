import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { newStreamState, renderEvent } from "../../src/output/stream.js";
import type { StreamEvent } from "../../src/api/client.js";

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let stdoutBuffer = "";
let stderrBuffer = "";

beforeEach(() => {
  stdoutBuffer = "";
  stderrBuffer = "";
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdoutBuffer += String(chunk);
    return true;
  });
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderrBuffer += String(chunk);
    return true;
  });
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

function ev(raw: Record<string, unknown>): StreamEvent {
  return { type: raw["event_type"] as StreamEvent["type"], raw };
}

describe("renderEvent", () => {
  it("renders text deltas to stdout", () => {
    const state = newStreamState();
    renderEvent(
      ev({ event_type: "content.delta", delta: { type: "text", text: "Hello world" } }),
      {},
      state,
    );
    expect(stdoutBuffer).toContain("Hello world");
  });

  it("renders thought_summary deltas to stderr (not stdout)", () => {
    const state = newStreamState();
    renderEvent(
      ev({
        event_type: "content.delta",
        delta: { type: "thought_summary", content: { type: "text", text: "I should consider X" } },
      }),
      { showThoughts: true },
      state,
    );
    expect(stderrBuffer).toContain("I should consider X");
    expect(stdoutBuffer).toBe("");
  });

  it("hides thought_summary when showThoughts is false", () => {
    const state = newStreamState();
    renderEvent(
      ev({
        event_type: "content.delta",
        delta: { type: "thought_summary", content: { type: "text", text: "secret thought" } },
      }),
      { showThoughts: false },
      state,
    );
    expect(stderrBuffer).not.toContain("secret thought");
  });

  it("surfaces tool calls when showToolCalls is true", () => {
    const state = newStreamState();
    renderEvent(
      ev({
        event_type: "content.delta",
        delta: { type: "google_search_call", arguments: { query: "post-quantum crypto" } },
      }),
      { showToolCalls: true },
      state,
    );
    expect(stderrBuffer).toMatch(/google search.*post-quantum crypto/i);
  });

  it("emits raw JSON when json mode is set", () => {
    const state = newStreamState();
    renderEvent(
      ev({ event_type: "content.delta", delta: { type: "text", text: "hi" } }),
      { json: true },
      state,
    );
    expect(stdoutBuffer.trim()).toMatch(/^\{.*"event_type":"content.delta".*\}$/);
  });

  it("interleaves thought (stderr) and text (stdout) without contamination", () => {
    const state = newStreamState();
    renderEvent(
      ev({
        event_type: "content.delta",
        delta: { type: "thought_summary", content: { type: "text", text: "thinking..." } },
      }),
      { showThoughts: true },
      state,
    );
    renderEvent(
      ev({ event_type: "content.delta", delta: { type: "text", text: "answer" } }),
      {},
      state,
    );
    expect(stdoutBuffer.trim()).toBe("answer");
    expect(stderrBuffer).toContain("thinking");
  });

  it("renders interaction.complete with status", () => {
    const state = newStreamState();
    renderEvent(
      ev({ event_type: "interaction.complete", interaction: { id: "x", status: "completed" } }),
      {},
      state,
    );
    expect(stderrBuffer).toMatch(/done.*completed/);
  });
});
