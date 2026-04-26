#!/usr/bin/env node

// src/cli.ts
import { Command, Option } from "commander";
import pc3 from "picocolors";

// src/api/client.ts
import { promises as fs } from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";

// src/util/errors.ts
var ExitCode = {
  Ok: 0,
  Generic: 1,
  Auth: 2,
  Quota: 3,
  Validation: 4,
  PollTimeout: 5,
  JobFailed: 6,
  DoctorFailed: 7
};
var GdrError = class extends Error {
  exitCode;
  constructor(message, exitCode = ExitCode.Generic) {
    super(message);
    this.name = "GdrError";
    this.exitCode = exitCode;
  }
};
var AuthError = class extends GdrError {
  constructor(message = "missing or invalid API key \u2014 run `gdr auth` or set GEMINI_API_KEY") {
    super(message, ExitCode.Auth);
    this.name = "AuthError";
  }
};
var QuotaError = class extends GdrError {
  constructor(message = "rate limit or quota exceeded") {
    super(message, ExitCode.Quota);
    this.name = "QuotaError";
  }
};
var ValidationError = class extends GdrError {
  constructor(message) {
    super(message, ExitCode.Validation);
    this.name = "ValidationError";
  }
};
var TimeoutError = class extends GdrError {
  jobId;
  constructor(jobId) {
    super(`poll timed out for job ${jobId} \u2014 re-run \`gdr wait ${jobId}\` to resume`, ExitCode.PollTimeout);
    this.name = "TimeoutError";
    this.jobId = jobId;
  }
};
var JobFailedError = class extends GdrError {
  jobId;
  status;
  constructor(jobId, status, detail) {
    super(`job ${jobId} ended in state \`${status}\`${detail ? `: ${detail}` : ""}`, ExitCode.JobFailed);
    this.name = "JobFailedError";
    this.jobId = jobId;
    this.status = status;
  }
};

// src/util/cost.ts
var AGENT_MAX = "deep-research-max-preview-04-2026";
var AGENT_STANDARD = "deep-research-preview-04-2026";
var COST_TABLE_USD = {
  [AGENT_MAX]: 4.8,
  [AGENT_STANDARD]: 1.22
};
function estimateCost(agent) {
  return COST_TABLE_USD[agent] ?? 0;
}
function formatUsd(amount) {
  return `$${amount.toFixed(2)}`;
}
function assertCostBudget(opts) {
  const estimated = estimateCost(opts.agent);
  if (estimated <= 0) return;
  if (opts.agent !== AGENT_MAX) return;
  if (opts.confirmCost) return;
  if (process.env["GDR_CONFIRM_COST"] === "1") return;
  if (opts.costCeilingUsd !== void 0 && opts.costCeilingUsd >= estimated) return;
  throw new ValidationError(
    `Max-tier run will cost ~${formatUsd(estimated)}. Re-run with --confirm-cost, set GDR_CONFIRM_COST=1, or set costCeilingUsd >= ${formatUsd(estimated)} in ~/.config/gdr/config.json` + (opts.costCeilingUsd !== void 0 ? ` (currently ${formatUsd(opts.costCeilingUsd)}).` : ".")
  );
}

// src/util/retry.ts
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function retry(fn, opts = {}) {
  const retries = opts.retries ?? 5;
  const factor = opts.factor ?? 2;
  const minMs = opts.minTimeoutMs ?? 1e3;
  const maxMs = opts.maxTimeoutMs ?? 32e3;
  let attempt = 0;
  let lastErr;
  while (attempt <= retries) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (opts.shouldRetry && !opts.shouldRetry(err)) throw err;
      if (attempt === retries) break;
      const delay = Math.min(minMs * Math.pow(factor, attempt), maxMs);
      opts.onRetry?.(err, attempt + 1, delay);
      await sleep(delay);
      attempt++;
    }
  }
  throw lastErr;
}
function isRetryableHttpError(err) {
  const e = err;
  const status = e.status ?? e.statusCode;
  if (typeof status === "number") {
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
    return false;
  }
  if (e.code && /ECONN|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|UND_ERR/.test(e.code)) return true;
  return false;
}

// src/api/types.ts
import { z } from "zod";
var StatusSchema = z.enum([
  "in_progress",
  "requires_action",
  "completed",
  "failed",
  "cancelled",
  "incomplete"
]);
var TextContentSchema = z.object({
  type: z.literal("text"),
  text: z.string()
});
var ImageContentSchema = z.object({
  type: z.literal("image"),
  data: z.string().optional(),
  uri: z.string().optional(),
  mime_type: z.string().optional()
});
var DocumentContentSchema = z.object({
  type: z.literal("document"),
  data: z.string().optional(),
  uri: z.string().optional(),
  mime_type: z.string().optional()
});
var ThoughtContentSchema = z.object({
  type: z.literal("thought"),
  text: z.string().optional()
});
var OutputContentSchema = z.union([
  TextContentSchema,
  ImageContentSchema,
  DocumentContentSchema,
  ThoughtContentSchema,
  z.object({ type: z.string() }).passthrough()
]);
var InteractionResponseSchema = z.object({
  id: z.string(),
  status: StatusSchema,
  created: z.string().optional(),
  updated: z.string().optional(),
  agent: z.string().optional(),
  outputs: z.array(OutputContentSchema).optional(),
  error: z.object({ message: z.string().optional(), code: z.string().optional() }).passthrough().optional()
}).passthrough();
function extractText(outputs) {
  if (!outputs || outputs.length === 0) return "";
  const texts = [];
  for (const out of outputs) {
    if (out.type === "text" && "text" in out && typeof out.text === "string") texts.push(out.text);
  }
  return texts.join("\n\n");
}

