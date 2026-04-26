import { JobFailedError, TimeoutError } from "../util/errors.js";
import { sleep } from "../util/retry.js";
import { updateJob } from "../store/jobs.js";
import type { GdrClient } from "./client.js";
import type { InteractionResponse, InteractionStatus } from "./types.js";

export interface PollOpts {
  timeoutMs: number;
  intervalMs?: number;
  maxIntervalMs?: number;
  onUpdate?: (job: InteractionResponse) => void;
}

const TERMINAL: InteractionStatus[] = ["completed", "failed", "cancelled", "incomplete"];

export async function pollUntilDone(
  client: GdrClient,
  id: string,
  opts: PollOpts,
): Promise<InteractionResponse> {
  const deadline = Date.now() + opts.timeoutMs;
  let interval = opts.intervalMs ?? 15_000;
  const maxInterval = opts.maxIntervalMs ?? 60_000;
  while (Date.now() < deadline) {
    const job = await client.get(id);
    await updateJob(id, {
      state: job.status,
      lastSeenAt: Date.now(),
      ...(TERMINAL.includes(job.status) ? { completedAt: Date.now() } : {}),
      ...(job.status === "failed" && job.error?.message ? { errorMessage: job.error.message } : {}),
    });
    opts.onUpdate?.(job);
    if (job.status === "completed") return job;
    if (job.status === "requires_action") return job;
    if (job.status === "failed") {
      throw new JobFailedError(id, job.status, job.error?.message);
    }
    if (job.status === "cancelled" || job.status === "incomplete") {
      throw new JobFailedError(id, job.status);
    }
    await sleep(interval);
    interval = Math.min(Math.floor(interval * 1.4), maxInterval);
  }
  throw new TimeoutError(id);
}
