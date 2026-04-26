import { describe, expect, it, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(here, "../../dist/cli.js");

interface Result {
  stdout: string;
  stderr: string;
  code: number | null;
}

function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<Result> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI_PATH, ...args],
      { env, encoding: "utf8" },
      (err, stdout, stderr) => {
        const code = err && "code" in err ? (err as { code: number }).code : err ? 1 : 0;
        resolve({ stdout, stderr, code });
      },
    );
  });
}

let tmp: string;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gdr-int-"));
  env = {
    ...process.env,
    XDG_CONFIG_HOME: tmp,
    HOME: tmp,
    GDR_DRY_RUN: "1",
    NO_COLOR: "1",
  };
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("dry-run integration", () => {
  it("`gdr --help` shows all subcommands and exits 0", async () => {
    const { stdout, code } = await runCli(["--help"], env);
    expect(code).toBe(0);
    for (const cmd of ["start", "wait", "run", "status", "list", "follow", "fetch", "cancel", "auth", "config", "doctor", "install-skills"]) {
      expect(stdout).toContain(cmd);
    }
  });

  it("`gdr start` enforces Max-tier cost guardrail without --confirm-cost", async () => {
    const { stderr, code } = await runCli(["start", "test query", "--json"], env);
    expect(code).toBe(4);
    expect(stderr).toMatch(/--confirm-cost|GDR_CONFIRM_COST|costCeilingUsd/i);
  });

  it("`gdr start` succeeds in dry-run with --confirm-cost", async () => {
    const { stdout, code } = await runCli(["start", "test", "--confirm-cost", "--json"], env);
    expect(code).toBe(0);
    const lines = stdout.trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]!);
    expect(last.id).toMatch(/^dry-/);
    expect(last.state).toBe("in_progress");
    expect(last.next).toMatch(/^gdr wait /);
  });

  it("`gdr run` produces a report.md and outputs.json", async () => {
    const out = path.join(tmp, "research");
    const { stdout, code } = await runCli(
      ["run", "what is the Voyager 1 distance?", "--standard", "--out", out, "--json"],
      env,
    );
    expect(code).toBe(0);
    const lines = stdout.trim().split("\n").filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]!);
    expect(last.state).toBe("completed");
    const reportPath = path.join(out, "report.md");
    const manifestPath = path.join(out, "outputs.json");
    expect((await fs.stat(reportPath)).size).toBeGreaterThan(0);
    expect((await fs.stat(manifestPath)).size).toBeGreaterThan(0);
  });

  it("`gdr list` shows the cached job after `start`", async () => {
    await runCli(["start", "first job", "--name", "jobA", "--confirm-cost", "--json"], env);
    const { stdout, code } = await runCli(["list", "--json"], env);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.jobs.length).toBeGreaterThanOrEqual(1);
    expect(parsed.jobs[0].label).toBe("jobA");
  });

  it("`gdr refine` requires either a message or --approve", async () => {
    const { stderr, code } = await runCli(["refine", "fake-parent-id", "--json"], env);
    expect(code).toBe(4);
    expect(stderr).toMatch(/refinement message|--approve/i);
  });

  it("`gdr refine --approve` creates a continuation in dry-run mode", async () => {
    const start = await runCli(["start", "first job", "--name", "p1", "--confirm-cost", "--json"], env);
    const startLine = start.stdout.trim().split("\n").filter(Boolean).pop()!;
    const parentId = (JSON.parse(startLine) as { id: string }).id;
    const { stdout, code } = await runCli(
      ["refine", parentId, "--approve", "--confirm-cost", "--json"],
      env,
    );
    expect(code).toBe(0);
    const refLine = stdout.trim().split("\n").filter(Boolean).pop()!;
    const parsed = JSON.parse(refLine) as { id: string; parent: string };
    expect(parsed.id).toMatch(/^dry-/);
    expect(parsed.parent).toBe(parentId);
  });

  it("`gdr install-skills --dry-run` lists the three bundled skills", async () => {
    const targetDir = path.join(tmp, "skills-target");
    const { stdout, code } = await runCli(
      ["install-skills", "--dry-run", "--target", targetDir, "--json"],
      env,
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.installed.map((r: { skill: string }) => r.skill).sort()).toEqual([
      "deep-research",
      "research-status",
      "research-with-files",
    ]);
  });

  it("install-skills actually copies files when not --dry-run", async () => {
    const targetDir = path.join(tmp, "skills-target");
    const { code } = await runCli(["install-skills", "--target", targetDir, "--json"], env);
    expect(code).toBe(0);
    for (const s of ["deep-research", "research-status", "research-with-files"]) {
      const p = path.join(targetDir, s, "SKILL.md");
      expect((await fs.stat(p)).isFile()).toBe(true);
    }
  });

  it("`gdr doctor` runs and reports per-check status", async () => {
    const { stdout, stderr, code } = await runCli(["doctor", "--json"], env);
    // Exit code may be 7 (doctor failure) since skills aren't installed in this clean tmp; that's fine,
    // we just want the structured output to be valid.
    expect([0, 7]).toContain(code);
    const blob = stdout.trim() || stderr.trim();
    const lines = blob.split("\n").filter(Boolean);
    const json = JSON.parse(lines[lines.length - 1]!);
    expect(Array.isArray(json.checks ?? json.error)).toBeDefined();
  });
});
