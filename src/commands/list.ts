import { listJobs, monthlyCostUsd, type JobState } from "../store/jobs.js";
import { Logger } from "../output/logger.js";
import { formatUsd } from "../util/cost.js";
import type { GlobalOpts } from "./types.js";

export interface ListOpts extends GlobalOpts {
  state?: string;
  limit?: string;
}

export async function listCmd(opts: ListOpts): Promise<void> {
  const log = new Logger(opts);
  const all = await listJobs();
  const filtered = opts.state ? all.filter((j) => j.state === (opts.state as JobState)) : all;
  const limit = opts.limit ? parseInt(opts.limit, 10) : filtered.length;
  const rows = filtered.slice(0, limit);
  const monthly = await monthlyCostUsd();
  if (log.isJson) {
    log.emit({ jobs: rows, monthly_cost_usd: monthly });
    return;
  }
  if (rows.length === 0) {
    log.info("(no jobs in local cache — start one with `gdr start \"<query>\"`)");
  } else {
    for (const j of rows) {
      const age = humanAge(Date.now() - j.createdAt);
      const label = j.label ? ` [${j.label}]` : "";
      const tier = j.agent.includes("max") ? "MAX" : "STD";
      const line = `${j.id}  ${j.state.padEnd(14)} ${tier}  ${formatUsd(j.costEstimateUsd ?? 0).padStart(6)}  ${age.padStart(6)}  ${truncate(j.query, 48)}${label}`;
      log.emit(line);
    }
  }
  log.info(`30-day estimated spend: ${formatUsd(monthly)}`);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function humanAge(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}