// src/api/client.ts
var DRY_RUN_FIXTURE_DELAY_MS = 50;
var RealClient = class {
  inner;
  constructor(auth2) {
    if (auth2.mode === "api-key") {
      this.inner = new GoogleGenAI({ apiKey: auth2.apiKey });
    } else {
      this.inner = new GoogleGenAI({
        vertexai: true,
        project: auth2.project,
        location: auth2.location
      });
    }
  }
  async create(req) {
    const params = await buildCreateParams(req);
    const res = await retry(() => this.inner.interactions.create(params), {
      retries: 5,
      minTimeoutMs: 1e3,
      maxTimeoutMs: 32e3,
      shouldRetry: isRetryableHttpError
    }).catch(translateApiError);
    return InteractionResponseSchema.parse(res);
  }
  async get(id) {
    const res = await retry(() => this.inner.interactions.get(id), {
      retries: 3,
      minTimeoutMs: 500,
      shouldRetry: isRetryableHttpError
    }).catch(translateApiError);
    return InteractionResponseSchema.parse(res);
  }
  async cancel(id) {
    const res = await this.inner.interactions.cancel(id).catch(translateApiError);
    return InteractionResponseSchema.parse(res);
  }
  async *stream(id, lastEventId) {
    const params = lastEventId ? { stream: true, last_event_id: lastEventId } : { stream: true };
    const sse = await this.inner.interactions.get(id, params).catch(translateApiError);
    for await (const chunk of sse) {
      const event_type = String(chunk.event_type ?? "");
      yield { type: event_type, raw: chunk };
    }
  }
};
var DryRunClient = class {
  store = /* @__PURE__ */ new Map();
  nextId = 1;
  async create(req) {
    await sleepShort();
    const id = `dry-${Date.now()}-${this.nextId++}`;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const job = {
      id,
      status: "in_progress",
      created: now,
      updated: now,
      agent: req.agent
    };
    this.store.set(id, job);
    return job;
  }
  async get(id) {
    await sleepShort();
    const existing = this.store.get(id);
    if (!existing) {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      return {
        id,
        status: "completed",
        created: now,
        updated: now,
        outputs: [{ type: "text", text: dryRunReport(id) }]
      };
    }
    const completed = {
      ...existing,
      status: "completed",
      updated: (/* @__PURE__ */ new Date()).toISOString(),
      outputs: [{ type: "text", text: dryRunReport(id) }]
    };
    this.store.set(id, completed);
    return completed;
  }
  async cancel(id) {
    await sleepShort();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const cancelled = {
      id,
      status: "cancelled",
      created: now,
      updated: now
    };
    this.store.set(id, cancelled);
    return cancelled;
  }
  async *stream(id) {
    await sleepShort();
    yield { type: "interaction.start", raw: { event_type: "interaction.start", interaction: { id, status: "in_progress" } } };
    yield {
      type: "content.delta",
      raw: {
        event_type: "content.delta",
        index: 0,
        delta: { type: "thought_summary", content: { type: "text", text: "Considering the question and what sources to consult..." } }
      }
    };
    await sleepShort();
    yield {
      type: "content.delta",
      raw: {
        event_type: "content.delta",
        index: 0,
        delta: { type: "thought_summary", content: { type: "text", text: "Drafting an outline." } }
      }
    };
    yield {
      type: "content.delta",
      raw: {
        event_type: "content.delta",
        index: 1,
        delta: { type: "text", text: dryRunReport(id) }
      }
    };
    yield { type: "interaction.complete", raw: { event_type: "interaction.complete", interaction: { id, status: "completed" } } };
  }
};
function sleepShort() {
  return new Promise((resolve) => setTimeout(resolve, DRY_RUN_FIXTURE_DELAY_MS));
}
function dryRunReport(id) {
  return [
    `# Dry-run report for ${id}`,
    "",
    "This response is generated locally because `GDR_DRY_RUN=1` is set.",
    "No real API call was made and no money was spent.",
    "",
    "Set the `GEMINI_API_KEY` environment variable and unset `GDR_DRY_RUN` to run for real."
  ].join("\n");
}
function isDryRunEnabled() {
  return process.env["GDR_DRY_RUN"] === "1";
}
function makeClient(auth2) {
  if (isDryRunEnabled()) return new DryRunClient();
  if (!auth2) {
    throw new AuthError(
      "no auth configured. Either set GEMINI_API_KEY (Gemini Developer API) or GOOGLE_CLOUD_PROJECT + run `gcloud auth application-default login` (Vertex AI)."
    );
  }
  return new RealClient(auth2);
}
async function buildCreateParams(req) {
  const tools = [];
  if (req.enableWeb !== false) tools.push({ type: "google_search" });
  if (req.enableUrlContext || req.urls && req.urls.length > 0) tools.push({ type: "url_context" });
  if (req.enableCodeExec) tools.push({ type: "code_execution" });
  let input2 = req.query;
  const inputParts = [];
  if (req.query) inputParts.push({ type: "text", text: req.query });
  if (req.urls && req.urls.length > 0) {
    inputParts.push({
      type: "text",
      text: `Reference URLs:
${req.urls.map((u) => `- ${u}`).join("\n")}`
    });
  }
  if (req.files && req.files.length > 0) {
    for (const f of req.files) {
      inputParts.push(await loadFileAsContent(f));
    }
  }
  if (inputParts.length > 1) input2 = inputParts;
  return {
    agent: req.agent,
    input: input2,
    background: true,
    store: true,
    ...req.previousInteractionId ? { previous_interaction_id: req.previousInteractionId } : {},
    agent_config: {
      type: "deep-research",
      collaborative_planning: req.collaborativePlanning ?? false,
      thinking_summaries: req.thinkingSummaries === false ? "none" : "auto",
      visualization: req.visualization === false ? "off" : "auto"
    },
    tools
  };
}
async function loadFileAsContent(file) {
  const ext = path.extname(file.path).toLowerCase();
  const mime = file.mimeType ?? guessMime(ext);
  const data = await fs.readFile(file.path);
  const base64 = data.toString("base64");
  if (mime.startsWith("image/")) return { type: "image", data: base64, mime_type: mime };
  if (mime.startsWith("audio/")) return { type: "audio", data: base64, mime_type: mime };
  if (mime.startsWith("video/")) return { type: "video", data: base64, mime_type: mime };
  return { type: "document", data: base64, mime_type: mime };
}
function guessMime(ext) {
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
function translateApiError(err) {
  const e = err;
  const status = e.status ?? e.statusCode;
  const message = e.message ?? "API request failed";
  if (status === 401 || status === 403) throw new AuthError(message);
  if (status === 429) throw new QuotaError(message);
  throw new GdrError(message);
}

// src/store/jobs.ts
import { promises as fs2 } from "fs";
import { dirname } from "path";
import lockfile from "proper-lockfile";

// src/store/paths.ts
import { homedir } from "os";
import { join } from "path";
function configHome() {
  const xdg = process.env["XDG_CONFIG_HOME"];
  return xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
}
function gdrConfigDir() {
  return join(configHome(), "gdr");
}
function configFilePath() {
  return join(gdrConfigDir(), "config.json");
}
function jobsFilePath() {
  return join(gdrConfigDir(), "jobs.json");
}
function claudeSkillsDir() {
  return join(homedir(), ".claude", "skills");
}

// src/store/jobs.ts
var EMPTY = { version: 1, jobs: {} };
async function ensureFile(path7) {
  await fs2.mkdir(dirname(path7), { recursive: true, mode: 448 });
  try {
    await fs2.access(path7);
  } catch {
    await fs2.writeFile(path7, JSON.stringify(EMPTY, null, 2), { mode: 384 });
  }
}
async function readJobsFile(path7) {
  try {
    const raw = await fs2.readFile(path7, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "jobs" in parsed) return parsed;
    return { ...EMPTY };
  } catch (err) {
    if (err.code === "ENOENT") return { ...EMPTY };
    throw err;
  }
}
async function writeJobsFile(path7, data) {
  const tmp = `${path7}.tmp`;
  await fs2.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 384 });
  await fs2.rename(tmp, path7);
}
async function withLock(path7, fn) {
  await ensureFile(path7);
  const release = await lockfile.lock(path7, {
    retries: { retries: 10, minTimeout: 50, maxTimeout: 500, factor: 2 },
    stale: 1e4
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}
async function putJob(job, path7 = jobsFilePath()) {
  await withLock(path7, async () => {
    const data = await readJobsFile(path7);
    data.jobs[job.id] = job;
    await writeJobsFile(path7, data);
  });
}
async function updateJob(id, patch, path7 = jobsFilePath()) {
  return withLock(path7, async () => {
    const data = await readJobsFile(path7);
    const existing = data.jobs[id];
    if (!existing) return null;
    const merged = { ...existing, ...patch };
    data.jobs[id] = merged;
    await writeJobsFile(path7, data);
    return merged;
  });
}
async function getJob(id, path7 = jobsFilePath()) {
  const data = await readJobsFile(path7);
  return data.jobs[id] ?? null;
}
async function listJobs(path7 = jobsFilePath()) {
  const data = await readJobsFile(path7);
  return Object.values(data.jobs).sort((a, b) => b.createdAt - a.createdAt);
}
async function monthlyCostUsd(path7 = jobsFilePath()) {
  const all = await listJobs(path7);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1e3;
  return all.filter((j) => j.createdAt >= cutoff).reduce((sum, j) => sum + (j.costEstimateUsd ?? 0), 0);
}

// src/store/config.ts
import { promises as fs3 } from "fs";
import { dirname as dirname2 } from "path";
var EMPTY2 = {};
async function readConfig(path7 = configFilePath()) {
  try {
    const raw = await fs3.readFile(path7, "utf8");
    const parsed = JSON.parse(raw);
    return { ...EMPTY2, ...parsed };
  } catch (err) {
    if (err.code === "ENOENT") return { ...EMPTY2 };
    throw err;
  }
}
async function writeConfig(cfg, path7 = configFilePath()) {
  await fs3.mkdir(dirname2(path7), { recursive: true, mode: 448 });
  const tmp = `${path7}.tmp`;
  await fs3.writeFile(tmp, JSON.stringify(cfg, null, 2), { mode: 384 });
  await fs3.rename(tmp, path7);
  try {
    await fs3.chmod(gdrConfigDir(), 448);
  } catch {
  }
}
async function resolveAuth(cfg) {
  const c = cfg ?? await readConfig();
  const envKey = process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_API_KEY"];
  if (envKey && envKey.length > 0) return { mode: "api-key", apiKey: envKey, source: "env" };
  if (c.apiKey && c.apiKey.length > 0) return { mode: "api-key", apiKey: c.apiKey, source: "config" };
  const envProject = process.env["GOOGLE_CLOUD_PROJECT"];
  const cfgProject = c.vertexProject;
  const project = envProject && envProject.length > 0 ? envProject : cfgProject;
  if (project) {
    const location = process.env["GOOGLE_CLOUD_LOCATION"] ?? process.env["GOOGLE_CLOUD_REGION"] ?? c.vertexLocation ?? "global";
    return {
      mode: "vertex",
      project,
      location,
      projectSource: envProject && envProject.length > 0 ? "env" : "config"
    };
  }
  return null;
}

// src/output/logger.ts
import pc from "picocolors";
import ora from "ora";

// src/util/redact.ts
var API_KEY_RE = /AIza[0-9A-Za-z_-]{35}/g;
var BEARER_RE = /Bearer\s+[A-Za-z0-9._-]{20,}/gi;
function redact(input2) {
  return input2.replace(API_KEY_RE, "AIza***REDACTED***").replace(BEARER_RE, "Bearer ***REDACTED***");
}

// src/output/logger.ts
var Logger = class {
  opts;
  constructor(opts = {}) {
    this.opts = opts;
    if (opts.noColor) {
      process.env["FORCE_COLOR"] = "0";
      process.env["NO_COLOR"] = "1";
    }
  }
  get isJson() {
    return Boolean(this.opts.json);
  }
  info(msg) {
    if (this.opts.quiet || this.opts.json) return;
    process.stderr.write(`${redact(msg)}
`);
  }
  warn(msg) {
    if (this.opts.json) return;
    process.stderr.write(`${pc.yellow("warn")} ${redact(msg)}
`);
  }
  error(msg) {
    if (this.opts.json) {
      process.stdout.write(`${JSON.stringify({ error: redact(msg) })}
`);
      return;
    }
    process.stderr.write(`${pc.red("error")} ${redact(msg)}
`);
  }
  success(msg) {
    if (this.opts.quiet || this.opts.json) return;
    process.stderr.write(`${pc.green("ok")} ${redact(msg)}
`);
  }
  emit(payload) {
    if (this.opts.json) {
      process.stdout.write(`${JSON.stringify(payload)}
`);
      return;
    }
    if (this.opts.quiet) return;
    process.stdout.write(`${redact(stringifyHuman(payload))}
`);
  }
  spinner(text) {
    if (this.opts.json || this.opts.quiet || !process.stderr.isTTY) return null;
    return ora({ text, stream: process.stderr }).start();
  }
  dim(text) {
    return pc.dim(text);
  }
  bold(text) {
    return pc.bold(text);
  }
};
function stringifyHuman(payload) {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object") {
    const lines = [];
    for (const [k, v] of Object.entries(payload)) {
      lines.push(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
    }
    return lines.join("\n");
  }
  return String(payload);
}

// src/commands/_warn.ts
var warned = false;
function warnIfVertexDeepResearch(log, auth2) {
  if (warned) return;
  if (auth2?.mode !== "vertex") return;
  warned = true;
  log.warn(
    "using Vertex AI (project=" + auth2.project + ", location=" + auth2.location + "). Note: Deep Research Max on Vertex may still be rolling out. If the API rejects the model, set GEMINI_API_KEY to use the Gemini Developer API instead."
  );
}

// src/commands/start.ts
async function startCmd(query, opts) {
  const log = new Logger(opts);
  const cfg = await readConfig();
  const auth2 = await resolveAuth(cfg);
  const agent = opts.standard ? AGENT_STANDARD : AGENT_MAX;
  assertCostBudget({
    agent,
    confirmCost: opts.confirmCost,
    costCeilingUsd: cfg.costCeilingUsd
  });
  warnIfVertexDeepResearch(log, auth2);
  const client = makeClient(auth2);
  const req = {
    query,
    agent,
    files: opts.file?.map((p) => ({ path: p })),
    urls: opts.url,
    enableWeb: opts.noWeb !== true,
    enableUrlContext: Boolean(opts.url && opts.url.length > 0),
    enableCodeExec: opts.codeExec,
    collaborativePlanning: opts.plan
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
    query,
    label: opts.name,
    createdAt: Date.now(),
    state: res.status,
    costEstimateUsd: estimateCost(agent)
  });
  log.emit({
    id: res.id,
    state: res.status,
    agent,
    cost_estimate_usd: estimateCost(agent),
    cost_estimate: formatUsd(estimateCost(agent)),
    next: `gdr wait ${res.id}`
  });
}

// src/api/poll.ts
var TERMINAL = ["completed", "failed", "cancelled", "incomplete"];
async function pollUntilDone(client, id, opts) {
  const deadline = Date.now() + opts.timeoutMs;
  let interval = opts.intervalMs ?? 15e3;
  const maxInterval = opts.maxIntervalMs ?? 6e4;
  while (Date.now() < deadline) {
    const job = await client.get(id);
    await updateJob(id, {
      state: job.status,
      lastSeenAt: Date.now(),
      ...TERMINAL.includes(job.status) ? { completedAt: Date.now() } : {},
      ...job.status === "failed" && job.error?.message ? { errorMessage: job.error.message } : {}
    });
    opts.onUpdate?.(job);
    if (job.status === "completed") return job;
    if (job.status === "requires_action") return job;
    if (job.status === "failed") {
      throw new JobFailedError(id, job.status, job.error?.message);
    }
    if (job.status === "cancelled" || job.status === "incomplete") {
      throw new JobFailedError(id, job.status);
    }
    await sleep(interval);
    interval = Math.min(Math.floor(interval * 1.4), maxInterval);
  }
  throw new TimeoutError(id);
}

// src/commands/wait.ts
async function waitCmd(id, opts) {
  const log = new Logger(opts);
  const auth2 = await resolveAuth();
  warnIfVertexDeepResearch(log, auth2);
  const client = makeClient(auth2);
  const timeoutMin = parseInt(opts.timeout ?? "60", 10);
  const intervalSec = parseInt(opts.interval ?? "15", 10);
  const spinner = log.spinner(`polling ${id} (every ${intervalSec}s, timeout ${timeoutMin}m)`);
  try {
    const job = await pollUntilDone(client, id, {
      timeoutMs: timeoutMin * 6e4,
      intervalMs: intervalSec * 1e3,
      onUpdate: (j) => {
        if (spinner) spinner.text = `polling ${id} \u2014 status: ${j.status}`;
      }
    });
    spinner?.succeed(`job ${id} ${job.status}`);
    const next = job.status === "requires_action" ? `gdr fetch ${job.id} --out ./plans  # review the proposed plan, then: gdr refine ${job.id} "<feedback>"  (or --approve)` : `gdr fetch ${job.id} --out ./research`;
    log.emit({ id: job.id, state: job.status, next });
  } catch (err) {
    spinner?.fail();
    throw err;
  }
}

// src/commands/run.ts
import path3 from "path";

// src/output/artifacts.ts
import { promises as fs4 } from "fs";
import path2 from "path";
async function saveArtifacts(job, outDir, format = "md") {
  await fs4.mkdir(outDir, { recursive: true });
  const charts = [];
  const images = [];
  let chartIndex = 0;
  let imageIndex = 0;
  for (const out of job.outputs ?? []) {
    if (out.type === "image") {
      const filename = await writeImage(out, outDir, imageIndex++);
      if (filename) images.push(filename);
      continue;
    }
    if (looksLikeChartHtml(out)) {
      const filename = await writeChart(out, outDir, chartIndex++);
      if (filename) charts.push(filename);
    }
  }
  let reportPath;
  let reportSize = 0;
  let reportChars = 0;
  const text = redact(extractText(job.outputs));
  if (text.length > 0) {
    const ext = format === "json" ? "json" : format === "html" ? "html" : "md";
    reportPath = path2.join(outDir, `report.${ext}`);
    const body = format === "json" ? JSON.stringify({ id: job.id, status: job.status, outputs: job.outputs }, null, 2) : format === "html" ? `<!doctype html><meta charset="utf-8"><title>${escapeHtml(job.id)}</title><pre>${escapeHtml(text)}</pre>` : text;
    await fs4.writeFile(reportPath, body);
    const stat = await fs4.stat(reportPath);
    reportSize = stat.size;
    reportChars = body.length;
  }
  const manifestPath = path2.join(outDir, "outputs.json");
  await fs4.writeFile(
    manifestPath,
    JSON.stringify(
      {
        id: job.id,
        status: job.status,
        agent: job.agent,
        report: reportPath ? path2.basename(reportPath) : null,
        charts,
        images
      },
      null,
      2
    )
  );
  return { outDir, reportPath, manifestPath, charts, images, reportSize, reportChars };
}
function looksLikeChartHtml(out) {
  if (out.type === "html") return true;
  const anyOut = out;
  if (typeof anyOut["html"] === "string") return true;
  if (out.type === "text" && "text" in out && typeof out.text === "string") {
    const t = out.text;
    if (t.startsWith("<!doctype") || t.startsWith("<html") || t.startsWith("<svg")) return true;
  }
  return false;
}
async function writeChart(out, outDir, index) {
  const anyOut = out;
  const html = anyOut["html"] ?? anyOut["text"];
  if (!html) return null;
  const filename = `chart-${index}.html`;
  await fs4.writeFile(path2.join(outDir, filename), html);
  return filename;
}
async function writeImage(out, outDir, index) {
  const anyOut = out;
  const data = anyOut["data"];
  if (!data) return null;
  const mime = anyOut["mime_type"] ?? "image/png";
  const ext = mime.split("/")[1] ?? "png";
  const filename = `image-${index}.${ext}`;
  await fs4.writeFile(path2.join(outDir, filename), Buffer.from(data, "base64"));
  return filename;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

// src/output/stream.ts
import pc2 from "picocolors";
function renderEvent(ev, opts, state) {
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(ev.raw)}
`);
    return;
  }
  switch (ev.type) {
    case "interaction.start": {
      const id = ev.raw["interaction"]?.id;
      if (id) process.stderr.write(`${pc2.dim(`[stream open: ${id}]`)}
`);
      return;
    }
    case "interaction.status_update": {
      const status = ev.raw["status"];
      flushBoundary(state);
      if (status) process.stderr.write(`${pc2.dim(`[status: ${status}]`)}
`);
      return;
    }
    case "content.start": {
      const block = ev.raw["content"];
      if (block?.type === "thought_summary") {
        flushBoundary(state);
        process.stderr.write(pc2.dim(pc2.italic("[thinking] ")));
        state.lastWasThought = true;
      }
      return;
    }
    case "content.delta": {
      const delta = ev.raw["delta"];
      const dtype = delta?.["type"];
      if (dtype === "thought_summary" && opts.showThoughts !== false) {
        const inner = delta?.["content"];
        const text = typeof inner?.["text"] === "string" ? inner["text"] : "";
        if (!text) return;
        if (!state.lastWasThought) {
          flushBoundary(state);
          process.stderr.write(pc2.dim(pc2.italic("[thinking] ")));
        }
        process.stderr.write(pc2.dim(pc2.italic(redact(text))));
        state.lastWasThought = true;
        state.lastWasText = false;
        return;
      }
      if (dtype === "text") {
        const text = typeof delta?.["text"] === "string" ? delta?.["text"] : "";
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
        process.stderr.write(`${pc2.dim("[image chunk received]")}
`);
        return;
      }
      if (opts.showToolCalls && dtype) {
        const summary = summarizeToolDelta(dtype, delta);
        if (summary) {
          flushBoundary(state);
          process.stderr.write(`${pc2.cyan("[tool] ")}${pc2.dim(summary)}
`);
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
      const status = ev.raw["interaction"]?.status ?? "completed";
      process.stderr.write(`${pc2.green(`[done: ${status}]`)}
`);
      return;
    }
    case "error": {
      flushBoundary(state);
      const msg = ev.raw["error"]?.message ?? ev.raw["message"] ?? "stream error";
      process.stderr.write(`${pc2.red(`[error] ${msg}`)}
`);
      return;
    }
    default:
      return;
  }
}
function flushBoundary(state) {
  if (state.lastWasThought) {
    process.stderr.write("\n");
    state.lastWasThought = false;
  }
  if (state.lastWasText) {
    process.stdout.write("\n");
    state.lastWasText = false;
  }
}
function summarizeToolDelta(type, delta) {
  switch (type) {
    case "google_search_call":
    case "url_context_call":
    case "file_search_call":
    case "code_execution_call":
    case "function_call":
    case "mcp_server_tool_call":
    case "google_maps_call": {
      const arg = delta?.["arguments"] ?? {};
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
function newStreamState() {
  return { lastWasThought: false, lastWasText: false, textBuffer: "" };
}

// src/commands/run.ts
async function runCmd(query, opts) {
  const log = new Logger(opts);
  const cfg = await readConfig();
  const auth2 = await resolveAuth(cfg);
  const agent = opts.standard ? AGENT_STANDARD : AGENT_MAX;
  assertCostBudget({ agent, confirmCost: opts.confirmCost, costCeilingUsd: cfg.costCeilingUsd });
  warnIfVertexDeepResearch(log, auth2);
  const client = makeClient(auth2);
  const outDir = path3.resolve(opts.out ?? "./research");
  const req = {
    query,
    agent,
    files: opts.file?.map((p) => ({ path: p })),
    urls: opts.url,
    enableWeb: opts.noWeb !== true,
    enableUrlContext: Boolean(opts.url && opts.url.length > 0),
    enableCodeExec: opts.codeExec,
    collaborativePlanning: opts.plan
  };
  const created = await client.create(req);
  await putJob({
    id: created.id,
    agent,
    query,
    label: opts.name,
    createdAt: Date.now(),
    state: created.status,
    costEstimateUsd: estimateCost(agent)
  });
  log.info(`job ${created.id} created${opts.stream ? " \u2014 streaming\u2026" : " \u2014 polling\u2026"}`);
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
        state
      );
      if (ev.type === "interaction.status_update") {
        const s = ev.raw["status"];
        if (s) lastStatus = s;
      }
    }
    await updateJob(created.id, { state: lastStatus, completedAt: Date.now() });
    final = await client.get(created.id);
  } else {
    const spinner = log.spinner(`polling ${created.id}`);
    try {
      final = await pollUntilDone(client, created.id, {
        timeoutMs: timeoutMin * 6e4,
        intervalMs: intervalSec * 1e3,
        onUpdate: (j) => {
          if (spinner) spinner.text = `polling ${created.id} \u2014 status: ${j.status}`;
        }
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
    manifest: artifacts.manifestPath
  });
}

// src/commands/status.ts
async function statusCmd(id, opts) {
  const log = new Logger(opts);
  const auth2 = await resolveAuth();
  const client = makeClient(auth2);
  const remote = await client.get(id);
  await updateJob(id, { state: remote.status, lastSeenAt: Date.now() });
  const local = await getJob(id);
  log.emit({
    id: remote.id,
    state: remote.status,
    agent: remote.agent ?? local?.agent,
    created: remote.created ?? (local?.createdAt ? new Date(local.createdAt).toISOString() : void 0),
    updated: remote.updated,
    error: remote.error?.message,
    label: local?.label,
    cost_estimate_usd: local?.costEstimateUsd
  });
}

// src/commands/list.ts
async function listCmd(opts) {
  const log = new Logger(opts);
  const all = await listJobs();
  const filtered = opts.state ? all.filter((j) => j.state === opts.state) : all;
  const limit = opts.limit ? parseInt(opts.limit, 10) : filtered.length;
  const rows = filtered.slice(0, limit);
  const monthly = await monthlyCostUsd();
  if (log.isJson) {
    log.emit({ jobs: rows, monthly_cost_usd: monthly });
    return;
  }
  if (rows.length === 0) {
    log.info('(no jobs in local cache \u2014 start one with `gdr start "<query>"`)');
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
function truncate(s, n) {
  return s.length <= n ? s : s.slice(0, n - 1) + "\u2026";
}
function humanAge(ms) {
  const sec = Math.floor(ms / 1e3);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

// src/commands/follow.ts
async function followCmd(id, opts) {
  const log = new Logger(opts);
  const auth2 = await resolveAuth();
  warnIfVertexDeepResearch(log, auth2);
  const client = makeClient(auth2);
  const state = newStreamState();
  for await (const ev of client.stream(id, opts.resumeFrom)) {
    renderEvent(ev, { showThoughts: !opts.noThoughts, showToolCalls: opts.toolCalls, json: opts.json }, state);
  }
}

// src/commands/fetch.ts
import path4 from "path";
async function fetchCmd(id, opts) {
  const log = new Logger(opts);
  const auth2 = await resolveAuth();
  const client = makeClient(auth2);
  const job = await client.get(id);
  if (job.status !== "completed") {
    log.warn(`job ${id} is in state \`${job.status}\` \u2014 fetching whatever outputs exist`);
  }
  const outDir = path4.resolve(opts.out ?? "./research");
  const artifacts = await saveArtifacts(job, outDir, opts.format ?? "md");
  log.emit({
    id: job.id,
    state: job.status,
    out_dir: artifacts.outDir,
    report: artifacts.reportPath,
    report_chars: artifacts.reportChars,
    report_size_bytes: artifacts.reportSize,
    charts: artifacts.charts,
    images: artifacts.images,
    manifest: artifacts.manifestPath
  });
}

