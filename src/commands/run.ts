import path from "node:path";
import { makeClient, type CreateJobRequest } from "../api/client.js";
import { pollUntilDone } from "../api/poll.js";
import { putJob, updateJob } from "../store/jobs.js";
import { readConfig, resolveAuth } from "../store/config.js";
import { warnIfVertexDeepResearch } from "./_warn.js";
import { saveArtifacts } from "../output/artifacts.js";
import { Logger } from "../output/logger.js";
import { newStreamState, renderEvent } from "../output/stream.js";
import { AGENT_MAX, AGENT_STANDARD, assertCostBudget, estimateCost } from "../util/cost.js";
import type { GlobalOpts } from "./types.js";

export interface RunOpts extends GlobalOpts {
  standard?: boolean;
  noWeb?: boolean;
  file?: string[];
  url?: string[];
  codeExec?: boolean;
  plan?: boolean;
  name?: string;
  confirmCost?: boolean;
  out?: string;
  format?: "md" | "json" | "html";
  timeout?: string;
  interval?: string;
  stream?: boolean;
  noThoughts?: boolean;
  toolCalls?: boolean;
}

export async function runCmd(query: string, opts: RunOpts): Promise<void> {
  const log = new Logger(opts);
  const cfg = await readConfig();
  const auth = await resolveAuth(cfg);
  const agent = opts.standard ? AGENT_STANDARD : AGENT_MAX;
  assertCostBudget({ agent, confirmCost: opts.confirmCost, costCeilingUsd: cfg.costCeilingUsd });
  warnIfVertexDeepResearch(log, auth);
  const client = makeClient(auth);
  const outDir = path.resolve(opts.out ?? "./research");
  const req: CreateJobRequest = {
    query,
    agent,
    files: opts.file?.map((p) => ({ path: p })),
    urls: opts.url,
    enableWeb: opts.noWeb !== true,
    enableUrlContext: Boolean(opts.url && opts.url.length > 0),
    enableCodeExec: opts.codeExec,
    collaborativePlanning: opts.plan,
  };
  const created = await client.create(req);
  await putJob({
    id: created.id,
    agent,
    query,
    label: opts.name,
    createdAt: Date.now(),
    state: created.status,
    costEstimateUsd: estimateCost(agent),
  });
  log.info(`job ${created.id} created${opts.stream ? " — streaming…" : " — polling…"}`);
  const timeoutMin = parseInt(opts.timeout ?? "30", 10);
  const intervalSec = parseInt(opts.interval ?? "15", 10);
  let final;
  if (opts.stream) {
    const state = newStreamState();
    let lastStatus = "in_progress";
    for await (const ev of client.stream(created.id)) {
      renderEvent(
        ev,
        { showThoughts: !opts.noThoughts, showToolCalls: opts.toolCalls, json: false },
        state,
      );
      if (ev.type === "interaction.status_update") {
        const s = ev.raw["status"] as string | undefined;
        if (s) lastStatus = s;
      }
    }
    await updateJob(created.id, { state: lastStatus as never, completedAt: Date.now() });
    final = await client.get(created.id);
  } else {
    const spinner = log.spinner(`polling ${created.id}`);
    try {
      final = await pollUntilDone(client, created.id, {
        timeoutMs: timeoutMin * 60_000,
        intervalMs: intervalSec * 1000,
        onUpdate: (j) => {
          if (spinner) spinner.text = `polling ${created.id} — status: ${j.status}`;
        },
      });
      spinner?.succeed(`job ${created.id} ${final.status}`);
    } catch (err) {
      spinner?.fail();
      throw err;
    }
  }
  const artifacts = await saveArtifacts(final, outDir, opts.format ?? "md");
  log.emit({
    id: final.id,
    state: final.status,
    out_dir: artifacts.outDir,
    report: artifacts.reportPath,
    report_chars: artifacts.reportChars,
    report_size_bytes: artifacts.reportSize,
    charts: artifacts.charts,
    images: artifacts.images,
    manifest: artifacts.manifestPath,
  });
}
