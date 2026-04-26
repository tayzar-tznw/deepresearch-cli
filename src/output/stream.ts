import pc from "picocolors";
import type { StreamEvent } from "../api/client.js";
import { redact } from "../util/redact.js";

export interface StreamRenderOpts {
  showThoughts?: boolean;
  showToolCalls?: boolean;
  json?: boolean;
}

interface State {
  lastWasThought: boolean;
  lastWasText: boolean;
  textBuffer: string;
}

export function renderEvent(ev: StreamEvent, opts: StreamRenderOpts, state: State): void {
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(ev.raw)}\n`);
    return;
  }
  switch (ev.type) {
    case "interaction.start": {
      const id = (ev.raw["interaction"] as { id?: string } | undefined)?.id;
      if (id) process.stderr.write(`${pc.dim(`[stream open: ${id}]`)}\n`);
      return;
    }
    case "interaction.status_update": {
      const status = ev.raw["status"] as string | undefined;
      flushBoundary(state);
      if (status) process.stderr.write(`${pc.dim(`[status: ${status}]`)}\n`);
      return;
    }
    case "content.start": {
      const block = ev.raw["content"] as { type?: string } | undefined;
      if (block?.type === "thought_summary") {
        flushBoundary(state);
        process.stderr.write(pc.dim(pc.italic("[thinking] ")));
        state.lastWasThought = true;
      }
      return;
    }
    case "content.delta": {
      const delta = ev.raw["delta"] as Record<string, unknown> | undefined;
      const dtype = delta?.["type"] as string | undefined;
      if (dtype === "thought_summary" && opts.showThoughts !== false) {
        const inner = delta?.["content"] as { text?: string; type?: string } | undefined;
        const text = typeof inner?.["text"] === "string" ? inner["text"] : "";
        if (!text) return;
        if (!state.lastWasThought) {
          flushBoundary(state);
          process.stderr.write(pc.dim(pc.italic("[thinking] ")));
        }
        process.stderr.write(pc.dim(pc.italic(redact(text))));
        state.lastWasThought = true;
        state.lastWasText = false;
        return;
      }
      if (dtype === "text") {
        const text = typeof delta?.["text"] === "string" ? (delta?.["text"] as string) : "";
        if (!text) return;
        if (state.lastWasThought) {
          process.stderr.write("\n");
          state.lastWasThought = false;
        }
        process.stdout.write(redact(text));
        state.lastWasText = true;
        state.textBuffer += text;
        return;
      }
      if (dtype === "image") {
        flushBoundary(state);
        process.stderr.write(`${pc.dim("[image chunk received]")}\n`);
        return;
      }
      if (opts.showToolCalls && dtype) {
        const summary = summarizeToolDelta(dtype, delta);
        if (summary) {
          flushBoundary(state);
          process.stderr.write(`${pc.cyan("[tool] ")}${pc.dim(summary)}\n`);
        }
      }
      return;
    }
    case "content.stop": {
      flushBoundary(state);
      return;
    }
    case "interaction.complete": {
      flushBoundary(state);
      const status = (ev.raw["interaction"] as { status?: string } | undefined)?.status ?? "completed";
      process.stderr.write(`${pc.green(`[done: ${status}]`)}\n`);
      return;
    }
    case "error": {
      flushBoundary(state);
      const msg =
        (ev.raw["error"] as { message?: string } | undefined)?.message ??
        (ev.raw["message"] as string | undefined) ??
        "stream error";
      process.stderr.write(`${pc.red(`[error] ${msg}`)}\n`);
      return;
    }
    default:
      return;
  }
}

function flushBoundary(state: State): void {
  if (state.lastWasThought) {
    process.stderr.write("\n");
    state.lastWasThought = false;
  }
  if (state.lastWasText) {
    process.stdout.write("\n");
    state.lastWasText = false;
  }
}

function summarizeToolDelta(type: string, delta: Record<string, unknown> | undefined): string | null {
  switch (type) {
    case "google_search_call":
    case "url_context_call":
    case "file_search_call":
    case "code_execution_call":
    case "function_call":
    case "mcp_server_tool_call":
    case "google_maps_call": {
      const arg = (delta?.["arguments"] as Record<string, unknown> | undefined) ?? {};
      const queryCandidate = arg["query"] ?? arg["url"] ?? arg["name"];
      const label = type.replace(/_call$/, "").replace(/_/g, " ");
      return queryCandidate ? `${label}: ${String(queryCandidate)}` : label;
    }
    case "google_search_result":
    case "url_context_result":
    case "file_search_result":
    case "code_execution_result":
    case "function_result":
    case "mcp_server_tool_result":
    case "google_maps_result":
      return null;
    default:
      return null;
  }
}

export function newStreamState(): State {
  return { lastWasThought: false, lastWasText: false, textBuffer: "" };
}
