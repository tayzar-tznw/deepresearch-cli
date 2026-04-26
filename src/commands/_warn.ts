import type { ResolvedAuth } from "../store/config.js";
import type { Logger } from "../output/logger.js";

let warned = false;

/**
 * Deep Research and Deep Research Max launched on the Gemini Developer API on
 * 2026-04-21. Vertex AI / Google Cloud availability was announced as "coming
 * soon" but may not yet be live. Warn once per process if we're using Vertex.
 */
export function warnIfVertexDeepResearch(log: Logger, auth: ResolvedAuth | null): void {
  if (warned) return;
  if (auth?.mode !== "vertex") return;
  warned = true;
  log.warn(
    "using Vertex AI (project=" +
      auth.project +
      ", location=" +
      auth.location +
      "). Note: Deep Research Max on Vertex may still be rolling out. " +
      "If the API rejects the model, set GEMINI_API_KEY to use the Gemini Developer API instead.",
  );
}