// src/commands/cancel.ts
async function cancelCmd(id, opts) {
  const log = new Logger(opts);
  const auth2 = await resolveAuth();
  const client = makeClient(auth2);
  const res = await client.cancel(id);
  await updateJob(id, { state: res.status, completedAt: Date.now() });
  log.emit({ id: res.id, state: res.status });
}

// src/commands/refine.ts
async function refineCmd(parentId, message, opts) {
  const log = new Logger(opts);
  if (!opts.approve && (!message || message.trim() === "")) {
    throw new ValidationError(
      "provide a refinement message, or pass --approve to continue the plan as-is"
    );
  }
  const cfg = await readConfig();
  const auth2 = await resolveAuth(cfg);
  const parent = await getJob(parentId);
  const agent = parent?.agent ?? AGENT_MAX;
  assertCostBudget({
    agent,
    confirmCost: opts.confirmCost,
    costCeilingUsd: cfg.costCeilingUsd
  });
  warnIfVertexDeepResearch(log, auth2);
  const client = makeClient(auth2);
  const input2 = opts.approve ? "Approved. Please proceed with the plan as-is." : (message ?? "").trim();
  const req = {
    query: input2,
    agent,
    enableWeb: true,
    previousInteractionId: parentId
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
    query: `[refines ${parentId}] ${input2.slice(0, 100)}`,
    label: opts.name ?? (parent?.label ? `${parent.label}-refined` : void 0),
    createdAt: Date.now(),
    state: res.status,
    costEstimateUsd: estimateCost(agent)
  });
  log.emit({
    id: res.id,
    parent: parentId,
    state: res.status,
    agent,
    cost_estimate_usd: estimateCost(agent),
    cost_estimate: formatUsd(estimateCost(agent)),
    next: `gdr wait ${res.id}`
  });
}

