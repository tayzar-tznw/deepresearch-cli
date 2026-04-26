import { ValidationError } from "./errors.js";

export const AGENT_MAX = "deep-research-max-preview-04-2026";
export const AGENT_STANDARD = "deep-research-preview-04-2026";

export type AgentId = typeof AGENT_MAX | typeof AGENT_STANDARD | (string & {});

export const COST_TABLE_USD: Record<string, number> = {
  [AGENT_MAX]: 4.8,
  [AGENT_STANDARD]: 1.22,
};

export function estimateCost(agent: AgentId): number {
  return COST_TABLE_USD[agent] ?? 0;
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export interface CostGuardOpts {
  agent: AgentId;
  confirmCost?: boolean;
  costCeilingUsd?: number;
}

/**
 * Refuses to proceed for Max-tier runs unless the caller has explicitly
 * acknowledged the cost via flag, env var, or a configured ceiling. Standard
 * tier is allowed without confirmation since it's ~$1.22/run.
 */
export function assertCostBudget(opts: CostGuardOpts): void {
  const estimated = estimateCost(opts.agent);
  if (estimated <= 0) return;
  if (opts.agent !== AGENT_MAX) return;
  if (opts.confirmCost) return;
  if (process.env["GDR_CONFIRM_COST"] === "1") return;
  if (opts.costCeilingUsd !== undefined && opts.costCeilingUsd >= estimated) return;
  throw new ValidationError(
    `Max-tier run will cost ~${formatUsd(estimated)}. Re-run with --confirm-cost, ` +
      `set GDR_CONFIRM_COST=1, or set costCeilingUsd >= ${formatUsd(estimated)} in ~/.config/gdr/config.json` +
      (opts.costCeilingUsd !== undefined ? ` (currently ${formatUsd(opts.costCeilingUsd)}).` : "."),
  );
}
