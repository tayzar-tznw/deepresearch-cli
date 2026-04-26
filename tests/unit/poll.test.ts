import { describe, expect, it, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";
import { pollUntilDone } from "../../src/api/poll.js";
import { JobFailedError, TimeoutError } from "../../src/util/errors.js";
import type { GdrClient } from "../../src/api/client.js";
import type { InteractionResponse, InteractionStatus } from "../../src/api/types.js";
import { putJob } from "../../src/store/jobs.js";
import { jobsFilePath } from "../../src/store/paths.js";

let tmpJobsPath: string;
let savedXdg: string | undefined;

beforeEach(async () => {
  savedXdg = process.env["XDG_CONFIG_HOME"];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gdr-test-"));
  process.env["XDG_CONFIG_HOME"] = dir;
  tmpJobsPath = jobsFilePath();
  await fs.mkdir(path.dirname(tmpJobsPath), { recursive: true });
});

afterEach(() => {
  if (savedXdg === undefined) delete process.env["XDG_CONFIG_HOME"];
  else process.env["XDG_CONFIG_HOME"] = savedXdg;
});

function makeClient(sequence: InteractionStatus[]): GdrClient {
  let i = 0;
  return {
    async create(): Promise<InteractionResponse> {
      throw new Error("not used");
    },
    async cancel(): Promise<InteractionResponse> {
      throw new Error("not used");
    },
    async get(id: string): Promise<InteractionResponse> {
      const status = sequence[Math.min(i, sequence.length - 1)] ?? "in_progress";
      i++;
      return { id, status, outputs: status === "completed" ? [{ type: "text", text: "done" }] : [] };
    },
  };
}

describe("pollUntilDone", () => {
  it("returns the job when it transitions to completed", async () => {
    const client = makeClient(["in_progress", "in_progress", "completed"]);
    await putJob({
      id: "j1",
      agent: "deep-research-max-preview-04-2026",
      query: "test",
      createdAt: Date.now(),
      state: "in_progress",
      costEstimateUsd: 4.8,
    });
    const job = await pollUntilDone(client, "j1", { timeoutMs: 10_000, intervalMs: 1 });
    expect(job.status).toBe("completed");
  });

  it("throws JobFailedError when status becomes failed", async () => {
    const client = makeClient(["in_progress", "failed"]);
    await putJob({
      id: "j2",
      agent: "deep-research-max-preview-04-2026",
      query: "test",
      createdAt: Date.now(),
      state: "in_progress",
      costEstimateUsd: 4.8,
    });
    await expect(
      pollUntilDone(client, "j2", { timeoutMs: 10_000, intervalMs: 1 }),
    ).rejects.toBeInstanceOf(JobFailedError);
  });

  it("throws TimeoutError when deadline exceeded", async () => {
    const client = makeClient(["in_progress"]);
    await putJob({
      id: "j3",
      agent: "deep-research-max-preview-04-2026",
      query: "test",
      createdAt: Date.now(),
      state: "in_progress",
      costEstimateUsd: 4.8,
    });
    await expect(
      pollUntilDone(client, "j3", { timeoutMs: 50, intervalMs: 1 }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});