// src/commands/auth.ts
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";
async function authCmd(opts) {
  const log = new Logger(opts);
  const cfg = await readConfig();
  if (opts.clear) {
    delete cfg.apiKey;
    await writeConfig(cfg);
    log.success(`cleared apiKey from ${configFilePath()} \u2014 auth will fall back to Vertex AI`);
    return;
  }
  if (opts.show) {
    const auth2 = await resolveAuth(cfg);
    if (!auth2) {
      log.emit({
        mode: "none",
        hint: "set GEMINI_API_KEY or run `gdr auth --key ...` for Gemini Developer API; otherwise set GOOGLE_CLOUD_PROJECT + run `gcloud auth application-default login` for Vertex AI"
      });
      return;
    }
    if (auth2.mode === "vertex") {
      log.emit({
        mode: "vertex",
        project: auth2.project,
        location: auth2.location,
        project_source: auth2.projectSource
      });
      return;
    }
    if (opts.reveal) {
      log.emit({ mode: "api-key", apiKey: auth2.apiKey, source: auth2.source });
    } else {
      const k = auth2.apiKey;
      const masked = k.slice(0, 6) + "***" + k.slice(-4);
      log.emit({
        mode: "api-key",
        apiKey_masked: masked,
        source: auth2.source,
        hint: "use --show --reveal for raw value"
      });
    }
    return;
  }
  let key = opts.key;
  if (!key) {
    if (!input.isTTY) throw new ValidationError("no --key provided and stdin is not a TTY");
    const rl = createInterface({ input, output });
    key = (await rl.question("Paste GEMINI_API_KEY: ")).trim();
    rl.close();
  }
  if (!key.startsWith("AIza")) {
    log.warn("key does not look like a Google API key (expected AIza... prefix). Saving anyway.");
  }
  cfg.apiKey = key;
  await writeConfig(cfg);
  log.success(`saved apiKey to ${configFilePath()} (chmod 600)`);
}

