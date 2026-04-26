import { makeClient } from "../api/client.js";
import { getJob, updateJob } from "../store/jobs.js";
import { resolveAuth } from "../store/config.js";
import { Logger } from "../output/logger.js";
import type { GlobalOpts } from "./types.js";

export interface StatusOpts extends GlobalOpts {}

export async function statusCmd(id: string, opts: StatusOpts): Promise<void> {
  const log = new Logger(opts);
  const auth = await resolveAuth();
  const client = makeClient(auth);
  const remote = await client.get(id);
  await updateJob(id, { state: remote.status, lastSeenAt: Date.now() });
  const local = await getJob(id);
  log.emit({
    id: remote.id,
    state: remote.status,
    agent: remote.agent ?? local?.agent,
    created: remote.created ?? (local?.createdAt ? new Date(local.createdAt).toISOString() : undefined),
    updated: remote.updated,
    error: remote.error?.message,
    label: local?.label,
    cost_estimate_usd: local?.costEstimateUsd,
  });
}
