import { promises as fs } from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import type { ResolvedAuth } from "../store/config.js";
import { AGENT_MAX, AGENT_STANDARD, type AgentId } from "../util/cost.js";
import { AuthError, GdrError, QuotaError } from "../util/errors.js";
import { isRetryableHttpError, retry } from "../util/retry.js";
import {
  InteractionResponseSchema,
  type FileAttachment,
  type InteractionResponse,
} from "./types.js";

export interface CreateJobRequest {
  query: string;
  agent: AgentId;
  files?: FileAttachment[];
  urls?: string[];
  enableWeb?: boolean;
  enableUrlContext?: boolean;
  enableCodeExec?: boolean;
  collaborativePlanning?: boolean;
  thinkingSummaries?: boolean;
  visualization?: boolean;
  previousInteractionId?: string;
}

export interface StreamEvent {
  type:
    | "interaction.start"
    | "interaction.status_update"
    | "interaction.complete"
    | "content.start"
    | "content.delta"
    | "content.stop"
    | "error";
  raw: Record<string, unknown>;
}

export interface GdrClient {
  create(req: CreateJobRequest): Promise<InteractionResponse>;
  get(id: string): Promise<InteractionResponse>;
  cancel(id: string): Promise<InteractionResponse>;
  stream(id: string, lastEventId?: string): AsyncIterable<StreamEvent>;
}

const DRY_RUN_FIXTURE_DELAY_MS = 50;

class RealClient implements GdrClient {
  private readonly inner: GoogleGenAI;

  constructor(auth: ResolvedAuth) {
    if (auth.mode === "api-key") {
      this.inner = new GoogleGenAI({ apiKey: auth.apiKey });
    } else {
      this.inner = new GoogleGenAI({
        vertexai: true,
        project: auth.project,
        location: auth.location,
      });
    }
  }

  async create(req: CreateJobRequest): Promise<InteractionResponse> {
    const params = await buildCreateParams(req);
    const res = await retry(() => this.inner.interactions.create(params as never), {
      retries: 5,
      minTimeoutMs: 1000,
      maxTimeoutMs: 32_000,
      shouldRetry: isRetryableHttpError,
    }).catch(translateApiError);
    return InteractionResponseSchema.parse(res);
  }

  async get(id: string): Promise<InteractionResponse> {
    const res = await retry(() => this.inner.interactions.get(id), {
      retries: 3,
      minTimeoutMs: 500,
      shouldRetry: isRetryableHttpError,
    }).catch(translateApiError);
    return InteractionResponseSchema.parse(res);
  }

  async cancel(id: string): Promise<InteractionResponse> {
    const res = await this.inner.interactions.cancel(id).catch(translateApiError);
    return InteractionResponseSchema.parse(res);
  }

  async *stream(id: string, lastEventId?: string): AsyncIterable<StreamEvent> {
    const params = lastEventId
      ? { stream: true as const, last_event_id: lastEventId }
      : { stream: true as const };
    const sse = await this.inner.interactions.get(id, params).catch(translateApiError);
    for await (const chunk of sse as AsyncIterable<Record<string, unknown>>) {
      const event_type = String((chunk as { event_type?: string }).event_type ?? "");
      yield { type: event_type as StreamEvent["type"], raw: chunk };
    }
  }
}

class DryRunClient implements GdrClient {
  private readonly store = new Map<string, InteractionResponse>();
  private nextId = 1;

  async create(req: CreateJobRequest): Promise<InteractionResponse> {
    await sleepShort();
    const id = `dry-${Date.now()}-${this.nextId++}`;
    const now = new Date().toISOString();
    const job: InteractionResponse = {
      id,
      status: "in_progress",
      created: now,
      updated: now,
      agent: req.agent,
    };
    this.store.set(id, job);
    return job;
  }

  async get(id: string): Promise<InteractionResponse> {
    await sleepShort();
    const existing = this.store.get(id);
    if (!existing) {
      const now = new Date().toISOString();
      return {
        id,
        status: "completed",
        created: now,
        updated: now,
        outputs: [{ type: "text", text: dryRunReport(id) }],
      };
    }
    const completed: InteractionResponse = {
      ...existing,
      status: "completed",
      updated: new Date().toISOString(),
      outputs: [{ type: "text", text: dryRunReport(id) }],
    };
    this.store.set(id, completed);
    return completed;
  }

  async cancel(id: string): Promise<InteractionResponse> {
    await sleepShort();
    const now = new Date().toISOString();
    const cancelled: InteractionResponse = {
      id,
      status: "cancelled",
      created: now,
      updated: now,
    };
    this.store.set(id, cancelled);
    return cancelled;
  }