// src/commands/config.ts
var ALLOWED_KEYS = /* @__PURE__ */ new Set([
  "apiKey",
  "vertexProject",
  "vertexLocation",
  "defaultAgent",
  "defaultMaxTimeoutMin",
  "costCeilingUsd"
]);
async function configGetCmd(key, opts) {
  const log = new Logger(opts);
  if (!ALLOWED_KEYS.has(key)) throw new ValidationError(`unknown key: ${key}`);
  const cfg = await readConfig();
  log.emit({ [key]: cfg[key] ?? null });
}
async function configSetCmd(key, value, opts) {
  const log = new Logger(opts);
  if (!ALLOWED_KEYS.has(key)) throw new ValidationError(`unknown key: ${key}`);
  const cfg = await readConfig();
  const cast = key === "defaultMaxTimeoutMin" || key === "costCeilingUsd" ? Number(value) : value;
  if (typeof cast === "number" && Number.isNaN(cast)) {
    throw new ValidationError(`value for ${key} must be a number`);
  }
  cfg[key] = cast;
  await writeConfig(cfg);
  log.success(`set ${key} in ${configFilePath()}`);
}
async function configListCmd(opts) {
  const log = new Logger(opts);
  const cfg = await readConfig();
  const masked = { ...cfg };
  if (typeof masked["apiKey"] === "string") {
    const k = masked["apiKey"];
    masked["apiKey"] = k.slice(0, 6) + "***" + k.slice(-4);
  }
  log.emit({ path: configFilePath(), config: masked });
}

