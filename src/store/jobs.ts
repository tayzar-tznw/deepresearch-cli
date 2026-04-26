import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";
import { jobsFilePath } from "./paths.js";

export type JobState =
  | "in_progress"
  | "requires_action"
  | "completed"
  | "failed"
  | "cancelled"
  | "incomplete"
  | "unknown";

export interface JobRecord {
  id: string;
  agent: string;
  /** When --plan auto-switches the plan turn to Standard, this preserves the user's
   *  intended tier (typically Max) so `gdr refine` can route the actual research run
   *  back to it. */
  intendedAgent?: string;
  query: string;
  label?: string;
  createdAt: number;
  lastSeenAt?: number;
  completedAt?: number;
  state: JobState;
  costEstimateUsd: number;
  errorMessage?: string;
}

interface JobsFile {
  version: 1;
  jobs: Record<string, JobRecord>;
}

const EMPTY: JobsFile = { version: 1, jobs: {} };

async function ensureFile(path: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await fs.access(path);
  } catch {
    await fs.writeFile(path, JSON.stringify(EMPTY, null, 2), { mode: 0o600 });
  }
}

async function readJobsFile(path: string): Promise<JobsFile> {
  try {
    const raw = await fs.readFile(path, "utf8");
    const parsed = JSON.parse(raw) as JobsFile;
    if (parsed && typeof parsed === "object" && "jobs" in parsed) return parsed;
    return { ...EMPTY };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY };
    throw err;
  }
}

async function writeJobsFile(path: string, data: JobsFile): Promise<void> {
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fs.rename(tmp, path);
}

async function withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  await ensureFile(path);
  const release = await lockfile.lock(path, {
    retries: { retries: 10, minTimeout: 50, maxTimeout: 500, factor: 2 },
    stale: 10_000,
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}

export async function putJob(job: JobRecord, path: string = jobsFilePath()): Promise<void> {
  await withLock(path, async () => {
    const data = await readJobsFile(path);
    data.jobs[job.id] = job;
    await writeJobsFile(path, data);
  });
}

export async function updateJob(
  id: string,
  patch: Partial<JobRecord>,
  path: string = jobsFilePath(),
): Promise<JobRecord | null> {
  return withLock(path, async () => {
    const data = await readJobsFile(path);
    const existing = data.jobs[id];
    if (!existing) return null;
    const merged: JobRecord = { ...existing, ...patch };
    data.jobs[id] = merged;
    await writeJobsFile(path, data);
    return merged;
  });
}

export async function getJob(id: string, path: string = jobsFilePath()): Promise<JobRecord | null> {
  const data = await readJobsFile(path);
  return data.jobs[id] ?? null;
}

export async function listJobs(path: string = jobsFilePath()): Promise<JobRecord[]> {
  const data = await readJobsFile(path);
  return Object.values(data.jobs).sort((a, b) => b.createdAt - a.createdAt);
}

export async function findByLabel(label: string, path: string = jobsFilePath()): Promise<JobRecord[]> {
  const all = await listJobs(path);
  return all.filter((j) => j.label === label);
}

export async function monthlyCostUsd(path: string = jobsFilePath()): Promise<number> {
  const all = await listJobs(path);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return all
    .filter((j) => j.createdAt >= cutoff)
    .reduce((sum, j) => sum + (j.costEstimateUsd ?? 0), 0);
}
