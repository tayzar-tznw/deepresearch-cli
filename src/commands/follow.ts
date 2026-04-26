import { makeClient } from "../api/client.js";
import { resolveAuth } from "../store/config.js";
import { Logger } from "../output/logger.js";
import { newStreamState, renderEvent } from "../output/stream.js";
import { warnIfVertexDeepResearch } from "./_warn.js";
import type { GlobalOpts } from "./types.js";

export interface FollowOpts extends GlobalOpts {
  noThoughts?: boolean;
  toolCalls?: boolean;
  resumeFrom?: string;
}

/**
 * Stream Gemini's thinking + content for an in-progress (or already-finished)
 * Deep Research job. Uses real SSE via the SDK's get(id, { stream: true }).
 *   - thought_summary deltas → dim/italic on stderr
 *   - text deltas             → normal on stdout
 *   - tool calls              → cyan on stderr (with --tool-calls)
 */
export async function followCmd(id: string, opts: FollowOpts): Promise<void> {
  const log = new Logger(opts);
  const auth = await resolveAuth();
  warnIfVertexDeepResearch(log, auth);
  const client = makeClient(auth);
  const state = newStreamState();
  for await (const ev of client.stream(id, opts.resumeFrom)) {
    renderEvent(ev, { showThoughts: !opts.noThoughts, showToolCalls: opts.toolCalls, json: opts.json }, state);
  }
}