// src/commands/doctor.ts
import { promises as fs5 } from "fs";
import path5 from "path";
var SKILLS = ["deep-research", "research-status", "research-with-files"];
async function doctorCmd(opts) {
  const log = new Logger(opts);
  const checks = [];
  const cfg = await readConfig();
  const auth2 = await resolveAuth(cfg);
  checks.push({
    name: "auth",
    ok: Boolean(auth2) || isDryRunEnabled(),
    detail: auth2 ? auth2.mode === "api-key" ? `Gemini Developer API key from ${auth2.source}` : `Vertex AI (project=${auth2.project} from ${auth2.projectSource}, location=${auth2.location})` : isDryRunEnabled() ? "dry-run mode (no auth needed)" : "no auth \u2014 run `gdr auth` (API key) or `gcloud auth application-default login` + set GOOGLE_CLOUD_PROJECT"
  });
  checks.push({
    name: "config_file",
    ok: await pathExists(configFilePath()),
    detail: configFilePath()
  });
  checks.push({
    name: "jobs_cache",
    ok: await pathExists(jobsFilePath()),
    detail: jobsFilePath()
  });
  for (const s of SKILLS) {
    const p = path5.join(claudeSkillsDir(), s, "SKILL.md");
    checks.push({
      name: `skill:${s}`,
      ok: await pathExists(p),
      detail: await pathExists(p) ? p : `not installed \u2014 run \`gdr install-skills\``
    });
  }
  if (auth2 && !isDryRunEnabled()) {
    try {
      const client = makeClient(auth2);
      await client.get("__doctor_ping__").catch((err) => {
        const status = err.exitCode;
        if (status === ExitCode.Auth) throw err;
      });
      checks.push({ name: "api_reachable", ok: true });
    } catch (err) {
      checks.push({ name: "api_reachable", ok: false, detail: err.message });
    }
  }
  const monthly = await monthlyCostUsd();
  checks.push({ name: "monthly_spend_estimate", ok: true, detail: formatUsd(monthly) });
  if (log.isJson) {
    log.emit({ checks });
  } else {
    for (const c of checks) {
      const mark = c.ok ? "ok " : "FAIL";
      log.emit(`${mark}  ${c.name.padEnd(28)} ${c.detail ?? ""}`);
    }
  }
  const failures = checks.filter((c) => !c.ok && c.name !== "api_reachable");
  if (failures.length > 0) {
    throw new GdrError(`${failures.length} doctor check(s) failed`, ExitCode.DoctorFailed);
  }
}
async function pathExists(p) {
  try {
    await fs5.access(p);
    return true;
  } catch {
    return false;
  }
}

