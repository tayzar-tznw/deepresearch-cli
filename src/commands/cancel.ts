import { makeClient } from "../api/client.js";
import { resolveAuth } from "../store/config.js";
import { updateJob } from "../store/jobs.js";
import { Logger } from "../output/logger.js";
import type { GlobalOpts } from "./types.js";

export interface CancelOpts extends GlobalOpts {}

export async function cancelCmd(id: string, opts: CancelOpts): Promise<void> {
  const log = new Logger(opts);
  const auth = await resolveAuth();
  const client = makeClient(auth);
  const res = await client.cancel(id);
  await updateJob(id, { state: res.status, completedAt: Date.now() });
  log.emit({ id: res.id, state: res.status });
}
