import type { ResolvedAuth } from "../store/config.js";
import type { Logger } from "../output/logger.js";
import { AGENT_MAX, AGENT_STANDARD } from "../util/cost.js";

let warnedVertex = false;
let warnedPlanAutoStandard = false;

/**
 * Deep Research and Deep Research Max launched on the Gemini Developer API on
 * 2026-04-21. Vertex AI / Google Cloud availability was announced as "coming
 * soon" but may not yet be live. Warn once per process if we're using Vertex.
 */
export function warnIfVertexDeepResearch(log: Logger, auth: ResolvedAuth | null): void {
  if (warnedVertex) return;
  if (auth?.mode !== "vertex") return;
  warnedVertex = true;
  log.warn(
    "using Vertex AI (project=" +
      auth.project +
      ", location=" +
      auth.location +
      "). Note: Deep Research Max on Vertex may still be rolling out. " +
      "If the API rejects the model, set GEMINI_API_KEY to use the Gemini Developer API instead.",
  );
}

/**
 * As of 2026-04-26, Deep Research **Max** accepts but silently ignores
 * `collaborative_planning: true` — the agent runs a full report (~5-15 min, ~$4.80)
 * instead of returning a plan. Only the Standard tier honors the flag (~30s, ~$0.30).
 *
 * When the user passes `--plan` with the default Max tier, transparently route the
 * PLAN turn to Standard. The user's intended tier (Max) is preserved on the JobRecord
 * so `gdr refine` runs the actual research on the right tier.
 */
export function planAutoStandard(log: Logger, requestedAgent: string, planEnabled: boolean): {
  agentForPlanTurn: string;
  switched: boolean;
} {
  if (!planEnabled) return { agentForPlanTurn: requestedAgent, switched: false };
  if (requestedAgent !== AGENT_MAX) return { agentForPlanTurn: requestedAgent, switched: false };
  if (!warnedPlanAutoStandard) {
    warnedPlanAutoStandard = true;
    log.warn(
      "--plan: routing the plan turn to Standard tier — Deep Research Max ignores " +
        "collaborative_planning in the current preview (2026-04-26). The actual research " +
        "run after `gdr refine` will use Max as you intended. Pass --plan-tier=max to override.",
    );
  }
  return { agentForPlanTurn: AGENT_STANDARD, switched: true };
}