// src/commands/install-skills.ts
import { promises as fs6 } from "fs";
import path6 from "path";
import { fileURLToPath } from "url";
var SKILL_NAMES = ["deep-research", "research-status", "research-with-files"];
async function installSkillsCmd(opts) {
  const log = new Logger(opts);
  const target = path6.resolve(opts.target ?? claudeSkillsDir());
  const sourceDir = await locateSkillsSource();
  if (!sourceDir) {
    throw new ValidationError(
      "could not find bundled skills/ directory next to the gdr binary \u2014 reinstall the package"
    );
  }
  const installed = [];
  for (const name of SKILL_NAMES) {
    const from = path6.join(sourceDir, name, "SKILL.md");
    const to = path6.join(target, name, "SKILL.md");
    if (!await pathExists2(from)) {
      log.warn(`source missing: ${from} \u2014 skipping ${name}`);
      continue;
    }
    const exists = await pathExists2(to);
    if (exists && !opts.force) {
      installed.push({ skill: name, from, to, action: "skipped (exists, use --force)" });
      continue;
    }
    if (opts.dryRun) {
      installed.push({ skill: name, from, to, action: exists ? "would overwrite" : "would create" });
      continue;
    }
    await fs6.mkdir(path6.dirname(to), { recursive: true });
    await fs6.copyFile(from, to);
    installed.push({ skill: name, from, to, action: exists ? "overwritten" : "created" });
  }
  if (log.isJson) {
    log.emit({ target, installed });
  } else {
    for (const r of installed) log.emit(`${r.action.padEnd(22)} ${r.skill}  \u2192  ${r.to}`);
    log.success(`installed ${installed.filter((r) => !r.action.startsWith("skipped")).length}/${SKILL_NAMES.length} skills under ${target}`);
  }
}
async function pathExists2(p) {
  try {
    await fs6.access(p);
    return true;
  } catch {
    return false;
  }
}
async function locateSkillsSource() {
  const here = path6.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path6.resolve(here, "../skills"),
    path6.resolve(here, "../../skills"),
    path6.resolve(here, "../../../skills")
  ];
  for (const c of candidates) {
    if (await pathExists2(c)) return c;
  }
  return null;
}

