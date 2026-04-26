import { readConfig, writeConfig, type GdrConfig } from "../store/config.js";
import { configFilePath } from "../store/paths.js";
import { Logger } from "../output/logger.js";
import { ValidationError } from "../util/errors.js";
import type { GlobalOpts } from "./types.js";

const ALLOWED_KEYS = new Set([
  "apiKey",
  "vertexProject",
  "vertexLocation",
  "defaultAgent",
  "defaultMaxTimeoutMin",
  "costCeilingUsd",
]);

export async function configGetCmd(key: string, opts: GlobalOpts): Promise<void> {
  const log = new Logger(opts);
  if (!ALLOWED_KEYS.has(key)) throw new ValidationError(`unknown key: ${key}`);
  const cfg = (await readConfig()) as Record<string, unknown>;
  log.emit({ [key]: cfg[key] ?? null });
}

export async function configSetCmd(key: string, value: string, opts: GlobalOpts): Promise<void> {
  const log = new Logger(opts);
  if (!ALLOWED_KEYS.has(key)) throw new ValidationError(`unknown key: ${key}`);
  const cfg = (await readConfig()) as GdrConfig;
  const cast: unknown =
    key === "defaultMaxTimeoutMin" || key === "costCeilingUsd" ? Number(value) : value;
  if (typeof cast === "number" && Number.isNaN(cast)) {
    throw new ValidationError(`value for ${key} must be a number`);
  }
  (cfg as Record<string, unknown>)[key] = cast;
  await writeConfig(cfg);
  log.success(`set ${key} in ${configFilePath()}`);
}

export async function configListCmd(opts: GlobalOpts): Promise<void> {
  const log = new Logger(opts);
  const cfg = (await readConfig()) as Record<string, unknown>;
  const masked = { ...cfg };
  if (typeof masked["apiKey"] === "string") {
    const k = masked["apiKey"] as string;
    masked["apiKey"] = k.slice(0, 6) + "***" + k.slice(-4);
  }
  log.emit({ path: configFilePath(), config: masked });
}
