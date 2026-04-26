import { makeClient, type CreateJobRequest } from "../api/client.js";
import { getJob, putJob } from "../store/jobs.js";
import { readConfig, resolveAuth } from "../store/config.js";
import { Logger } from "../output/logger.js";
import { AGENT_MAX, assertCostBudget, estimateCost, formatUsd } from "../util/cost.js";
import { ValidationError } from "../util/errors.js";
import { warnIfVertexDeepResearch } from "./_warn.js";
import type { GlobalOpts } from "./types.js";

export interface RefineOpts extends GlobalOpts {
  approve?: boolean;
  name?: string;
  confirmCost?: boolean;
}

/**
 * Send a refinement / approval / follow-up to a prior interaction (typically one
 * that returned `status: requires_action` from collaborative planning, but works
 * for any completed interaction too — useful for follow-up questions on a finished
 * report). Creates a NEW interaction with previous_interaction_id linking back.
 */
export async function refineCmd(
  parentId: string,
  message: string | undefined,
  opts: RefineOpts,
): Promise<void> {
  const log = new Logger(opts);
  if (!opts.approve && (!message || message.trim() === "")) {
    throw new ValidationError(
      "provide a refinement message, or pass --approve to continue the plan as-is",
    );
  }
  const cfg = await readConfig();
  const auth = await resolveAuth(cfg);
  const parent = await getJob(parentId);
  const agent = parent?.agent ?? AGENT_MAX;
  assertCostBudget({
    agent,
    confirmCost: opts.confirmCost,
    costCeilingUsd: cfg.costCeilingUsd,
  });
  warnIfVertexDeepResearch(log, auth);
  const client = makeClient(auth);
  const input = opts.approve
    ? "Approved. Please proceed with the plan as-is."
    : (message ?? "").trim();
  const req: CreateJobRequest = {
    query: input,
    agent,
    enableWeb: true,
    previousInteractionId: parentId,
  };
  const spinner = log.spinner(`creating refinement of ${parentId}`);
  let res;
  try {
    res = await client.create(req);
  } catch (err) {
    spinner?.fail();
    throw err;
  }
  spinner?.succeed(`refinement ${res.id} created (parent: ${parentId})`);
  await putJob({
    id: res.id,
    agent,
    query: `[refines ${parentId}] ${input.slice(0, 100)}`,
    label: opts.name ?? (parent?.label ? `${parent.label}-refined` : undefined),
    createdAt: Date.now(),
    state: res.status,
    costEstimateUsd: estimateCost(agent),
  });
  log.emit({
    id: res.id,
    parent: parentId,
    state: res.status,
    agent,
    cost_estimate_usd: estimateCost(agent),
    cost_estimate: formatUsd(estimateCost(agent)),
    next: `gdr wait ${res.id}`,
  });
}