// src/cli.ts
var VERSION = "0.1.0";
var program = new Command();
program.name("gdr").description("Google Deep Research Max \u2014 CLI wrapper around the Gemini Interactions API").version(VERSION).option("--json", "emit JSON to stdout instead of human-readable text").option("--quiet", "suppress informational logs").option("--no-color", "disable ANSI colors").option("--config <path>", "use this config file instead of ~/.config/gdr/config.json");
function global(cmd) {
  return cmd.optsWithGlobals();
}
program.command("start <query>").description("create a Deep Research job and exit immediately (default tier: MAX)").option("--standard", "use the cheaper Standard tier (~$1.22) instead of Max (~$4.80)").option("--no-web", "disable web search; use only attached files/URLs").option("--file <path...>", "attach a local file (PDF/CSV/image/audio/video) \u2014 repeatable", collect, []).option("--url <url...>", "attach a URL for grounding \u2014 repeatable", collect, []).option("--code-exec", "enable code execution tool").option("--plan", "use collaborative planning (review/refine plan before execution)").option("--name <label>", "human-readable label for the job (used by `list` and `research-status` skill)").option("--confirm-cost", "explicitly acknowledge Max-tier cost (~$4.80)").action((query, opts, cmd) => run(() => startCmd(query, { ...global(cmd), ...opts })));
program.command("wait <id>").description("poll a running job until it completes (resumable: safe to Ctrl-C and re-run)").option("--timeout <minutes>", "max minutes to poll before giving up", "60").option("--interval <seconds>", "initial poll interval (exp backoff to 60s)", "15").action((id, opts, cmd) => run(() => waitCmd(id, { ...global(cmd), ...opts })));
program.command("run <query>").description("start + wait + fetch \u2014 convenience for short jobs").option("--standard", "use Standard tier instead of Max").option("--no-web", "disable web search").option("--file <path...>", "attach a local file \u2014 repeatable", collect, []).option("--url <url...>", "attach a URL \u2014 repeatable", collect, []).option("--code-exec", "enable code execution tool").option("--plan", "collaborative planning").option("--name <label>", "label for the job").option("--confirm-cost", "acknowledge Max-tier cost").option("--out <dir>", "output directory for the report and artifacts", "./research").addOption(new Option("--format <fmt>", "report format").choices(["md", "json", "html"]).default("md")).option("--timeout <minutes>", "max minutes to wait", "30").option("--interval <seconds>", "poll interval (only when not streaming)", "15").option("--stream", "stream thought_summary + text deltas live (SSE) instead of polling").option("--no-thoughts", "with --stream, hide thought_summary deltas").option("--tool-calls", "with --stream, also surface tool invocations").action((query, opts, cmd) => run(() => runCmd(query, { ...global(cmd), ...opts })));
program.command("status <id>").description("one-shot status check for a job").action((id, opts, cmd) => run(() => statusCmd(id, { ...global(cmd), ...opts })));
program.command("list").description("list cached jobs and 30-day estimated spend").option("--state <state>", "filter by state (in_progress / completed / failed / cancelled)").option("--limit <n>", "max rows to show").action((opts, cmd) => run(() => listCmd({ ...global(cmd), ...opts })));
program.command("follow <id>").description("stream Gemini's thoughts and report deltas in real time (SSE)").option("--no-thoughts", "hide thought_summary deltas; show only output text").option("--tool-calls", "also surface tool invocations (search queries, URL fetches, code exec)").option("--resume-from <event-id>", "resume the stream from a specific event id (after a disconnect)").action((id, opts, cmd) => run(() => followCmd(id, { ...global(cmd), ...opts })));
program.command("fetch <id>").description("download the report and artifacts for a finished job").option("--out <dir>", "output directory", "./research").addOption(new Option("--format <fmt>", "report format").choices(["md", "json", "html"]).default("md")).option("--include-artifacts", "also save charts and images (default: yes)").action((id, opts, cmd) => run(() => fetchCmd(id, { ...global(cmd), ...opts })));
program.command("cancel <id>").description("cancel a running job (server-side)").action((id, opts, cmd) => run(() => cancelCmd(id, { ...global(cmd), ...opts })));
program.command("refine <parent-id> [message]").description("send a plan refinement / approval / follow-up to a prior job (creates a continuation linked via previous_interaction_id)").option("--approve", "approve the parent's proposed plan as-is, no message needed").option("--name <label>", "label for the refinement job").option("--confirm-cost", "acknowledge Max-tier cost (~$4.80) for the continuation").action(
  (parentId, message, opts, cmd) => run(() => refineCmd(parentId, message, { ...global(cmd), ...opts }))
);
var auth = program.command("auth").description("store, show, or clear your Gemini API key in ~/.config/gdr/config.json").option("--key <value>", "set API key non-interactively").option("--show", "show the stored key (masked unless --reveal)").option("--reveal", "with --show, print the unmasked key").option("--clear", "remove the stored key").action((opts, cmd) => run(() => authCmd({ ...global(cmd), ...opts })));
auth.exitOverride();
var config = program.command("config").description("read or write configuration values");
config.command("get <key>").action((key, opts, cmd) => run(() => configGetCmd(key, { ...global(cmd), ...opts })));
config.command("set <key> <value>").action(
  (key, value, opts, cmd) => run(() => configSetCmd(key, value, { ...global(cmd), ...opts }))
);
config.command("list").action((opts, cmd) => run(() => configListCmd({ ...global(cmd), ...opts })));
program.command("doctor").description("verify auth, network, API reachability, and skill registration").action((opts, cmd) => run(() => doctorCmd({ ...global(cmd), ...opts })));
program.command("install-skills").description("copy bundled Claude Code skills into ~/.claude/skills/").option("--force", "overwrite existing skills").option("--dry-run", "report what would be installed without writing").option("--target <dir>", "install to a different directory").action((opts, cmd) => run(() => installSkillsCmd({ ...global(cmd), ...opts })));
function collect(value, previous) {
  return [...previous, value];
}
function run(fn) {
  fn().catch((err) => {
    if (err instanceof GdrError) {
      process.stderr.write(`${pc3.red("error")} ${redact(err.message)}
`);
      process.exit(err.exitCode);
    }
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${pc3.red("error")} ${redact(message)}
`);
    process.exit(ExitCode.Generic);
  });
}
program.parseAsync(process.argv).catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${pc3.red("error")} ${message}
`);
  process.exit(ExitCode.Generic);
});
//# sourceMappingURL=cli.js.map