  async *stream(id: string): AsyncIterable<StreamEvent> {
    await sleepShort();
    yield { type: "interaction.start", raw: { event_type: "interaction.start", interaction: { id, status: "in_progress" } } };
    yield {
      type: "content.delta",
      raw: {
        event_type: "content.delta",
        index: 0,
        delta: { type: "thought_summary", content: { type: "text", text: "Considering the question and what sources to consult..." } },
      },
    };
    await sleepShort();
    yield {
      type: "content.delta",
      raw: {
        event_type: "content.delta",
        index: 0,
        delta: { type: "thought_summary", content: { type: "text", text: "Drafting an outline." } },
      },
    };
    yield {
      type: "content.delta",
      raw: {
        event_type: "content.delta",
        index: 1,
        delta: { type: "text", text: dryRunReport(id) },
      },
    };
    yield { type: "interaction.complete", raw: { event_type: "interaction.complete", interaction: { id, status: "completed" } } };
  }
}

function sleepShort(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, DRY_RUN_FIXTURE_DELAY_MS));
}

function dryRunReport(id: string): string {
  return [
    `# Dry-run report for ${id}`,
    "",
    "This response is generated locally because `GDR_DRY_RUN=1` is set.",
    "No real API call was made and no money was spent.",
    "",
    "Set the `GEMINI_API_KEY` environment variable and unset `GDR_DRY_RUN` to run for real.",
  ].join("\n");
}

export function isDryRunEnabled(): boolean {
  return process.env["GDR_DRY_RUN"] === "1";
}

export function makeClient(auth: ResolvedAuth | null): GdrClient {
  if (isDryRunEnabled()) return new DryRunClient();
  if (!auth) {
    throw new AuthError(
      "no auth configured. Either set GEMINI_API_KEY (Gemini Developer API) or GOOGLE_CLOUD_PROJECT + run `gcloud auth application-default login` (Vertex AI).",
    );
  }
  return new RealClient(auth);
}

async function buildCreateParams(req: CreateJobRequest): Promise<Record<string, unknown>> {
  const tools: Array<Record<string, unknown>> = [];
  if (req.enableWeb !== false) tools.push({ type: "google_search" });
  if (req.enableUrlContext || (req.urls && req.urls.length > 0)) tools.push({ type: "url_context" });
  if (req.enableCodeExec) tools.push({ type: "code_execution" });

  let input: unknown = req.query;
  const inputParts: Array<Record<string, unknown>> = [];
  if (req.query) inputParts.push({ type: "text", text: req.query });
  if (req.urls && req.urls.length > 0) {
    inputParts.push({
      type: "text",
      text: `Reference URLs:\n${req.urls.map((u) => `- ${u}`).join("\n")}`,
    });
  }
  if (req.files && req.files.length > 0) {
    for (const f of req.files) {
      inputParts.push(await loadFileAsContent(f));
    }
  }
  if (inputParts.length > 1) input = inputParts;

  return {
    agent: req.agent,
    input,
    background: true,
    store: true,
    ...(req.previousInteractionId ? { previous_interaction_id: req.previousInteractionId } : {}),
    agent_config: {
      type: "deep-research",
      collaborative_planning: req.collaborativePlanning ?? false,
      thinking_summaries: req.thinkingSummaries === false ? "none" : "auto",
      visualization: req.visualization === false ? "off" : "auto",
    },
    tools,
  };
}

async function loadFileAsContent(file: FileAttachment): Promise<Record<string, unknown>> {
  const ext = path.extname(file.path).toLowerCase();
  const mime = file.mimeType ?? guessMime(ext);
  const data = await fs.readFile(file.path);
  const base64 = data.toString("base64");
  if (mime.startsWith("image/")) return { type: "image", data: base64, mime_type: mime };
  if (mime.startsWith("audio/")) return { type: "audio", data: base64, mime_type: mime };
  if (mime.startsWith("video/")) return { type: "video", data: base64, mime_type: mime };
  return { type: "document", data: base64, mime_type: mime };
}

function guessMime(ext: string): string {
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".csv":
      return "text/csv";
    case ".txt":
    case ".md":
      return "text/plain";
    case ".json":
      return "application/json";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}

function translateApiError(err: unknown): never {
  const e = err as { status?: number; statusCode?: number; message?: string };
  const status = e.status ?? e.statusCode;
  const message = e.message ?? "API request failed";
  if (status === 401 || status === 403) throw new AuthError(message);
  if (status === 429) throw new QuotaError(message);
  throw new GdrError(message);
}

export { AGENT_MAX, AGENT_STANDARD };
