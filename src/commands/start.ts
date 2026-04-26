import { makeClient, type CreateJobRequest } from "../api/client.js";
import { putJob } from "../store/jobs.js";
import { readConfig, resolveAuth } from "../store/config.js";
import { Logger } from "../output/logger.js";
import { AGENT_MAX, AGENT_STANDARD, assertCostBudget, estimateCost, formatUsd } from "../util/cost.js";
import { planAutoStandard, warnIfVertexDeepResearch } from "./_warn.js";
import type { GlobalOpts } from "./types.js";

export interface StartOpts extends GlobalOpts {
  standard?: boolean;
  noWeb?: boolean;
  file?: string[];
  url?: string[];
  codeExec?: boolean;
  plan?: boolean;
  planTier?: "max" | "standard";
  name?: string;
  confirmCost?: boolean;
}

export async function startCmd(query: string, opts: StartOpts): Promise<void> {
  const log = new Logger(opts);
  const cfg = await readConfig();
  const auth = await resolveAuth(cfg);
  const intendedAgent = opts.standard ? AGENT_STANDARD : AGENT_MAX;

  // Workaround for the preview gap: Max ignores collaborative_planning. Route the
  // plan turn to Standard unless the user forces it via --plan-tier=max.
  const forcedPlanMax = opts.planTier === "max";
  const { agentForPlanTurn, switched } = forcedPlanMax
    ? { agentForPlanTurn: intendedAgent, switched: false }
    : planAutoStandard(log, intendedAgent, Boolean(opts.plan));
  const agent = agentForPlanTurn;

  assertCostBudget({
    agent,
    confirmCost: opts.confirmCost,
    costCeilingUsd: cfg.costCeilingUsd,
  });
  warnIfVertexDeepResearch(log, auth);
  const client = makeClient(auth);
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
  const spinner = log.spinner(`creating Deep Research job (${agent})`);
  let res;
  try {
    res = await client.create(req);
  } catch (err) {
    spinner?.fail();
    throw err;
  }
  spinner?.succeed(`job ${res.id} created`);
  await putJob({
    id: res.id,
    agent,
    intendedAgent: switched ? intendedAgent : undefined,
    query,
    label: opts.name,
    createdAt: Date.now(),
    state: res.status,
    costEstimateUsd: estimateCost(agent),
  });
  log.emit({
    id: res.id,
    state: res.status,
    agent,
    ...(switched ? { intended_agent: intendedAgent, plan_auto_standard: true } : {}),
    cost_estimate_usd: estimateCost(agent),
    cost_estimate: formatUsd(estimateCost(agent)),
    next: `gdr wait ${res.id}`,
  });
}
