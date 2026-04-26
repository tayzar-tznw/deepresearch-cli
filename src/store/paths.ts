import { homedir } from "node:os";
import { join } from "node:path";

export function configHome(): string {
  const xdg = process.env["XDG_CONFIG_HOME"];
  return xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
}

export function gdrConfigDir(): string {
  return join(configHome(), "gdr");
}

export function configFilePath(): string {
  return join(gdrConfigDir(), "config.json");
}

export function jobsFilePath(): string {
  return join(gdrConfigDir(), "jobs.json");
}

export function claudeSkillsDir(): string {
  return join(homedir(), ".claude", "skills");
}
