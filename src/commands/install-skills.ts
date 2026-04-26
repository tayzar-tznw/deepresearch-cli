import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claudeSkillsDir } from "../store/paths.js";
import { Logger } from "../output/logger.js";
import { ValidationError } from "../util/errors.js";
import type { GlobalOpts } from "./types.js";

const SKILL_NAMES = ["deep-research", "research-status", "research-with-files"];

export interface InstallSkillsOpts extends GlobalOpts {
  force?: boolean;
  dryRun?: boolean;
  target?: string;
}

export async function installSkillsCmd(opts: InstallSkillsOpts): Promise<void> {
  const log = new Logger(opts);
  const target = path.resolve(opts.target ?? claudeSkillsDir());
  const sourceDir = await locateSkillsSource();
  if (!sourceDir) {
    throw new ValidationError(
      "could not find bundled skills/ directory next to the gdr binary — reinstall the package",
    );
  }
  const installed: Array<{ skill: string; from: string; to: string; action: string }> = [];
  for (const name of SKILL_NAMES) {
    const from = path.join(sourceDir, name, "SKILL.md");
    const to = path.join(target, name, "SKILL.md");
    if (!(await pathExists(from))) {
      log.warn(`source missing: ${from} — skipping ${name}`);
      continue;
    }
    const exists = await pathExists(to);
    if (exists && !opts.force) {
      installed.push({ skill: name, from, to, action: "skipped (exists, use --force)" });
      continue;
    }
    if (opts.dryRun) {
      installed.push({ skill: name, from, to, action: exists ? "would overwrite" : "would create" });
      continue;
    }
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
    installed.push({ skill: name, from, to, action: exists ? "overwritten" : "created" });
  }
  if (log.isJson) {
    log.emit({ target, installed });
  } else {
    for (const r of installed) log.emit(`${r.action.padEnd(22)} ${r.skill}  →  ${r.to}`);
    log.success(`installed ${installed.filter((r) => !r.action.startsWith("skipped")).length}/${SKILL_NAMES.length} skills under ${target}`);
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

async function locateSkillsSource(): Promise<string | null> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../skills"),
    path.resolve(here, "../../skills"),
    path.resolve(here, "../../../skills"),
  ];
  for (const c of candidates) {
    if (await pathExists(c)) return c;
  }
  return null;
}
