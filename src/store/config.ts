import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { configFilePath, gdrConfigDir } from "./paths.js";

export interface GdrConfig {
  apiKey?: string;
  vertexProject?: string;
  vertexLocation?: string;
  defaultAgent?: string;
  defaultMaxTimeoutMin?: number;
  costCeilingUsd?: number;
}

const EMPTY: GdrConfig = {};

export async function readConfig(path: string = configFilePath()): Promise<GdrConfig> {
  try {
    const raw = await fs.readFile(path, "utf8");
    const parsed = JSON.parse(raw) as GdrConfig;
    return { ...EMPTY, ...parsed };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY };
    throw err;
  }
}

export async function writeConfig(cfg: GdrConfig, path: string = configFilePath()): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  await fs.rename(tmp, path);
  try {
    await fs.chmod(gdrConfigDir(), 0o700);
  } catch {
    /* best-effort */
  }
}

export type ResolvedAuth =
  | { mode: "api-key"; apiKey: string; source: "env" | "config" }
  | { mode: "vertex"; project: string; location: string; projectSource: "env" | "config" };

/**
 * Auth precedence:
 *   1. Explicit API key (env GEMINI_API_KEY > env GOOGLE_API_KEY > config.apiKey) → Gemini Developer API.
 *   2. Otherwise Vertex AI via ADC, with project from env GOOGLE_CLOUD_PROJECT or config.vertexProject;
 *      location from env GOOGLE_CLOUD_LOCATION or config.vertexLocation, defaulting to "global".
 *   3. Returns null if neither path is configured.
 */
export async function resolveAuth(cfg?: GdrConfig): Promise<ResolvedAuth | null> {
  const c = cfg ?? (await readConfig());

  const envKey = process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_API_KEY"];
  if (envKey && envKey.length > 0) return { mode: "api-key", apiKey: envKey, source: "env" };
  if (c.apiKey && c.apiKey.length > 0) return { mode: "api-key", apiKey: c.apiKey, source: "config" };

  const envProject = process.env["GOOGLE_CLOUD_PROJECT"];
  const cfgProject = c.vertexProject;
  const project = envProject && envProject.length > 0 ? envProject : cfgProject;
  if (project) {
    const location =
      process.env["GOOGLE_CLOUD_LOCATION"] ??
      process.env["GOOGLE_CLOUD_REGION"] ??
      c.vertexLocation ??
      "global";
    return {
      mode: "vertex",
      project,
      location,
      projectSource: envProject && envProject.length > 0 ? "env" : "config",
    };
  }

  return null;
}

/** Back-compat helper used by older internal callers. */
export async function resolveApiKey(cfg?: GdrConfig): Promise<{ apiKey: string; source: "env" | "config" } | null> {
  const auth = await resolveAuth(cfg);
  if (auth?.mode === "api-key") return { apiKey: auth.apiKey, source: auth.source };
  return null;
}
