import { promises as fs } from "node:fs";
import path from "node:path";
import { readConfig, resolveAuth } from "../store/config.js";
import { configFilePath, claudeSkillsDir, jobsFilePath } from "../store/paths.js";
import { monthlyCostUsd } from "../store/jobs.js";
import { Logger } from "../output/logger.js";
import { isDryRunEnabled, makeClient } from "../api/client.js";
import { formatUsd } from "../util/cost.js";
import { ExitCode, GdrError } from "../util/errors.js";
import type { GlobalOpts } from "./types.js";

const SKILLS = ["deep-research", "research-status", "research-with-files"];

export async function doctorCmd(opts: GlobalOpts): Promise<void> {
  const log = new Logger(opts);
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

  const cfg = await readConfig();
  const auth = await resolveAuth(cfg);
  checks.push({
    name: "auth",
    ok: Boolean(auth) || isDryRunEnabled(),
    detail: auth
      ? auth.mode === "api-key"
        ? `Gemini Developer API key from ${auth.source}`
        : `Vertex AI (project=${auth.project} from ${auth.projectSource}, location=${auth.location})`
      : isDryRunEnabled()
        ? "dry-run mode (no auth needed)"
        : "no auth — run `gdr auth` (API key) or `gcloud auth application-default login` + set GOOGLE_CLOUD_PROJECT",
  });

  checks.push({
    name: "config_file",
    ok: await pathExists(configFilePath()),
    detail: configFilePath(),
  });

  checks.push({
    name: "jobs_cache",
    ok: await pathExists(jobsFilePath()),
    detail: jobsFilePath(),
  });

  for (const s of SKILLS) {
    const p = path.join(claudeSkillsDir(), s, "SKILL.md");
    checks.push({
      name: `skill:${s}`,
      ok: await pathExists(p),
      detail: (await pathExists(p)) ? p : `not installed — run \`gdr install-skills\``,
    });
  }

  if (auth && !isDryRunEnabled()) {
    try {
      const client = makeClient(auth);
      await client.get("__doctor_ping__").catch((err) => {
        const status = (err as { exitCode?: number }).exitCode;
        if (status === ExitCode.Auth) throw err;
      });
      checks.push({ name: "api_reachable", ok: true });
    } catch (err) {
      checks.push({ name: "api_reachable", ok: false, detail: (err as Error).message });
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

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
