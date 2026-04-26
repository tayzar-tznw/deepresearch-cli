import { makeClient } from "../api/client.js";
import { pollUntilDone } from "../api/poll.js";
import { resolveAuth } from "../store/config.js";
import { Logger } from "../output/logger.js";
import { warnIfVertexDeepResearch } from "./_warn.js";
import type { GlobalOpts } from "./types.js";

export interface WaitOpts extends GlobalOpts {
  timeout?: string;
  interval?: string;
}

export async function waitCmd(id: string, opts: WaitOpts): Promise<void> {
  const log = new Logger(opts);
  const auth = await resolveAuth();
  warnIfVertexDeepResearch(log, auth);
  const client = makeClient(auth);
  const timeoutMin = parseInt(opts.timeout ?? "60", 10);
  const intervalSec = parseInt(opts.interval ?? "15", 10);
  const spinner = log.spinner(`polling ${id} (every ${intervalSec}s, timeout ${timeoutMin}m)`);
  try {
    const job = await pollUntilDone(client, id, {
      timeoutMs: timeoutMin * 60_000,
      intervalMs: intervalSec * 1000,
      onUpdate: (j) => {
        if (spinner) spinner.text = `polling ${id} — status: ${j.status}`;
      },
    });
    spinner?.succeed(`job ${id} ${job.status}`);
    log.emit({ id: job.id, state: job.status, next: `gdr fetch ${job.id} --out ./research` });
  } catch (err) {
    spinner?.fail();
    throw err;
  }
}
